const Redis = require('ioredis');

// Connect to Redis (Defaults to localhost:6379 if REDIS_URL is not provided)
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redisClient.on('connect', () => {
    console.log('✅ Connected to Redis (Cluster-Safe State Enabled)');
});

redisClient.on('error', (err) => {
    console.error('❌ Redis Connection Error:', err);
});

// ─────────────────────────────────────────────
// 1. Cluster-Safe Message Deduplication
// ─────────────────────────────────────────────
const DEDUP_TTL_SECONDS = 60; // Keep deduplication keys for 60 seconds

/**
 * Checks if a messageId has already been processed using atomic SETNX.
 * Returns true if duplicate, false if new.
 */
async function isDuplicateMessage(messageId) {
    if (!messageId) return false;
    const key = `webhook:msg:${messageId}`;
    
    // SETNX (Set if Not eXists) returns 1 if set successfully, 0 if it already existed
    const setSuccess = await redisClient.setnx(key, '1');
    if (setSuccess === 1) {
        // Newly added, set TTL
        await redisClient.expire(key, DEDUP_TTL_SECONDS);
        return false;
    }
    
    console.warn(`[Dedup] Duplicate webhook blocked across cluster: ${messageId}`);
    return true; // It already existed, so it's a duplicate
}

// ─────────────────────────────────────────────
// 2. Cluster-Safe Message Buffer
// ─────────────────────────────────────────────
const BUFFER_TTL_SECONDS = 180; // 3 minutes

/**
 * Adds a message to the client's temporary buffer in Redis.
 */
async function addMessageToBuffer(clientId, message, role = "user") {
    const key = `msg_buffer:${clientId}`;
    const payload = JSON.stringify({ role, content: message, timestamp: Date.now() });
    
    await redisClient.rpush(key, payload);
    await redisClient.expire(key, BUFFER_TTL_SECONDS);
}

/**
 * Retrieves and clears all messages from the client's temporary buffer.
 */
async function flushMessageBuffer(clientId) {
    const key = `msg_buffer:${clientId}`;
    
    // Atomically get all items and delete the list
    const pipeline = redisClient.pipeline();
    pipeline.lrange(key, 0, -1);
    pipeline.del(key);
    
    const results = await pipeline.exec();
    
    if (results && results[0] && results[0][1]) {
        const rawMessages = results[0][1];
        return rawMessages.map(msg => JSON.parse(msg));
    }
    
    return [];
}

/**
 * Gets the count of currently buffered messages for a client.
 */
async function getBufferCount(clientId) {
    const key = `msg_buffer:${clientId}`;
    return await redisClient.llen(key);
}

module.exports = {
    redisClient,
    isDuplicateMessage,
    addMessageToBuffer,
    flushMessageBuffer,
    getBufferCount
};
