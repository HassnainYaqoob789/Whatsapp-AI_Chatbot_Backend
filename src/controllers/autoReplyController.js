// =============================================================================
// AUTO REPLY RULES CONTROLLER - CRUD for Hybrid Chatbot Menu/Keyword System
// =============================================================================

const AutoReplyRule = require("../models/AutoReplyRule");

// GET all auto-reply rules for a client
const getAutoReplies = async (req, res) => {
    try {
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required." });

        const rules = await AutoReplyRule.find({ clientId }).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, rules });
    } catch (error) {
        console.error("Error fetching auto-reply rules:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

// CREATE a new auto-reply rule
const createAutoReply = async (req, res) => {
    try {
        let clientId = req.body.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required." });

        const { keyword, replyText, matchType } = req.body;
        if (!keyword || !replyText) {
            return res.status(400).json({ success: false, message: "keyword and replyText are required." });
        }

        const rule = await AutoReplyRule.create({
            clientId,
            keyword: keyword.toLowerCase().trim(),
            replyText,
            matchType: matchType || 'exact',
        });

        return res.status(201).json({ success: true, rule });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: "This keyword already exists for your account." });
        }
        console.error("Error creating auto-reply rule:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

// UPDATE an existing auto-reply rule
const updateAutoReply = async (req, res) => {
    try {
        const { id } = req.params;
        const { keyword, replyText, matchType, isActive } = req.body;

        const update = {};
        if (keyword !== undefined) update.keyword = keyword.toLowerCase().trim();
        if (replyText !== undefined) update.replyText = replyText;
        if (matchType !== undefined) update.matchType = matchType;
        if (isActive !== undefined) update.isActive = isActive;

        const rule = await AutoReplyRule.findByIdAndUpdate(id, update, { new: true });
        if (!rule) return res.status(404).json({ success: false, message: "Rule not found." });

        return res.status(200).json({ success: true, rule });
    } catch (error) {
        console.error("Error updating auto-reply rule:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

// DELETE an auto-reply rule
const deleteAutoReply = async (req, res) => {
    try {
        const { id } = req.params;
        const rule = await AutoReplyRule.findByIdAndDelete(id);
        if (!rule) return res.status(404).json({ success: false, message: "Rule not found." });

        return res.status(200).json({ success: true, message: "Rule deleted successfully." });
    } catch (error) {
        console.error("Error deleting auto-reply rule:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

module.exports = { getAutoReplies, createAutoReply, updateAutoReply, deleteAutoReply };
