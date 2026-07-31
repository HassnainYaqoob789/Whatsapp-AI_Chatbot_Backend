const ChatHistory = require("../models/ChatHistory");
const Client = require("../models/Client");
const { sendWhatsAppMessage, uploadMedia, sendMediaMessage } = require("../services/whatsappService");
const fs = require("fs");
const mongoose = require('mongoose');

const getAllChats = async (req, res) => {
    try {
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;
        const chats = await ChatHistory.find({ clientId }).sort({ updatedAt: -1 });
        res.status(200).json({ success: true, chats });
    } catch (error) {
        console.error("Error fetching chats:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const getChatByPhone = async (req, res) => {
    try {
        const { phone } = req.params;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        // Total messages count for pagination metadata
        const chatStats = await ChatHistory.aggregate([
            { $match: { phoneNumber: phone, clientId: new mongoose.Types.ObjectId(clientId) } },
            { $project: { totalMessages: { $size: "$messages" } } }
        ]);

        const totalMessages = chatStats.length > 0 ? chatStats[0].totalMessages : 0;
        
        // Calculate skip from the end for reverse pagination
        // If page 1, limit 50 => slice: [-50, 50] (if total > 50)
        let sliceArgs;
        if (totalMessages <= limit) {
            sliceArgs = totalMessages; // Get all if less than limit
        } else {
            let skipFromEnd = page * limit;
            let take = limit;
            
            if (skipFromEnd > totalMessages) {
                // If we request past the total, adjust take
                take = limit - (skipFromEnd - totalMessages);
                skipFromEnd = totalMessages;
            }
            
            sliceArgs = take > 0 ? [-skipFromEnd, take] : 0;
        }

        const chat = await ChatHistory.findOne(
            { phoneNumber: phone, clientId },
            sliceArgs !== 0 ? { messages: { $slice: sliceArgs } } : { messages: 0 }
        );

        if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });
        
        res.status(200).json({ 
            success: true, 
            chat,
            pagination: {
                totalMessages,
                page,
                limit,
                hasMore: (page * limit) < totalMessages
            }
        });
    } catch (error) {
        console.error("Error fetching chat:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const toggleAi = async (req, res) => {
    try {
        const { phone } = req.params;
        const { isAiPaused } = req.body;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        const chat = await ChatHistory.findOneAndUpdate(
            { phoneNumber: phone, clientId },
            { isAiPaused },
            { new: true }
        );
        res.status(200).json({ success: true, chat });
    } catch (error) {
        console.error("Error toggling AI:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const sendManualMessage = async (req, res) => {
    try {
        const { to, message } = req.body;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (!client.metaConnected || !client.whatsappToken || !client.phoneNumberId) {
            return res.status(400).json({ success: false, message: "Please connect your WhatsApp account first via the Settings page." });
        }

        const result = await sendWhatsAppMessage(to, message, client.whatsappToken, client.phoneNumberId);
        
        if (result && result.messages) {
            await ChatHistory.findOneAndUpdate(
                { phoneNumber: to, clientId },
                { $push: { messages: { role: "assistant", content: message } } },
                { upsert: true }
            );

            const io = req.app.get("io");
            if (io) io.to(clientId.toString()).emit("chat-updated", { phone: to });

            return res.status(200).json({ success: true, message: "Message sent" });
        }
        res.status(400).json({ success: false, message: "Failed to send message" });
    } catch (error) {
        console.error("Manual message error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const sendManualMedia = async (req, res) => {
    try {
        const { to, caption } = req.body;
        const file = req.file;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        if (!to || !file) {
            return res.status(400).json({ success: false, message: "Recipient and media file are required" });
        }

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (!client.metaConnected || !client.whatsappToken || !client.phoneNumberId) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, message: "Please connect your WhatsApp account first via the Settings page." });
        }

        const mediaId = await uploadMedia(file.path, file.mimetype, client.whatsappToken, client.phoneNumberId);
        const msgType = file.mimetype.startsWith('image') ? 'image' : 'document';
        const result = await sendMediaMessage(to, mediaId, msgType, caption, client.whatsappToken, client.phoneNumberId);

        fs.unlinkSync(file.path);

        if (result && result.messages) {
            const contentToSave = `[Sent Media: ${file.originalname}] ${caption ? '- ' + caption : ''}`;
            await ChatHistory.findOneAndUpdate(
                { phoneNumber: to, clientId },
                { $push: { messages: { role: "assistant", content: contentToSave } } },
                { upsert: true }
            );

            const io = req.app.get("io");
            if (io) io.to(clientId.toString()).emit("chat-updated", { phone: to });

            return res.status(200).json({ success: true, message: "Media sent" });
        }
        res.status(400).json({ success: false, message: "Failed to send media" });
    } catch (error) {
        console.error("Manual media error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    getAllChats,
    getChatByPhone,
    toggleAi,
    sendManualMessage,
    sendManualMedia
};
