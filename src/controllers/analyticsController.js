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

        // Simple mock for graph (Real implementation would aggregate ChatHistory dates)
        const recentActivity = [
            { name: "Mon", messages: 12 },
            { name: "Tue", messages: 19 },
            { name: "Wed", messages: 15 },
            { name: "Thu", messages: 25 },
            { name: "Fri", messages: 32 },
            { name: "Sat", messages: 10 },
            { name: "Sun", messages: 8 },
        ];

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
