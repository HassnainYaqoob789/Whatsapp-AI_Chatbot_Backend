const Client = require("../models/Client");

const clientCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getClientByPhoneId(phoneNumberId) {
    // Check cache first
    const cached = clientCache[phoneNumberId];
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.client;
    }

    // Lookup from DB
    const client = await Client.findOne({ phoneNumberId, isActive: true });
    if (client) {
        clientCache[phoneNumberId] = { client, timestamp: Date.now() };
    }
    return client;
}

function invalidateClientCache(phoneNumberId) {
    if (phoneNumberId && clientCache[phoneNumberId]) {
        delete clientCache[phoneNumberId];
    }
}

// Memory Leak Protection: Periodic Cache Cleanup
setInterval(() => {
    const now = Date.now();
    for (const [phoneId, data] of Object.entries(clientCache)) {
        if (now - data.timestamp > CACHE_TTL) {
            delete clientCache[phoneId];
        }
    }
}, 60 * 1000); // Run every minute

module.exports = {
    getClientByPhoneId,
    invalidateClientCache
};
