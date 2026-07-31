const ChatHistory = require("../models/ChatHistory");
const Lead = require("../models/Lead");

const getLeads = async (req, res) => {
    try {
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        const leads = await Lead.find({ clientId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, leads });
    } catch (error) {
        console.error("Error fetching leads:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const getAnalytics = async (req, res) => {
    try {
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        const totalChats = await ChatHistory.countDocuments({ clientId });
        const totalLeads = await Lead.countDocuments({ clientId });

        // Real aggregation: count messages per day for the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dailyActivity = await ChatHistory.aggregate([
            { $match: { clientId: new (require('mongoose').Types.ObjectId)(clientId), updatedAt: { $gte: sevenDaysAgo } } },
            { $unwind: '$messages' },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
                messages: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]);

        // Build a full 7-day array (fill in zero for days with no activity)
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const recentActivity = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayName = dayNames[d.getDay()];
            const found = dailyActivity.find(a => a._id === dateStr);
            recentActivity.push({ name: dayName, messages: found ? found.messages : 0 });
        }

        res.status(200).json({
            success: true,
            data: {
                totalChats,
                totalLeads,
                recentActivity
            }
        });
    } catch (error) {
        console.error("Analytics error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    getLeads,
    getAnalytics
};
