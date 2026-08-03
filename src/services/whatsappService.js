// WhatsApp Cloud API Service (Multi-Client)
// All functions accept token & phoneNumberId as parameters
// so each call uses the correct client's credentials.

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

// --- Send a simple text message ---
async function sendWhatsAppMessage(recipientPhone, messageText, token, phoneNumberId) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "text",
            text: { body: messageText }
        };

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        await axios.post(url, data, { headers });
        console.log(`Message successfully sent to ${recipientPhone}`);

    } catch (error) {
        console.error("Error sending WhatsApp message:");
        if (error.response) {
            console.error(error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

// --- Send emoji reaction to a message ---
async function sendReaction(recipientPhone, messageId, emoji = "⏳", token, phoneNumberId) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientPhone,
            type: "reaction",
            reaction: { message_id: messageId, emoji: emoji }
        };

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        await axios.post(url, data, { headers });
        console.log(`Reaction ${emoji} sent to ${recipientPhone}`);
    } catch (error) {
        console.error("Failed to send reaction.");
    }
}

// --- Send typing indicator ---
async function sendTypingIndicator(messageId, token, phoneNumberId) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            status: "read",
            message_id: messageId,
            typing_indicator: { type: "text" }
        };

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        await axios.post(url, data, { headers });
        console.log(`Typing indicator sent for message: ${messageId}`);

    } catch (error) {
        console.error("Failed to send typing indicator.");
    }
}

// --- Send interactive button message ---
async function sendInteractiveButtons(recipientPhone, bodyText, buttons, token, phoneNumberId) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: bodyText },
                action: {
                    buttons: buttons.map((btn, index) => ({
                        type: "reply",
                        reply: { id: btn.id || `btn_${index}`, title: btn.title }
                    }))
                }
            }
        };

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        await axios.post(url, data, { headers });
        console.log(`Interactive buttons sent to ${recipientPhone}`);

    } catch (error) {
        console.error("Error sending Interactive message:", error.response ? error.response.data : error.message);
    }
}

// --- Fetch WABA Analytics ---
async function getWhatsAppAnalytics(token, wabaId) {
    try {
        if (!wabaId) {
            throw new Error("WABA ID is required for analytics.");
        }

        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const start = Math.floor(lastMonth.getTime() / 1000);
        const end = Math.floor(today.getTime() / 1000);

        const url = `https://graph.facebook.com/v25.0/${wabaId}/conversation_analytics`;
        const params = { start, end, granularity: "DAILY" };

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        const response = await axios.get(url, { headers, params });
        return response.data;
    } catch (error) {
        console.error("Error fetching analytics:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// --- Send a pre-approved Template message ---
async function sendWhatsAppTemplate(recipientPhone, templateName, languageCode = "en_US", components = null, token, phoneNumberId) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "template",
            template: {
                name: templateName,
                language: { code: languageCode }
            }
        };

        if (components && components.length > 0) {
            data.template.components = components;
        }

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        await axios.post(url, data, { headers });
        console.log(`Template '${templateName}' sent to ${recipientPhone}`);
        return true;
    } catch (error) {
        console.error("Error sending WhatsApp template:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// --- Upload media to Meta ---
async function uploadMedia(filePath, mimeType, token, phoneNumberId, originalname) {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/media`;
        const form = new FormData();
        
        // Meta API requires a valid filename with an extension for media uploads.
        // Multer removes extensions by default, so we must explicitly provide the original filename.
        if (originalname) {
            form.append("file", fs.createReadStream(filePath), { filename: originalname, contentType: mimeType });
        } else {
            form.append("file", fs.createReadStream(filePath));
        }
        
        form.append("type", mimeType);
        form.append("messaging_product", "whatsapp");

        const headers = {
            "Authorization": `Bearer ${token}`,
            ...form.getHeaders()
        };

        const response = await axios.post(url, form, { headers });
        return response.data.id;
    } catch (error) {
        console.error("Error uploading media:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// --- Send media message ---
async function sendMediaMessage(recipientPhone, mediaId, mediaType, token, phoneNumberId, caption = "", filename = "") {
    try {
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
        
        // mediaType can be 'image', 'document', 'audio', 'video'
        const data = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: mediaType,
            [mediaType]: { id: mediaId }
        };
        
        if (caption && (mediaType === 'image' || mediaType === 'document' || mediaType === 'video')) {
            data[mediaType].caption = caption;
        }
        if (filename && mediaType === 'document') {
            data[mediaType].filename = filename;
        }

        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        const response = await axios.post(url, data, { headers });
        console.log(`Media ${mediaId} sent to ${recipientPhone}`);
        return response.data;
    } catch (error) {
        console.error("Error sending media message:", error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = {
    sendWhatsAppMessage,
    sendReaction,
    sendTypingIndicator,
    sendInteractiveButtons,
    getWhatsAppAnalytics,
    sendWhatsAppTemplate,
    uploadMedia,
    sendMediaMessage
};
