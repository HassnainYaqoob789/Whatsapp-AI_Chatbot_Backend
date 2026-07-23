const Broadcast = require("../models/Broadcast");
const Client = require("../models/Client");
const { sendWhatsAppTemplate } = require("../services/whatsappService");

const broadcastTemplate = async (req, res) => {
    try {
        const { audience, templateName, variables } = req.body;
        const clientId = req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : req.body.clientId;

        if (!audience || audience.length === 0 || !templateName) {
            return res.status(400).json({ success: false, message: "Audience and template name are required." });
        }

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        let successCount = 0;
        let failCount = 0;

        for (const phone of audience) {
            try {
                const result = await sendWhatsAppTemplate(phone, templateName, client.whatsappToken, client.phoneNumberId, variables);
                if (result && result.messages) {
                    successCount++;
                } else {
                    failCount++;
                }
                
                // Small delay to prevent rate limit (100ms)
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                failCount++;
                console.error(`Broadcast failed for ${phone}:`, err.message);
            }
        }

        // Save broadcast record
        await new Broadcast({
            clientId,
            templateName,
            audienceCount: audience.length,
            successCount,
            failCount
        }).save();

        res.status(200).json({
            success: true,
            message: `Broadcast complete. Success: ${successCount}, Failed: ${failCount}`
        });

    } catch (error) {
        console.error("Broadcast error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

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
