// =============================================================================
// CLIENT CONTROLLER - CRUD for Managing Business Clients
// =============================================================================

const Client = require("../models/Client");
const ChatHistory = require("../models/ChatHistory");
const Lead = require("../models/Lead");
const User = require("../models/User");
const Broadcast = require("../models/Broadcast");

// List all clients
const getAllClients = async (req, res) => {
    try {
        const clients = await Client.find({}, '-whatsappToken').sort({ createdAt: -1 });
        return res.status(200).json({ success: true, clients });
    } catch (error) {
        console.error("Error fetching clients:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// Get a single client by ID
const getClientById = async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }
        return res.status(200).json({ success: true, client });
    } catch (error) {
        console.error("Error fetching client:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// Create a new client
const createClient = async (req, res) => {
    try {
        const { businessName, phoneNumberId, whatsappToken, wabaId, verifyToken, systemPrompt, leadNotificationEmail, aiModel, aiApiKey } = req.body;

        if (!businessName || !phoneNumberId || !whatsappToken || !wabaId || !systemPrompt) {
            return res.status(400).json({ 
                success: false, 
                message: "businessName, phoneNumberId, whatsappToken, wabaId, and systemPrompt are required" 
            });
        }

        // Check if phoneNumberId already exists
        const existing = await Client.findOne({ phoneNumberId });
        if (existing) {
            return res.status(409).json({ success: false, message: "A client with this Phone Number ID already exists" });
        }

        const newClient = await new Client({
            businessName,
            phoneNumberId,
            whatsappToken,
            wabaId,
            verifyToken: verifyToken || 'my_secret_verify_token_123',
            systemPrompt,
            leadNotificationEmail: leadNotificationEmail || '',
            aiModel: aiModel || 'gpt-4o-mini',
            aiApiKey: aiApiKey || '',
            useWabexQuota: true // Default all new clients to Managed Quota
        }).save();

        console.log(`New client created: ${businessName} (${phoneNumberId})`);
        return res.status(201).json({ success: true, client: newClient });

    } catch (error) {
        console.error("Error creating client:", error);
        return res.status(500).json({ success: false, message: "Failed to create client" });
    }
};

// Update an existing client
const updateClient = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const updatedClient = await Client.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedClient) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        // Invalidate Node memory cache so changes reflect instantly in webhooks
        const { invalidateClientCache } = require('../utils/clientHelper');
        invalidateClientCache(updatedClient.phoneNumberId);

        console.log(`Client updated: ${updatedClient.businessName}`);
        return res.status(200).json({ success: true, client: updatedClient });

    } catch (error) {
        console.error("Error updating client:", error);
        return res.status(500).json({ success: false, message: "Failed to update client" });
    }
};

// Delete a client
const deleteClient = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedClient = await Client.findByIdAndDelete(id);
        if (!deletedClient) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        // Invalidate Node memory cache so webhooks instantly stop
        const { invalidateClientCache } = require('../utils/clientHelper');
        invalidateClientCache(deletedClient.phoneNumberId);

        // Also delete the associated User account (Client Admin)
        await User.findOneAndDelete({ clientId: id });

        // Delete all relative data (Cascading delete)
        await ChatHistory.deleteMany({ clientId: id });
        await Lead.deleteMany({ clientId: id });
        await Broadcast.deleteMany({ clientId: id });
        
        // Fix: Also delete UsageLogs to prevent orphaned records in Super Admin analytics
        const UsageLog = require('../models/UsageLog');
        await UsageLog.deleteMany({ clientId: id });

        console.log(`Client deleted: ${deletedClient.businessName} and all relative data wiped.`);
        return res.status(200).json({ success: true, message: "Client, admin account, and all relative data deleted successfully." });

    } catch (error) {
        console.error("Error deleting client:", error);
        return res.status(500).json({ success: false, message: "Failed to delete client" });
    }
};

// Toggle client active/inactive
const toggleClient = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.findById(id);
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        client.isActive = !client.isActive;
        await client.save();

        // Invalidate cache so change reflects immediately in webhooks
        const { invalidateClientCache } = require('../utils/clientHelper');
        invalidateClientCache(client.phoneNumberId);

        console.log(`Client ${client.businessName} is now ${client.isActive ? 'ACTIVE' : 'INACTIVE'}`);
        return res.status(200).json({ success: true, client });

    } catch (error) {
        console.error("Error toggling client:", error);
        return res.status(500).json({ success: false, message: "Failed to toggle client" });
    }
};

// =============================================================================
// NEW: CLIENT ADMIN SETTINGS
// =============================================================================
const getMySettings = async (req, res) => {
    try {
        if (req.user.role !== 'CLIENT_ADMIN') {
            return res.status(403).json({ success: false, message: "Only client admins can view their settings" });
        }
        
        const client = await Client.findById(req.user.clientId).select('-whatsappToken -smtpPassword -aiApiKey');
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        return res.status(200).json({ success: true, client });
    } catch (error) {
        console.error("Error fetching settings:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch settings" });
    }
};

