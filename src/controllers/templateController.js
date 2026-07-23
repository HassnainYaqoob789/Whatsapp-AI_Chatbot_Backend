const ChatHistory = require("../models/ChatHistory");
const Client = require("../models/Client");
const { sendWhatsAppTemplate } = require("../services/whatsappService");
const axios = require("axios");

const sendTemplateManually = async (req, res) => {
    try {
        const { to, templateName, variables } = req.body;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        if (!to || !templateName) {
            return res.status(400).json({ success: false, message: "Recipient and template name are required" });
        }

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const result = await sendWhatsAppTemplate(to, templateName, client.whatsappToken, client.phoneNumberId, variables);
        
        if (result && result.messages) {
            let content = `[Sent Template: ${templateName}]`;
            if (variables && variables.length > 0) {
                content += ` with variables: ${variables.join(', ')}`;
            }

            await ChatHistory.findOneAndUpdate(
                { phoneNumber: to, clientId },
                { $push: { messages: { role: "assistant", content } } },
                { upsert: true, new: true }
            );

            const io = req.app.get("io");
            if (io) io.to(clientId.toString()).emit("chat-updated", { phone: to });

            return res.status(200).json({ success: true, message: "Template sent successfully!" });
        } else {
            return res.status(400).json({ success: false, message: "Failed to send template. Check Meta logs." });
        }
    } catch (error) {
        console.error("Manual template error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

const getAllTemplates = async (req, res) => {
    try {
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;
        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (!client.wabaId || !client.whatsappToken) {
            return res.status(400).json({ success: false, message: "WABA ID or Token is missing in client settings." });
        }

        const response = await axios.get(`https://graph.facebook.com/v21.0/${client.wabaId}/message_templates`, {
            headers: { Authorization: `Bearer ${client.whatsappToken}` }
        });

        res.status(200).json({ success: true, templates: response.data.data });
    } catch (error) {
        console.error("Error fetching templates:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Failed to fetch templates from Meta" });
    }
};

const createTemplate = async (req, res) => {
    try {
        const { name, category, language, components } = req.body;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const payload = {
            name,
            category,
            language: language || "en_US",
            components
        };

        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${client.wabaId}/message_templates`,
            payload,
            { headers: { Authorization: `Bearer ${client.whatsappToken}`, "Content-Type": "application/json" } }
        );

        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        console.error("Error creating template:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.error?.message || "Failed to create template" });
    }
};

const deleteTemplate = async (req, res) => {
    try {
        const { name } = req.params;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        await axios.delete(`https://graph.facebook.com/v21.0/${client.wabaId}/message_templates?name=${name}`, {
            headers: { Authorization: `Bearer ${client.whatsappToken}` }
        });

        res.status(200).json({ success: true, message: "Template deleted" });
    } catch (error) {
        console.error("Error deleting template:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Failed to delete template" });
    }
};

module.exports = {
    sendTemplateManually,
    getAllTemplates,
    createTemplate,
    deleteTemplate
};
