// =============================================================================
// CHATBOT CONTROLLER (Multi-Client) - Core Webhook & API Logic
// =============================================================================
// Handles: Webhook verification, incoming messages, AI responses,
//          lead capture, chat history, template management.
// All operations are now CLIENT-AWARE using phone_number_id lookup.
// =============================================================================

const { generateAIResponse } = require("../services/aiService");
const { sendWhatsAppMessage, sendWhatsAppTemplate, uploadMedia, sendMediaMessage } = require("../services/whatsappService");
const ChatHistory = require("../models/ChatHistory");
const Client = require("../models/Client");
const Lead = require("../models/Lead");
const Broadcast = require("../models/Broadcast");
const AutoReplyRule = require("../models/AutoReplyRule");
const AICache = require("../models/AICache");
const { checkQuota, deductTokens } = require("../services/quotaService");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const { getClientByPhoneId, invalidateClientCache } = require("../utils/clientHelper");
const { isDuplicateMessage, addMessageToBuffer, flushMessageBuffer, getBufferCount } = require("../services/cacheService");

// Deduplication is now handled by cacheService.js
// Buffer is now handled by cacheService.js

// ─────────────────────────────────────────────
// Sanitize a template variable value per Meta rules:
// - No newline (\n) or tab (\t) characters
// - No more than 4 consecutive spaces
// - Trim leading/trailing whitespace
// ─────────────────────────────────────────────
function sanitizeVarValue(val) {
    if (!val) return '';
    return String(val)
        .replace(/[\r\n\t]/g, ' ')
        .replace(/ {5,}/g, '    ')
        .trim();
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
            const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
            if (envToken && token === envToken) {
                console.log("✅ WEBHOOK_VERIFIED (SaaS Global Webhook)");
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
    // ── Webhook Security: Verify X-Hub-Signature-256 ──
    const signature = req.headers['x-hub-signature-256'];
    const appSecret = process.env.META_APP_SECRET;
    
    if (appSecret && signature && req.rawBody) {
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', appSecret);
        const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');
        
        if (!crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(signature, 'utf8'))) {
            console.error('❌ Webhook Signature Verification Failed! Potential Attack.');
            return res.sendStatus(403);
        }
    } else if (appSecret && !signature) {
        console.warn('⚠️ Webhook received without signature.');
    }

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

                // ── Deduplication: ignore if we already processed this message_id (Cluster-Safe) ──
                if (await isDuplicateMessage(messageObj.id)) return;

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
                                        businessName: client.businessName,
                                        clientSmtp: {
                                            host: client.smtpHost,
                                            port: client.smtpPort,
                                            user: client.smtpUser,
                                            password: client.smtpPassword,
                                            from: client.smtpFrom,
                                        },
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

                    // ── Helper: Download media from Meta ──
                    const downloadMedia = async (mediaId) => {
                        const mediaUrlRes = await axios.get(`https://graph.facebook.com/v25.0/${mediaId}`, { headers: { Authorization: `Bearer ${whatsappToken}` } });
                        const downloadUrl = mediaUrlRes.data.url;
                        const mediaRes = await axios.get(downloadUrl, { headers: { Authorization: `Bearer ${whatsappToken}` }, responseType: 'arraybuffer' });
                        return Buffer.from(mediaRes.data, 'binary');
                    };

                    // ── Helper: Fetch chat history ──
                    const fetchHistory = async () => {
                        try {
                            const chatDoc = await ChatHistory.findOne({ phoneNumber: fromPhone, clientId });
                            if (chatDoc && chatDoc.messages) {
                                return chatDoc.messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
                            }
                        } catch (dbErr) { }
                        return [];
                    };

                    // ── Helper: Save reply and send ──
                    const saveAndReply = async (userMsg, aiReply) => {
                        await ChatHistory.findOneAndUpdate(
                            { phoneNumber: fromPhone, clientId },
                            { $push: { messages: { $each: [{ role: "user", content: userMsg }, { role: "assistant", content: aiReply }], $slice: -50 } } },
                            { upsert: true, new: true }
                        );
                        emitUpdate();
                        await sendWhatsAppMessage(fromPhone, aiReply, whatsappToken, phoneNumberId);
                    };

                    // ═══════════════════════════════════════
                    // 1. IMAGE PROCESSING
                    // ═══════════════════════════════════════
                    if (msgType === "image") {
                        if (client.useWabexQuota !== false) {
                            const quotaCheck = await checkQuota(clientId);
                            if (!quotaCheck.allowed) {
                                console.log(`[${client.businessName}] Quota exceeded for ${fromPhone}: ${quotaCheck.reason}`);
                                await sendWhatsAppMessage(fromPhone, `⚠️ ${quotaCheck.reason}\n\nImage processing is currently disabled due to quota limits.`, whatsappToken, phoneNumberId);
                                return;
                            }
                        }
                        try {
                            const mediaId = messageObj.image.id;
                            const caption = messageObj.image.caption || "";
                            const buffer = await downloadMedia(mediaId);
                            const mimeType = messageObj.image.mime_type || 'image/jpeg';
                            const imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

                            console.log(`[${client.businessName}] Image received from ${fromPhone}`);
                            const history = await fetchHistory();
                            const aiResult = await generateAIResponse(caption, history, systemPrompt, client, imageUrl);
                            if (aiResult.tokensUsed > 0 && client.useWabexQuota !== false) await deductTokens(clientId, aiResult.tokensUsed);
                            await saveAndReply(`[Image Received] ${caption}`, aiResult.text);
                            return;
                        } catch (mediaErr) {
                            console.error("Error processing image:", mediaErr.response?.data || mediaErr.message);
                            await sendWhatsAppMessage(fromPhone, "Sorry, I had trouble processing that image. Please try again or send a text message.", whatsappToken, phoneNumberId);
                            return;
                        }
                    }

                    // ═══════════════════════════════════════
                    // 2. VOICE NOTE / AUDIO
                    // ═══════════════════════════════════════
                    if (msgType === "audio") {
                        if (client.useWabexQuota !== false) {
                            const quotaCheck = await checkQuota(clientId);
                            if (!quotaCheck.allowed) {
                                console.log(`[${client.businessName}] Quota exceeded for ${fromPhone}: ${quotaCheck.reason}`);
                                await sendWhatsAppMessage(fromPhone, `⚠️ ${quotaCheck.reason}\n\nVoice note processing is currently disabled due to quota limits.`, whatsappToken, phoneNumberId);
                                return;
                            }
                        }
                        try {
                            const mediaId = messageObj.audio.id;
                            const mimeType = messageObj.audio.mime_type || 'audio/ogg';
                            const buffer = await downloadMedia(mediaId);
                            const audioUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

                            console.log(`[${client.businessName}] Voice note received from ${fromPhone}`);
                            const history = await fetchHistory();
                            const aiResult = await generateAIResponse("The user sent a voice message. Please listen and respond.", history, systemPrompt, client, null, audioUrl);
                            if (aiResult.tokensUsed > 0 && client.useWabexQuota !== false) await deductTokens(clientId, aiResult.tokensUsed);
                            await saveAndReply("[Voice Note Received]", aiResult.text);
                            return;
                        } catch (mediaErr) {
                            console.error("Error processing audio:", mediaErr.response?.data || mediaErr.message);
                            await sendWhatsAppMessage(fromPhone, "Sorry, I had trouble processing that voice note. Please try typing your message instead.", whatsappToken, phoneNumberId);
                            return;
                        }
                    }

                    // ═══════════════════════════════════════
                    // 3. PDF / DOCUMENT
                    // ═══════════════════════════════════════
                    if (msgType === "document") {
                        if (client.useWabexQuota !== false) {
                            const quotaCheck = await checkQuota(clientId);
                            if (!quotaCheck.allowed) {
                                console.log(`[${client.businessName}] Quota exceeded for ${fromPhone}: ${quotaCheck.reason}`);
                                await sendWhatsAppMessage(fromPhone, `⚠️ ${quotaCheck.reason}\n\nDocument processing is currently disabled due to quota limits.`, whatsappToken, phoneNumberId);
                                return;
                            }
                        }
                        try {
                            const mediaId = messageObj.document.id;
                            const docName = messageObj.document.filename || "document";
                            const mimeType = messageObj.document.mime_type || '';
                            const caption = messageObj.document.caption || "";
                            const buffer = await downloadMedia(mediaId);

                            console.log(`[${client.businessName}] Document received from ${fromPhone}: ${docName}`);

                            let extractedText = "";

                            if (mimeType === 'application/pdf' || docName.toLowerCase().endsWith('.pdf')) {
                                // Extract text from PDF using pdf-parse
                                const pdfData = await pdfParse(buffer);
                                extractedText = pdfData.text;
                                if (extractedText.length > 8000) {
                                    extractedText = extractedText.substring(0, 8000) + "\n\n[... Document truncated due to length ...]";
                                }
                            } else {
                                // For other document types, try reading as plain text
                                extractedText = buffer.toString('utf-8');
                                if (extractedText.length > 8000) {
                                    extractedText = extractedText.substring(0, 8000) + "\n\n[... Document truncated due to length ...]";
                                }
                            }

                            if (!extractedText || extractedText.trim().length === 0) {
                                await sendWhatsAppMessage(fromPhone, "Sorry, I couldn't extract any readable text from that document. It might be a scanned image PDF. Please try sending a text-based PDF.", whatsappToken, phoneNumberId);
                                return;
                            }

                            const userPrompt = caption
                                ? `The user sent a document named "${docName}" with the message: "${caption}". Here is the document content:\n\n${extractedText}`
                                : `The user sent a document named "${docName}". Here is the document content:\n\n${extractedText}`;

                            const history = await fetchHistory();
                            const aiResult = await generateAIResponse(userPrompt, history, systemPrompt, client);
                            if (aiResult.tokensUsed > 0 && client.useWabexQuota !== false) await deductTokens(clientId, aiResult.tokensUsed);
                            await saveAndReply(`[Document: ${docName}] ${caption}`, aiResult.text);
                            return;
                        } catch (mediaErr) {
                            console.error("Error processing document:", mediaErr.response?.data || mediaErr.message);
                            await sendWhatsAppMessage(fromPhone, "Sorry, I had trouble reading that document. Please try again or describe your question in text.", whatsappToken, phoneNumberId);
                            return;
                        }
                    }

                    // ═══════════════════════════════════════
                    // 4. UNSUPPORTED MEDIA
                    // ═══════════════════════════════════════
                    let replyMsg = "Sorry! I can't process this type of media yet. Please send text, images, voice notes, or PDF documents. 🙏";
                    await sendWhatsAppMessage(fromPhone, replyMsg, whatsappToken, phoneNumberId);
                    return;
                }

                // ── Handle Text Messages (Main AI Flow) ──
                const messageText = messageObj.text?.body;

                if (messageText) {
                    console.log(`[${client.businessName}] Received from ${fromPhone}: ${messageText}`);

                    // --- Message Buffering (Wait & Merge) Cluster Safe ---
                    await addMessageToBuffer(`${clientId}_${fromPhone}`, messageText, "user");

                    setTimeout(async () => {
                        try {
                            const messages = await flushMessageBuffer(`${clientId}_${fromPhone}`);
                            if (!messages || messages.length === 0) return; // Another cluster instance already processed it

                            const combinedMessage = messages.map(m => m.content).join(". ");
                            console.log(`[${client.businessName}] Processing combined from ${fromPhone}: ${combinedMessage}`);

                            // Fetch conversation history
                            let history = [];
                            try {
                                const chatDoc = await ChatHistory.findOne({ phoneNumber: fromPhone, clientId });
                                if (chatDoc) {
                                    // ═══ Meta 24-Hour Policy Window Check ═══
                                    const lastUpdated = new Date(chatDoc.updatedAt).getTime();
                                    const hoursSinceLastMessage = (Date.now() - lastUpdated) / (1000 * 60 * 60);

                                    if (hoursSinceLastMessage >= 24) {
                                        console.log(`[${client.businessName}] Meta 24-Hour window expired for ${fromPhone}. Resetting chat history.`);
                                        // Reset history in DB for this session
                                        chatDoc.messages = [];
                                        await chatDoc.save();
                                        history = [];
                                    } else if (chatDoc.messages) {
                                        // ═══ Token Optimization: Reduce context window ═══
                                        // Take only the last 6 messages (3 pairs) to keep token costs extremely low
                                        const recentMessages = chatDoc.messages.slice(-6);
                                        history = recentMessages.map(m => ({ role: m.role, content: m.content }));
                                    }
                                }
                            } catch (dbErr) {
                                console.error("Error fetching chat history:", dbErr);
                            }

                            // ═══ HYBRID ROUTING: Check AutoReplyRules FIRST (FREE) ═══
                            const lowerMsg = combinedMessage.toLowerCase().trim();
                            const autoRule = await AutoReplyRule.findOne({
                                clientId,
                                isActive: true,
                                $or: [
                                    { matchType: 'exact', keyword: lowerMsg },
                                    { matchType: 'contains', keyword: { $regex: new RegExp(lowerMsg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), $options: 'i' } }
                                ]
                            });

                            // Also check contains match (keyword inside user message)
                            let matchedRule = autoRule;
                            if (!matchedRule) {
                                const containsRules = await AutoReplyRule.find({ clientId, isActive: true, matchType: 'contains' });
                                matchedRule = containsRules.find(r => lowerMsg.includes(r.keyword));
                            }

                            if (matchedRule) {
                                console.log(`[${client.businessName}] AutoReply matched: "${matchedRule.keyword}" → FREE reply`);
                                const autoReplyText = matchedRule.replyText;

                                // Save to chat history
                                await ChatHistory.findOneAndUpdate(
                                    { phoneNumber: fromPhone, clientId },
                                    { $push: { messages: { $each: [{ role: "user", content: combinedMessage }, { role: "assistant", content: autoReplyText }], $slice: -50 } } },
                                    { upsert: true, new: true }
                                );
                                emitUpdate();
                                await sendWhatsAppMessage(fromPhone, autoReplyText, whatsappToken, phoneNumberId);
                                return; // EXIT — No AI cost!
                            }

                            // ═══ GLOBAL GREETINGS INTERCEPTOR (FREE) ═══
                            // Hardcoded interceptor for common single-word/short greetings to save tokens
                            const commonGreetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'assalamualaikum', 'salam', 'hi there'];
                            if (commonGreetings.includes(lowerMsg)) {
                                console.log(`[${client.businessName}] Global Greeting intercepted: "${lowerMsg}" → FREE reply`);
                                const greetingReply = `Hello! How can I assist you today? 😊`;

                                await ChatHistory.findOneAndUpdate(
                                    { phoneNumber: fromPhone, clientId },
                                    { $push: { messages: { $each: [{ role: "user", content: combinedMessage }, { role: "assistant", content: greetingReply }], $slice: -50 } } },
                                    { upsert: true, new: true }
                                );
                                emitUpdate();
                                await sendWhatsAppMessage(fromPhone, greetingReply, whatsappToken, phoneNumberId);
                                return; // EXIT — No AI cost!
                            }

                            // ═══ AICACHE EXACT MATCH LOOKUP (FREE) ═══
                            // Checks if this exact question was asked recently to THIS specific client's bot
                            try {
                                const cachedDoc = await AICache.findOne({ clientId, query: lowerMsg });
                                if (cachedDoc) {
                                    console.log(`[${client.businessName}] AICache Hit: Exact match found for "${lowerMsg}" → FREE reply`);
                                    const cachedReply = cachedDoc.response;

                                    await ChatHistory.findOneAndUpdate(
                                        { phoneNumber: fromPhone, clientId },
                                        { $push: { messages: { $each: [{ role: "user", content: combinedMessage }, { role: "assistant", content: cachedReply }], $slice: -50 } } },
                                        { upsert: true, new: true }
                                    );
                                    emitUpdate();
                                    await sendWhatsAppMessage(fromPhone, cachedReply, whatsappToken, phoneNumberId);
                                    return; // EXIT — No AI cost!
                                }
                            } catch (cacheErr) {
                                console.error("AICache lookup failed:", cacheErr);
                            }

                            // ═══ QUOTA CHECK: Before calling AI ═══
                            if (client.useWabexQuota !== false) {
                                const quotaCheck = await checkQuota(clientId);
                                if (!quotaCheck.allowed) {
                                    console.log(`[${client.businessName}] Quota exceeded for ${fromPhone}: ${quotaCheck.reason}`);
                                    const quotaMsg = `⚠️ ${quotaCheck.reason}\n\nBasic menu replies are still available. For AI-powered answers, please contact your administrator.`;
                                    await ChatHistory.findOneAndUpdate(
                                        { phoneNumber: fromPhone, clientId },
                                        { $push: { messages: { $each: [{ role: "user", content: combinedMessage }, { role: "assistant", content: quotaMsg }], $slice: -50 } } },
                                        { upsert: true, new: true }
                                    );
                                    emitUpdate();
                                    await sendWhatsAppMessage(fromPhone, quotaMsg, whatsappToken, phoneNumberId);
                                    return; // EXIT — Quota exceeded!
                                }
                            }

                            // ═══ AI FALLBACK: No AutoReply matched + Quota OK ═══
                            const aiResult = await generateAIResponse(combinedMessage, history, systemPrompt, client);
                            let aiReply = aiResult.text;

                            // Intercept Lead Data Tag first before caching
                            const leadMatch = aiReply.match(/\[\[LEAD_DATA:\s*(.*?)\s*\]\]/i);
                            if (leadMatch) {
                                const rawData = leadMatch[1];
                                const parts = rawData.split('|').map(s => s.trim());
                                const name = parts[0] || 'Unknown';
                                const phone = parts[1] || fromPhone;
                                const email = parts[2] || '';

                                try {
                                    await Lead.findOneAndUpdate(
                                        { phone, clientId },
                                        { $set: { name, email, source: 'WhatsApp AI' }, $setOnInsert: { clientId } },
                                        { upsert: true, new: true }
                                    );
                                    console.log(`[${client.businessName}] Lead saved: ${name} - ${phone}`);

                                    if (leadNotificationEmail) {
                                        const sendEmail = require("../utils/sendEmail");
                                        await sendEmail({
                                            to: leadNotificationEmail,
                                            subject: `New Lead (${client.businessName}): ${name}`,
                                            businessName: client.businessName,
                                            clientSmtp: {
                                                host: client.smtpHost,
                                                port: client.smtpPort,
                                                user: client.smtpUser,
                                                password: client.smtpPassword,
                                                from: client.smtpFrom,
                                            },
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

                            // Deduct tokens from client's quota (only if using Wabex Quota)
                            if (aiResult.tokensUsed > 0 && client.useWabexQuota !== false) {
                                await deductTokens(clientId, aiResult.tokensUsed);
                            }

                            // Save CLEANED AI response to Cache (Avoid repetitive token costs for exact future queries)
                            if (aiReply && aiResult.tokensUsed > 0) {
                                try {
                                    await AICache.findOneAndUpdate(
                                        { clientId, query: lowerMsg },
                                        { response: aiReply }, // Saving the cleaned reply without tags
                                        { upsert: true, new: true }
                                    );
                                } catch (cacheSaveErr) {
                                    console.error("AICache save failed:", cacheSaveErr);
                                }
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

module.exports = { verifyWebhook, handleIncomingMessage, sanitizeVarValue };
