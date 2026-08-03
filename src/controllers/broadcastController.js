const Broadcast = require("../models/Broadcast");
const Client = require("../models/Client");
const Lead = require("../models/Lead");
const ChatHistory = require("../models/ChatHistory");
const { sendWhatsAppTemplate } = require("../services/whatsappService");

// ─────────────────────────────────────────────────────────────────────────────
// POST /chatbot/broadcast — Launch a broadcast campaign
// ─────────────────────────────────────────────────────────────────────────────
const broadcastTemplate = async (req, res) => {
    try {
        const {
            templateName,
            language = "en_US",
            templateBodyText = "",
            recipients,          // array of phone numbers
            variableMapping,     // { "1": "lead_name" | "fixed:Hello" }
        } = req.body;

        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        if (!recipients || recipients.length === 0 || !templateName) {
            return res.status(400).json({ success: false, message: "Recipients and template name are required." });
        }

        // Clean and normalize recipient phone numbers
        const cleanRecipients = recipients
            .map(r => {
                if (typeof r === 'object' && r) return String(r.phone || r.number || '').replace(/[^0-9]/g, '');
                return String(r).replace(/[^0-9]/g, '');
            })
            .filter(p => p.length >= 8 && p.length <= 15);

        const uniqueRecipients = [...new Set(cleanRecipients)];

        if (uniqueRecipients.length === 0) {
            return res.status(400).json({ success: false, message: "No valid recipient phone numbers provided (must be 8-15 digits with country code)." });
        }

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        // Pre-fetch leads for variable mapping (if any mapping uses lead fields)
        let leadsMap = {};
        if (variableMapping) {
            const usesLeadFields = Object.values(variableMapping).some(
                v => v && !v.startsWith('fixed:')
            );
            if (usesLeadFields) {
                const leads = await Lead.find({ clientId });
                leads.forEach(lead => {
                    if (lead.phone) {
                        const cleanLeadPhone = lead.phone.replace(/[^0-9]/g, '');
                        leadsMap[cleanLeadPhone] = lead;
                    }
                });
            }
        }

        let successCount = 0;
        let failCount = 0;
        const failedNumbers = [];

        for (const phone of uniqueRecipients) {
            try {
                // Build template components with variables
                let components = null;
                if (variableMapping && Object.keys(variableMapping).length > 0) {
                    const lead = leadsMap[phone] || {};
                    const parameters = [];

                    // Sort variable keys numerically
                    const sortedKeys = Object.keys(variableMapping).sort((a, b) => Number(a) - Number(b));
                    
                    for (const key of sortedKeys) {
                        const source = variableMapping[key];
                        let value = '';

                        if (source === 'lead_name')   value = lead.name   || 'Customer';
                        else if (source === 'lead_phone')  value = lead.phone  || phone;
                        else if (source === 'lead_email')  value = lead.email  || '';
                        else if (source === 'lead_source') value = lead.source || '';
                        else if (source === 'lead_status') value = lead.status || '';
                        else if (source && source.startsWith('fixed:')) value = source.slice(6);
                        else value = '';

                        // Fallback: Meta requires non-empty parameter text
                        if (!value) value = '-';

                        parameters.push({ type: 'text', text: value });
                    }

                    if (parameters.length > 0) {
                        components = [
                            { type: 'body', parameters }
                        ];
                    }
                }

                // sendWhatsAppTemplate(recipientPhone, templateName, languageCode, components, token, phoneNumberId)
                const result = await sendWhatsAppTemplate(
                    phone,
                    templateName,
                    language,
                    components,
                    client.whatsappToken,
                    client.phoneNumberId
                );

                if (result) {
                    successCount++;

                    // ── Save sent template to ChatHistory so AI and Live Chat have full context ──
                    try {
                        let readableContent = templateBodyText;
                        if (readableContent && parameters.length > 0) {
                            parameters.forEach((param, idx) => {
                                const placeholder = new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g');
                                readableContent = readableContent.replace(placeholder, param.text);
                            });
                        }
                        const finalMessage = readableContent ? readableContent.trim() : `[Sent Template: ${templateName}]`;

                        await ChatHistory.findOneAndUpdate(
                            { phoneNumber: phone, clientId },
                            { $push: { messages: { role: "assistant", content: finalMessage } } },
                            { upsert: true, new: true }
                        );

                        const io = req.app.get("io");
                        if (io) io.to(clientId.toString()).emit("chat-updated", { phone });
                    } catch (historyErr) {
                        console.error(`Error saving broadcast chat history for ${phone}:`, historyErr.message);
                    }
                } else {
                    failCount++;
                    failedNumbers.push(phone);
                }

                // Small delay to prevent rate limit (100ms)
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                failCount++;
                failedNumbers.push(phone);
                console.error(`Broadcast failed for ${phone}:`, err.message);
            }
        }

        // Determine status
        let status = 'COMPLETED';
        if (successCount === 0 && failCount > 0) status = 'FAILED';
        else if (failCount > 0 && successCount > 0) status = 'PARTIAL_SUCCESS';

        // Save broadcast record
        await new Broadcast({
            clientId,
            templateName,
            totalRecipients: recipients.length,
            successCount,
            failedCount: failCount,
            failedNumbers,
            status,
        }).save();

        res.status(200).json({
            success: true,
            message: `Broadcast complete. Success: ${successCount}, Failed: ${failCount}`,
            successCount,
            failedCount: failCount,
        });

    } catch (error) {
        console.error("Broadcast error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /chatbot/broadcast — Broadcast history
// ─────────────────────────────────────────────────────────────────────────────
const getBroadcastHistory = async (req, res) => {
    try {
        let clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.query.clientId;
        
        const broadcasts = await Broadcast.find({ clientId }).sort({ createdAt: -1 }).limit(50);
        return res.status(200).json({ success: true, broadcasts });
    } catch (error) {
        console.error("Error fetching broadcasts:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    broadcastTemplate,
    getBroadcastHistory
};
