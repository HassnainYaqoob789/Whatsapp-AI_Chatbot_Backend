// =============================================================================
// CHATBOT CONTROLLER (Multi-Client) - Core Webhook & API Logic
// =============================================================================
// Handles: Webhook verification, incoming messages, AI responses,
//          lead capture, chat history, template management.
// All operations are now CLIENT-AWARE using phone_number_id lookup.
// =============================================================================

const { generateAIResponse } = require("../services/aiService");
const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/whatsappService");
const ChatHistory = require("../models/ChatHistory");
const Client = require("../models/Client");
const Lead = require("../models/Lead");
const Broadcast = require("../models/Broadcast");

// Global buffer for merging rapid messages from the same user
const messageBuffer = {};

// In-memory cache for client lookups (avoid DB hit on every message)
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

// ─────────────────────────────────────────────
// 1. Webhook Verification (Meta calls this GET endpoint)
// ─────────────────────────────────────────────
const verifyWebhook = async (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe") {
            // Check if any client has this verify token
            const client = await Client.findOne({ verifyToken: token });
            if (client) {
                console.log(`WEBHOOK_VERIFIED for client: ${client.businessName}`);
                return res.status(200).send(challenge);
            }
            
            // Fallback: check env variable for backward compatibility
            const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
            if (envToken && token === envToken) {
                console.log("WEBHOOK_VERIFIED (env fallback)");
                return res.status(200).send(challenge);
            }
        }
        return res.sendStatus(403);
    }
    return res.status(400).send("Missing parameters");
};