const updateMySettings = async (req, res) => {
    try {
        if (req.user.role !== 'CLIENT_ADMIN') {
            return res.status(403).json({ success: false, message: "Only client admins can update their settings" });
        }
        
        const { systemPrompt, leadNotificationEmail, whatsappToken, phoneNumberId, aiModel, aiApiKey, useWabexQuota, country } = req.body;
        const clientId = req.user.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (systemPrompt !== undefined) client.systemPrompt = systemPrompt;
        if (leadNotificationEmail !== undefined) client.leadNotificationEmail = leadNotificationEmail;
        if (whatsappToken !== undefined) client.whatsappToken = whatsappToken;
        if (phoneNumberId !== undefined) client.phoneNumberId = phoneNumberId;
        if (aiModel !== undefined) client.aiModel = aiModel;
        if (aiApiKey !== undefined) client.aiApiKey = aiApiKey;
        if (useWabexQuota !== undefined) client.useWabexQuota = useWabexQuota;
        if (country !== undefined) client.country = country;

        // ── Per-tenant SMTP settings ──
        const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom } = req.body;
        if (smtpHost     !== undefined) client.smtpHost     = smtpHost;
        if (smtpPort     !== undefined) client.smtpPort     = smtpPort;
        if (smtpUser     !== undefined) client.smtpUser     = smtpUser;
        if (smtpPassword !== undefined && smtpPassword !== '') client.smtpPassword = smtpPassword;
        if (smtpFrom     !== undefined) client.smtpFrom     = smtpFrom;

        await client.save();

        // ── Invalidate in-memory client cache so next webhook uses fresh data ──
        // clientCache is managed in clientHelper.js
        if (client.phoneNumberId) {
            const { invalidateClientCache } = require('../utils/clientHelper');
            invalidateClientCache(client.phoneNumberId);
        }

        // Hide sensitive fields in response
        const clientData = client.toObject();
        delete clientData.whatsappToken;
        delete clientData.smtpPassword;

        return res.status(200).json({ success: true, client: clientData, message: "Settings updated successfully" });
    } catch (error) {
        console.error("Error updating settings:", error);
        return res.status(500).json({ success: false, message: "Failed to update settings" });
    }
};

// =============================================================================
// NEW: SUPER ADMIN GLOBAL ANALYTICS
// =============================================================================
const getGlobalAnalytics = async (req, res) => {
    try {
        const totalClients = await Client.countDocuments();
        const activeClients = await Client.countDocuments({ isActive: true });
        
        // Count clients by origin
        const clientsByOrigin = await Client.aggregate([
            { $group: { _id: "$origin", count: { $sum: 1 } } }
        ]);
        
        let pluginClients = 0;
        let directClients = 0;
        clientsByOrigin.forEach(c => {
            if (c._id === 'PLUGIN') pluginClients = c.count;
            if (c._id === 'DIRECT') directClients = c.count;
        });

        // Sum token usage by origin
        const tokensByOrigin = await Client.aggregate([
            { $group: { _id: "$origin", totalTokens: { $sum: "$monthlyTokensUsed" } } }
        ]);

        let pluginTokens = 0;
        let directTokens = 0;
        tokensByOrigin.forEach(t => {
            if (t._id === 'PLUGIN') pluginTokens = t.totalTokens;
            if (t._id === 'DIRECT') directTokens = t.totalTokens;
        });

        const totalChats = await ChatHistory.countDocuments();
        
        // Count total messages by summing array lengths (approximate via aggregation)
        const messagesAgg = await ChatHistory.aggregate([
            { $project: { msgCount: { $size: "$messages" } } },
            { $group: { _id: null, total: { $sum: "$msgCount" } } }
        ]);
        const totalMessagesHandled = messagesAgg.length > 0 ? messagesAgg[0].total : 0;

        const totalLeads = await Lead.countDocuments();

        // Get top 5 clients by leads
        const topClientsAgg = await Lead.aggregate([
            { $group: { _id: "$clientId", leadsCount: { $sum: 1 } } },
            { $sort: { leadsCount: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'clients', localField: '_id', foreignField: '_id', as: 'clientInfo' } },
            { $unwind: "$clientInfo" },
            { $project: { businessName: "$clientInfo.businessName", leadsCount: 1, origin: "$clientInfo.origin" } }
        ]);

        return res.status(200).json({
            success: true,
            data: {
                totalClients,
                activeClients,
                pluginClients,
                directClients,
                pluginTokens,
                directTokens,
                totalChats,
                totalMessagesHandled,
                totalLeads,
                topClients: topClientsAgg
            }
        });
    } catch (error) {
        console.error("Error fetching global analytics:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = {
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    toggleClient,
    getMySettings,
    updateMySettings,
    getGlobalAnalytics
};
