const axios = require('axios');
const Client = require('../models/Client');
const { invalidateClientCache } = require('../utils/clientHelper');

// Exchange authorization code for a long-lived Access Token
const exchangeToken = async (req, res) => {
    try {
        const { code } = req.body;
        const clientId = req.user.clientId; // from authMiddleware

        if (!code) {
            return res.status(400).json({ success: false, message: 'Missing required fields from Meta (code).' });
        }

        const client = await Client.findById(clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client not found.' });
        }

        const appId = process.env.META_APP_ID;
        const appSecret = (process.env.META_APP_SECRET || '').split(',')[0].trim();

        if (!appId || !appSecret) {
            return res.status(500).json({ success: false, message: 'Server configuration missing (App ID or App Secret).' });
        }

        // 1. Exchange Code for Access Token
        console.log(`[${client.businessName}] Exchanging code for Meta Access Token...`);
        const tokenResponse = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
            params: {
                client_id: appId,
                client_secret: appSecret,
                code: code
            }
        });

        const accessToken = tokenResponse.data.access_token;

        // 2. Fetch WABA ID
        console.log(`[${client.businessName}] Fetching WhatsApp Business Account ID...`);
        const wabaRes = await axios.get(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const wabaId = wabaRes.data.data?.[0]?.id;
        if (!wabaId) {
             throw new Error("Could not find a WhatsApp Business Account linked to this token.");
        }

        // 3. Fetch Phone Number ID
        console.log(`[${client.businessName}] Fetching Phone Number ID for WABA ${wabaId}...`);
        const phoneRes = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/phone_numbers`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const phoneNumberId = phoneRes.data.data?.[0]?.id;
        if (!phoneNumberId) {
             throw new Error("Could not find a phone number for the WhatsApp Business Account.");
        }

        // 4. Subscribe Webhook (Attach Naracord AI to their WABA)
        console.log(`[${client.businessName}] Subscribing webhook to WABA ${wabaId}...`);
        try {
            await axios.post(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, null, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
        } catch (webhookErr) {
            console.error('Webhook subscription warning:', webhookErr.response?.data || webhookErr.message);
        }

        // 5. Save to Client document
        client.whatsappToken = accessToken;
        client.wabaId = wabaId;
        client.phoneNumberId = phoneNumberId;
        client.metaConnected = true;
        client.metaConnectedAt = new Date();
        
        await client.save();

        // Invalidate cache so new token is used for sending messages
        invalidateClientCache(client.phoneNumberId);

        console.log(`[${client.businessName}] Meta connection successful!`);
        return res.status(200).json({ success: true, message: 'Meta connection successful!' });

    } catch (error) {
        console.error('Meta Exchange Error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to connect with Meta.' });
    }
};

// Check if client has a valid Meta connection
const getConnectionStatus = async (req, res) => {
    try {
        const client = await Client.findById(req.user.clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client not found.' });
        }

        return res.status(200).json({ 
            success: true, 
            metaConnected: client.metaConnected || false,
            metaConnectedAt: client.metaConnectedAt || null
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
};

module.exports = { exchangeToken, getConnectionStatus };