// ─────────────────────────────────────────────
// 2. Handle Incoming Messages (WhatsApp → Server)
// ─────────────────────────────────────────────
const handleIncomingMessage = async (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;

        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const value = body.entry[0].changes[0].value;
                const messageObj = value.messages[0];
                const fromPhone = messageObj.from;
                const msgType = messageObj.type;

                // ═══ MULTI-CLIENT: Identify which client this message is for ═══
                const phoneNumberId = value.metadata?.phone_number_id;
                if (!phoneNumberId) {
                    console.error("No phone_number_id in webhook payload. Ignoring.");
                    return;
                }

                const client = await getClientByPhoneId(phoneNumberId);
                if (!client) {
                    console.error(`No active client found for phone_number_id: ${phoneNumberId}. Ignoring.`);
                    return;
                }

                console.log(`[${client.businessName}] Message from ${fromPhone} (type: ${msgType})`);

                // Extract client credentials for this request
                const { whatsappToken, systemPrompt, leadNotificationEmail, _id: clientId } = client;

                // Setup Socket.io Emitter
                const io = req.app.get("io");
                const emitUpdate = () => {
                    if (io) io.to(clientId.toString()).emit("chat-updated", { phone: fromPhone });
                };

                // Check if AI is paused for this specific chat
                let chatDoc = await ChatHistory.findOne({ phoneNumber: fromPhone, clientId });
                if (!chatDoc) {
                    chatDoc = await new ChatHistory({ phoneNumber: fromPhone, clientId, isAiPaused: false }).save();
                }

                if (chatDoc.isAiPaused) {
                    console.log(`[${client.businessName}] AI is paused for ${fromPhone}. Routing to manual inbox.`);
                    let contentToSave = messageObj.text?.body || `[Received ${msgType}]`;
                    if (msgType === "button") contentToSave = `[Button Click: ${messageObj.button?.text}]`;
                    
                    await ChatHistory.findOneAndUpdate(
                        { phoneNumber: fromPhone, clientId },
                        { $push: { messages: { role: "user", content: contentToSave } } }
                    );
                    emitUpdate(); // Notify frontend
                    return;
                }
                
                // ── Handle Quick Reply Button Clicks ──
                if (msgType === "button") {
                    const buttonText = messageObj.button?.text || "Button clicked";
                    console.log(`[${client.businessName}] Button clicked by ${fromPhone}: ${buttonText}`);

                    let replyMsg = "";
                    if (buttonText.toLowerCase().includes("yes") || buttonText.toLowerCase().includes("contact")) {
                        try {
                            const existingLead = await Lead.findOne({ phone: fromPhone, clientId });
                            const hasRealDetails = existingLead && existingLead.name && existingLead.name !== 'WhatsApp Lead' && existingLead.email;

                            if (hasRealDetails) {
                                replyMsg = "That's great to hear! 🎉\n\nThank you for your interest. Our sales team has been notified and will contact you shortly to schedule your free demo.\n\nIn the meantime, feel free to ask me any questions about our services! 😊";
                                
                                if (leadNotificationEmail) {
                                    const sendEmail = require("../utils/sendEmail");
                                    await sendEmail({
                                        to: leadNotificationEmail,
                                        subject: `🔥 HOT Lead! Customer Wants Demo - ${existingLead.name}`,
                                        html: `
                                            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                                                <h2 style="color: #28a745;">🔥 HOT Lead Alert! (${client.businessName})</h2>
                                                <p>A customer clicked <b>"Yes, Contact Me"</b> on the follow-up template!</p>
                                                <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 500px;">
                                                    <tr><td style="background-color: #f8f9fa; font-weight: bold;">Business</td><td>${client.businessName}</td></tr>
                                                    <tr><td style="background-color: #f8f9fa; font-weight: bold;">Name</td><td>${existingLead.name}</td></tr>
                                                    <tr><td style="background-color: #f8f9fa; font-weight: bold;">WhatsApp</td><td><a href="https://wa.me/${fromPhone.replace(/[^0-9]/g, '')}">${fromPhone}</a></td></tr>
                                                    <tr><td style="background-color: #f8f9fa; font-weight: bold;">Email</td><td>${existingLead.email || 'N/A'}</td></tr>
                                                    <tr><td style="background-color: #f8f9fa; font-weight: bold;">Priority</td><td style="color: red; font-weight: bold;">🔴 HIGH</td></tr>
                                                </table>
                                            </div>
                                        `
                                    });
                                }
                            } else {
                                replyMsg = "That's great to hear! 🎉\n\nTo help our sales team schedule your free demo, could you please provide your *Name* and *Email address*?";
                                if (!existingLead) {
                                    await new Lead({ name: 'WhatsApp Lead', phone: fromPhone, source: 'WhatsApp Template - Yes Contact Me', clientId }).save();
                                }
                            }
                        } catch (e) {
                            console.error('Error in Yes Contact Me logic:', e.message);
                            replyMsg = "That's great to hear! 🎉 Our team will contact you shortly.";
                        }

                    } else if (buttonText.toLowerCase().includes("more info") || buttonText.toLowerCase().includes("info")) {
                        replyMsg = "Of course! Here's what we can do for your business:\n\n✅ *Complete Solutions* — Tailored to your needs\n✅ *Easy to Use* — Professional service in seconds\n\nWould you like to schedule a free demo? Just type *YES*! 🚀";
                        try {
                            const existingLead = await Lead.findOne({ phone: fromPhone, clientId });
                            if (!existingLead) {
                                await new Lead({ name: 'WhatsApp Lead', phone: fromPhone, source: 'WhatsApp Template - More Info', clientId }).save();
                            }
                        } catch (e) {
                            console.error('Failed to save warm lead:', e.message);
                        }

                    } else if (buttonText.toLowerCase().includes("no") || buttonText.toLowerCase().includes("thank")) {
                        replyMsg = "No problem at all! 😊\n\nWe respect your decision. Feel free to message us anytime.\n\nWishing you the best! 🙏";
                    } else {
                        replyMsg = `Thank you for your response! Our team will review and get back to you soon. 😊`;
                    }

                    // Save to chat history
                    try {
                        await ChatHistory.findOneAndUpdate(
                            { phoneNumber: fromPhone, clientId },
                            { $push: { messages: { $each: [{ role: "user", content: `[Button Click: ${buttonText}]` }, { role: "assistant", content: replyMsg }], $slice: -50 } } },
                            { upsert: true, new: true }
                        );
                        emitUpdate();
                    } catch (dbErr) {
                        console.error("Error saving button response:", dbErr);
                    }

                    await sendWhatsAppMessage(fromPhone, replyMsg, whatsappToken, phoneNumberId);
                    return;
                }

                // ── Handle Interactive Message Replies ──
                if (msgType === "interactive") {
                    const buttonReplyTitle = messageObj.interactive?.button_reply?.title || "Option selected";
                    console.log(`[${client.businessName}] Interactive reply from ${fromPhone}: ${buttonReplyTitle}`);
                }

                // ── Handle Non-Text Messages ──
                if (msgType !== "text" && msgType !== "button" && msgType !== "interactive") {
                    let replyMsg = "";
                    if (msgType === "audio") {
                        replyMsg = "Sorry! I can't process voice messages yet. 🎤❌\n\nPlease *type* your question instead. 😊";
                    } else if (msgType === "image" || msgType === "document" || msgType === "video") {
                        replyMsg = "Thanks! But I can't read files or images yet. 📎❌\n\nPlease describe your query in *text* instead. 😊";
                    } else {
                        replyMsg = "Sorry! I can only understand text messages. Please type your question. 🙏";
                    }
                    await sendWhatsAppMessage(fromPhone, replyMsg, whatsappToken, phoneNumberId);
                    return;
                }

                // ── Handle Text Messages (Main AI Flow) ──
                const messageText = messageObj.text?.body;

                if (messageText) {
                    console.log(`[${client.businessName}] Received from ${fromPhone}: ${messageText}`);

                    // --- Message Buffering (Wait & Merge) ---
                    const bufferKey = `${clientId}_${fromPhone}`;
                    if (!messageBuffer[bufferKey]) {
                        messageBuffer[bufferKey] = { messages: [], timer: null };
                    }

                    messageBuffer[bufferKey].messages.push(messageText);

                    if (messageBuffer[bufferKey].timer) {
                        clearTimeout(messageBuffer[bufferKey].timer);
                    }

                    messageBuffer[bufferKey].timer = setTimeout(async () => {
                        try {
                            const combinedMessage = messageBuffer[bufferKey].messages.join(". ");
                            console.log(`[${client.businessName}] Processing combined from ${fromPhone}: ${combinedMessage}`);
                            delete messageBuffer[bufferKey];

                            // Fetch conversation history
                            let history = [];
                            try {
                                const chatDoc = await ChatHistory.findOne({ phoneNumber: fromPhone, clientId });
                                if (chatDoc && chatDoc.messages) {
                                    const recentMessages = chatDoc.messages.slice(-10);
                                    history = recentMessages.map(m => ({ role: m.role, content: m.content }));
                                }
                            } catch (dbErr) {
                                console.error("Error fetching chat history:", dbErr);
                            }

                            // Send to AI with this client's system prompt
                            let aiReply = await generateAIResponse(combinedMessage, history, systemPrompt);

                            // Intercept Lead Data Tag
                            const leadMatch = aiReply.match(/\[\[LEAD_DATA:\s*(.*?)\s*\]\]/i);
                            if (leadMatch) {
                                const rawData = leadMatch[1];
                                const parts = rawData.split('|').map(s => s.trim());
                                const name = parts[0] || 'Unknown';
                                const phone = parts[1] || fromPhone;
                                const email = parts[2] || '';

                                try {
                                    await new Lead({ name, phone, email, source: 'WhatsApp AI', clientId }).save();
                                    console.log(`[${client.businessName}] Lead saved: ${name} - ${phone}`);

                                    if (leadNotificationEmail) {
                                        const sendEmail = require("../utils/sendEmail");
                                        await sendEmail({
                                            to: leadNotificationEmail,
                                            subject: `New Lead (${client.businessName}): ${name}`,
                                            html: `
                                                <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                                                    <h2 style="color: #0056b3;">🚀 New Lead Captured! (${client.businessName})</h2>
                                                    <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 600px;">
                                                        <tr><td style="background-color: #f8f9fa; font-weight: bold;">Business</td><td>${client.businessName}</td></tr>
                                                        <tr><td style="background-color: #f8f9fa; font-weight: bold;">Name</td><td>${name}</td></tr>
                                                        <tr><td style="background-color: #f8f9fa; font-weight: bold;">WhatsApp</td><td><a href="https://wa.me/${phone.replace(/[^0-9]/g, '')}">${phone}</a></td></tr>
                                                        <tr><td style="background-color: #f8f9fa; font-weight: bold;">Email</td><td>${email || 'Not Provided'}</td></tr>
                                                    </table>
                                                    <br><p style="font-weight: bold;">Action Required: Contact this lead immediately!</p>
                                                </div>
                                            `
                                        });
                                    }
                                } catch (e) {
                                    console.error('Failed to save lead:', e.message);
                                }

                                aiReply = aiReply.replace(/\[\[LEAD_DATA:.*?\]\]/gi, '').trim();
                            }

                            // Save conversation to MongoDB
                            try {
                                await ChatHistory.findOneAndUpdate(
                                    { phoneNumber: fromPhone, clientId },
                                    { $push: { messages: { $each: [{ role: "user", content: combinedMessage }, { role: "assistant", content: aiReply }], $slice: -50 } } },
                                    { upsert: true, new: true }
                                );
                                emitUpdate();
                            } catch (dbErr) {
                                console.error("Error saving chat history:", dbErr);
                            }

                            // Send reply via WhatsApp
                            await sendWhatsAppMessage(fromPhone, aiReply, whatsappToken, phoneNumberId);
                            
                        } catch (err) {
                            console.error("Error processing buffered message:", err);
                        }
                    }, 3000);
                }
            }
        }
    } catch (error) {
        console.error("Error handling incoming Webhook:", error);
    }
};

