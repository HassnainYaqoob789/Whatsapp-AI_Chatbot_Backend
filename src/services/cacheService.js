const WebhookLock = require('../models/WebhookLock');
const MessageBuffer = require('../models/MessageBuffer');

console.log('🔗 MongoDB Cache Service Initialized (Replacing Redis)');

/**
 * Checks if a messageId has already been processed using MongoDB Unique Index (E11000).
 * Returns true if duplicate, false if new.
 */
async function isDuplicateMessage(messageId) {
    if (!messageId) return false;
    
    try {
        await WebhookLock.create({ messageId });
        // Successfully created, it's a new message
        return false;
    } catch (error) {
        if (error.code === 11000) {
            // Duplicate key error, means it already exists
            console.warn(`[Dedup] Duplicate webhook blocked across cluster via MongoDB: ${messageId}`);
            return true;
        }
        // For any other DB error, log it and assume not duplicate to allow processing fallback
        console.error(`[Dedup] Error checking duplicate message in MongoDB:`, error);
        return false;
    }
}

/**
 * Adds a message to the client's temporary buffer in MongoDB.
 */
async function addMessageToBuffer(clientId, message, role = "user") {
    try {
        await MessageBuffer.create({
            clientId,
            role,
            content: message,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error(`[Buffer] Error adding message to MongoDB buffer:`, error);
    }
}

/**
 * Retrieves and clears all messages from the client's temporary buffer atomically.
 */
async function flushMessageBuffer(clientId) {
    try {
        // Find all messages sorted by timestamp
        const messages = await MessageBuffer.find({ clientId }).sort({ timestamp: 1 }).lean();
        
        if (messages && messages.length > 0) {
            // Delete the messages we just fetched
            const messageIds = messages.map(m => m._id);
            await MessageBuffer.deleteMany({ _id: { $in: messageIds } });
            
            // Format to match old Redis structure exactly
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp
            }));
        }
        
        return [];
    } catch (error) {
        console.error(`[Buffer] Error flushing message buffer from MongoDB:`, error);
        return [];
    }
}

/**
 * Gets the count of currently buffered messages for a client.
 */
async function getBufferCount(clientId) {
    try {
        return await MessageBuffer.countDocuments({ clientId });
    } catch (error) {
        console.error(`[Buffer] Error counting message buffer from MongoDB:`, error);
        return 0;
    }
}

module.exports = {
    isDuplicateMessage,
    addMessageToBuffer,
    flushMessageBuffer,
    getBufferCount
};
