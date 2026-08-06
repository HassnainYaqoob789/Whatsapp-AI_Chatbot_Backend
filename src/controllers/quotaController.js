// =============================================================================
// QUOTA CONTROLLER - Token Usage & Limit APIs
// =============================================================================

const { getQuotaStatus, autoResetClientQuota } = require("../services/quotaService");
const UsageLog = require("../models/UsageLog");
const Client = require("../models/Client");

// GET quota status for current client
const getMyQuota = async (req, res) => {
    try {
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required." });

        const quota = await getQuotaStatus(clientId);
        if (!quota) return res.status(404).json({ success: false, message: "Client not found." });

        return res.status(200).json({ success: true, quota });
    } catch (error) {
        console.error("Error fetching quota:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

// UPDATE quota limits for a client (SUPER_ADMIN only)
const updateQuotaLimits = async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: "Only Super Admin can change quota limits." });
        }

        const { clientId, monthlyTokenLimit, dailyTokenLimit } = req.body;
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required." });

        const update = {};
        if (monthlyTokenLimit !== undefined) update.monthlyTokenLimit = monthlyTokenLimit;
        if (dailyTokenLimit !== undefined) update.dailyTokenLimit = dailyTokenLimit;

        const client = await Client.findByIdAndUpdate(clientId, update, { new: true });
        if (!client) return res.status(404).json({ success: false, message: "Client not found." });

        return res.status(200).json({ success: true, message: "Quota limits updated.", client: {
            businessName: client.businessName,
            monthlyTokenLimit: client.monthlyTokenLimit,
            dailyTokenLimit: client.dailyTokenLimit,
        }});
    } catch (error) {
        console.error("Error updating quota limits:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

// GET usage report for all clients (SUPER_ADMIN only)
const getUsageReport = async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: "Only Super Admin can view usage reports." });
        }

        const { days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));
        const startDateStr = startDate.toISOString().split('T')[0];

        // Get all clients and auto-reset daily/monthly counters if needed
        const rawClients = await Client.find({});
        const clients = [];
        for (const c of rawClients) {
            const updated = await autoResetClientQuota(c);
            clients.push(updated);
        }

        // Get daily usage logs for the period
        const usageLogs = await UsageLog.aggregate([
            { $match: { date: { $gte: startDateStr } } },
            { $group: {
                _id: '$clientId',
                totalTokens: { $sum: '$tokensUsed' },
                dailyBreakdown: { $push: { date: '$date', tokens: '$tokensUsed' } }
            }},
            { $lookup: {
                from: 'clients',
                localField: '_id',
                foreignField: '_id',
                as: 'client'
            }},
            { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
            { $project: {
                clientId: '$_id',
                businessName: '$client.businessName',
                totalTokens: 1,
                dailyBreakdown: 1
            }}
        ]);

        return res.status(200).json({
            success: true,
            period: `Last ${days} days`,
            clients: clients.map(c => {
                const managedQuota = c.useNaracordQuota !== false;
                return {
                    _id: c._id,
                    businessName: c.businessName,
                    aiModel: c.aiModel,
                    useNaracordQuota: managedQuota,
                    isActive: c.isActive,
                    monthlyQuota: { limit: c.monthlyTokenLimit, used: c.monthlyTokensUsed },
                    dailyQuota: { limit: c.dailyTokenLimit, used: c.dailyTokensUsed },
                };
            }),
            usageLogs,
        });
    } catch (error) {
        console.error("Error fetching usage report:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

module.exports = { getMyQuota, updateQuotaLimits, getUsageReport };