// ─────────────────────────────────────────────
// 3. Fetch All Chat Histories (filtered by clientId)
// ─────────────────────────────────────────────
const getAllChats = async (req, res) => {
    try {
        let clientId = req.query.clientId;
        
        // RBAC Scoping
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }

        const filter = clientId ? { clientId } : {};
        const chats = await ChatHistory.find(filter, 'phoneNumber clientId updatedAt').sort({ updatedAt: -1 });
        return res.status(200).json({ success: true, chats });
    } catch (error) {
        console.error("Error fetching all chats:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ─────────────────────────────────────────────
// 4. Fetch Specific Chat History
// ─────────────────────────────────────────────
const getChatByPhone = async (req, res) => {
    try {
        const { phone } = req.params;
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }

        const filter = { phoneNumber: phone };
        if (clientId) filter.clientId = clientId;

        const chatDoc = await ChatHistory.findOne(filter);
        if (!chatDoc) {
            return res.status(404).json({ success: false, message: "Chat not found" });
        }
        return res.status(200).json({ success: true, chat: chatDoc });
    } catch (error) {
        console.error("Error fetching chat by phone:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ─────────────────────────────────────────────
// 5. Send Template Manually
// ─────────────────────────────────────────────
const sendTemplateManually = async (req, res) => {
    try {
        const { phone, templateName } = req.body;
        let clientId = req.body.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!phone || !templateName || !clientId) {
            return res.status(400).json({ success: false, message: "phone, templateName, and clientId are required" });
        }

        const client = await Client.findById(clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        let components = req.body.components || [];
        const langCode = req.body.language || "en_US";
        
        await sendWhatsAppTemplate(phone, templateName, langCode, components, client.whatsappToken, client.phoneNumberId);

        await ChatHistory.findOneAndUpdate(
            { phoneNumber: phone, clientId },
            { $push: { messages: { $each: [{ role: "assistant", content: `[System sent Template: ${templateName}]` }], $slice: -20 } } },
            { upsert: true, new: true }
        );

        return res.status(200).json({ success: true, message: "Template sent successfully" });
    } catch (error) {
        console.error("Error sending manual template:", error);
        let errorMsg = "Failed to send template";
        if (error.response?.data?.error) errorMsg = error.response.data.error.message;
        return res.status(500).json({ success: false, message: errorMsg });
    }
};

// ─────────────────────────────────────────────
// 6. Template Management (per client)
// ─────────────────────────────────────────────
const axios = require('axios');

const getAllTemplates = async (req, res) => {
    try {
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required" });

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const url = `https://graph.facebook.com/v25.0/${client.wabaId}/message_templates`;
        const response = await axios.get(url, { headers: { "Authorization": `Bearer ${client.whatsappToken}` } });
        return res.status(200).json({ success: true, templates: response.data.data });
    } catch (error) {
        console.error("Error fetching templates:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch templates" });
    }
};

const createTemplate = async (req, res) => {
    try {
        const { name, language, category, components } = req.body;
        let clientId = req.body.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required" });

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const url = `https://graph.facebook.com/v25.0/${client.wabaId}/message_templates`;
        const payload = { name, language: language || "en_US", category: category || "MARKETING", components };

        const response = await axios.post(url, payload, {
            headers: { "Authorization": `Bearer ${client.whatsappToken}`, "Content-Type": "application/json" }
        });
        return res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        console.error("Error creating template:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: error.response?.data?.error?.message || "Failed to create template" });
    }
};

const deleteTemplate = async (req, res) => {
    try {
        const { name } = req.params;
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }
        if (!clientId) return res.status(400).json({ success: false, message: "clientId is required" });

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const url = `https://graph.facebook.com/v25.0/${client.wabaId}/message_templates?name=${name}`;
        const response = await axios.delete(url, { headers: { "Authorization": `Bearer ${client.whatsappToken}` } });
        return res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        console.error("Error deleting template:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: error.response?.data?.error?.message || "Failed to delete template" });
    }
};

// ─────────────────────────────────────────────
// 7. Get All Leads (filtered by clientId)
// ─────────────────────────────────────────────
const getLeads = async (req, res) => {
    try {
        let clientId = req.query.clientId;
        if (req.user && req.user.role === 'CLIENT_ADMIN') {
            clientId = req.user.clientId;
        }

        const filter = clientId ? { clientId } : {};
        const leads = await Lead.find(filter).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, leads });
    } catch (error) {
        console.error("Error fetching leads:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ─────────────────────────────────────────────
// 8. Toggle AI Pause (Human Handoff)
// ─────────────────────────────────────────────
const toggleAi = async (req, res) => {
    try {
        const { phone } = req.params;
        const { isAiPaused } = req.body;
        let clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        const chat = await ChatHistory.findOneAndUpdate(
            { phoneNumber: phone, clientId },
            { isAiPaused },
            { new: true }
        );

        return res.status(200).json({ success: true, chat });
    } catch (error) {
        console.error("Error toggling AI:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ─────────────────────────────────────────────
// 9. Send Manual Message (Free Text)
// ─────────────────────────────────────────────
const sendManualMessage = async (req, res) => {
    try {
        const { phone, message } = req.body;
        let clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        // Send message via Meta
        await sendWhatsAppMessage(phone, message, client.whatsappToken, client.phoneNumberId);

        // Save to history
        const chat = await ChatHistory.findOneAndUpdate(
            { phoneNumber: phone, clientId },
            { $push: { messages: { role: "assistant", content: message } } },
            { new: true }
        );

        return res.status(200).json({ success: true, chat });
    } catch (error) {
        console.error("Error sending manual message:", error.response?.data || error.message);
        return res.status(500).json({ success: false, message: "Failed to send message. Ensure you are within the 24-hour window." });
    }
};

// ─────────────────────────────────────────────
// 10. Get Analytics (Meta Graph API)
// ─────────────────────────────────────────────
const getAnalytics = async (req, res) => {
    try {
        let clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;
        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        // Calculate start and end times for the last 30 days
        const end = Math.floor(Date.now() / 1000);
        const start = end - (30 * 24 * 60 * 60);

        const url = `https://graph.facebook.com/v25.0/${client.wabaId}/conversation_analytics?start=${start}&end=${end}&granularity=DAILY`;
        const response = await axios.get(url, { headers: { "Authorization": `Bearer ${client.whatsappToken}` } });

        return res.status(200).json({ success: true, analytics: response.data.data });
    } catch (error) {
        console.error("Error fetching analytics:", error.response?.data || error.message);
        // Fallback for testing if Meta API fails (e.g. invalid waba id)
        return res.status(200).json({ success: true, analytics: [], message: "Could not fetch from Meta API, showing 0" });
    }
};
// ─────────────────────────────────────────────
// 11. Bulk Broadcasting (Marketing Campaigns)
// ─────────────────────────────────────────────
const broadcastTemplate = async (req, res) => {
    try {
        const { templateName, language, components, recipients } = req.body;
        let clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;

        if (!templateName || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ success: false, message: "templateName and recipients array are required" });
        }

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const langCode = language || "en_US";
        const comps = components || [];

        // Create a Broadcast record
        const broadcast = new Broadcast({
            clientId,
            templateName,
            totalRecipients: recipients.length,
            successCount: 0,
            failedCount: 0,
            failedNumbers: [],
            status: 'COMPLETED' // will update if partial failure
        });

        await broadcast.save();

        let success = 0;
        let failed = 0;
        let failedNumbers = [];

        // Loop over recipients and send synchronously (fine for small lists)
        for (const phone of recipients) {
            try {
                // Ensure phone format is clean
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                if (!cleanPhone) continue;

                await sendWhatsAppTemplate(cleanPhone, templateName, langCode, comps, client.whatsappToken, client.phoneNumberId);
                
                // Add to chat history
                await ChatHistory.findOneAndUpdate(
                    { phoneNumber: cleanPhone, clientId },
                    { $push: { messages: { $each: [{ role: "assistant", content: `[Broadcast Template: ${templateName}]` }], $slice: -20 } } },
                    { upsert: true, new: true }
                );

                success++;
            } catch (err) {
                console.error(`Broadcast failed for ${phone}:`, err.response?.data || err.message);
                failed++;
                failedNumbers.push(phone);
            }
        }

        // Update broadcast record
        broadcast.successCount = success;
        broadcast.failedCount = failed;
        broadcast.failedNumbers = failedNumbers;
        if (failed > 0 && success > 0) broadcast.status = 'PARTIAL_SUCCESS';
        if (failed > 0 && success === 0) broadcast.status = 'FAILED';
        
        await broadcast.save();

        return res.status(200).json({ 
            success: true, 
            message: `Broadcast complete. Sent: ${success}, Failed: ${failed}`,
            broadcast 
        });

    } catch (error) {
        console.error("Error in broadcast:", error);
        return res.status(500).json({ success: false, message: "Failed to process broadcast" });
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
    getAllChats,
    getChatByPhone,
    sendTemplateManually,
    getAllTemplates,
    createTemplate,
    deleteTemplate,
    getLeads,
    toggleAi,
    sendManualMessage,
    getAnalytics,
    broadcastTemplate
};
