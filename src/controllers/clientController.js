// =============================================================================
// CLIENT CONTROLLER - CRUD for Managing Business Clients
// =============================================================================

const Client = require("../models/Client");
const ChatHistory = require("../models/ChatHistory");
const Lead = require("../models/Lead");

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
        const { businessName, phoneNumberId, whatsappToken, wabaId, verifyToken, systemPrompt, leadNotificationEmail } = req.body;

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

        console.log(`Client deleted: ${deletedClient.businessName}`);
        return res.status(200).json({ success: true, message: "Client deleted successfully" });

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
        
        const client = await Client.findById(req.user.clientId).select('-whatsappToken');
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
        
        const { systemPrompt, leadNotificationEmail, whatsappToken } = req.body;
        const clientId = req.user.clientId;

        const client = await Client.findById(clientId);
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (systemPrompt !== undefined) client.systemPrompt = systemPrompt;
        if (leadNotificationEmail !== undefined) client.leadNotificationEmail = leadNotificationEmail;
        if (whatsappToken !== undefined) client.whatsappToken = whatsappToken;

        await client.save();
        
        // Hide token in response
        const clientData = client.toObject();
        delete clientData.whatsappToken;

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
            { $project: { businessName: "$clientInfo.businessName", leadsCount: 1 } }
        ]);

        return res.status(200).json({
            success: true,
            data: {
                totalClients,
                activeClients,
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
