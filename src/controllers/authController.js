const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Client = require('../models/Client');

const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = (userId) => {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
};

const generatePluginToken = (userId) => {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '3650d' }); // 10 years for WP Plugin
};

// Login for both Super Admins and Client Admins
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide email and password' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Verify if Client still exists for CLIENT_ADMIN
        if (user.role === 'CLIENT_ADMIN' && user.clientId) {
            const client = await Client.findById(user.clientId);
            if (!client) {
                // Clean up orphaned user
                await User.findByIdAndDelete(user._id);
                return res.status(401).json({ success: false, message: 'Your business account has been deleted by the Super Admin.' });
            }
        }

        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                clientId: user.clientId
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
};

// Create a Client Admin (Only Super Admin can do this)
const createClientAdmin = async (req, res) => {
    try {
        const { email, password, clientId } = req.body;

        if (!email || !password || !clientId) {
            return res.status(400).json({ success: false, message: 'Please provide email, password, and clientId' });
        }

        // Verify the client exists
        const client = await Client.findById(clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            email,
            password: hashedPassword,
            role: 'CLIENT_ADMIN',
            clientId
        });

        res.status(201).json({
            success: true,
            message: 'Client Admin created successfully',
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                clientId: user.clientId
            }
        });
    } catch (error) {
        console.error('Error creating client admin:', error);
        res.status(500).json({ success: false, message: 'Server error while creating user' });
    }
};

// Get current logged in user details
const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
};

// Public endpoint for WordPress onboarding
// NOTE: In the new Embedded Signup flow, Meta fields (phoneNumberId, wabaId, permanentToken)
// are NOT provided during registration. The client connects Meta later via "Connect with Meta" button.
// However, we still accept them for backward compatibility (if a client has them from legacy setup).
const wpOnboard = async (req, res) => {
    try {
        const { 
            businessName, 
            whatsappPhoneNumberId, 
            wabaId,
            permanentToken, 
            systemPrompt, 
            leadNotificationEmail, 
            adminEmail, 
            adminPassword,
            aiModel,
            aiApiKey,
            useWabexQuota
        } = req.body;

        // Only businessName, adminEmail, adminPassword are truly required now
        if (!businessName || !adminEmail || !adminPassword) {
            return res.status(400).json({ success: false, message: 'Please provide Business Name, Email, and Password.' });
        }

        // Check if user email already exists
        const userExists = await User.findOne({ email: adminEmail });
        
        let client;
        let user;

        if (userExists) {
            // Reconnection / Upsert Flow — update existing client
            client = await Client.findById(userExists.clientId);
            if (!client) {
                return res.status(400).json({ success: false, message: 'Your account exists but the associated business was deleted. Please contact support.' });
            }

            // Update existing client with new details from the form
            client.businessName = businessName;
            if (whatsappPhoneNumberId) client.phoneNumberId = whatsappPhoneNumberId;
            if (permanentToken) client.whatsappToken = permanentToken;
            if (wabaId) client.wabaId = wabaId;
            if (systemPrompt) client.systemPrompt = systemPrompt;
            if (leadNotificationEmail) client.leadNotificationEmail = leadNotificationEmail;
            client.aiModel = aiModel || client.aiModel;
            if (aiApiKey) client.aiApiKey = aiApiKey;
            client.useWabexQuota = useWabexQuota !== false;
            await client.save();
            user = userExists;

        } else {
            // New Registration Flow
            // If Meta fields are provided (legacy), check for duplicate phone
            if (whatsappPhoneNumberId) {
                const phoneExists = await Client.findOne({ phoneNumberId: whatsappPhoneNumberId });
                if (phoneExists) {
                    return res.status(409).json({ success: false, message: 'This WhatsApp Phone Number ID is already registered to another email. Each WhatsApp number can only be connected to one account.' });
                }
            }

            // 1. Create the Client (Meta fields are optional — will be filled via Embedded Signup later)
            client = await Client.create({
                businessName,
                phoneNumberId: whatsappPhoneNumberId || '',
                whatsappToken: permanentToken || '',
                wabaId: wabaId || '',
                systemPrompt: systemPrompt || `You are an AI assistant for ${businessName}. You help customers with their queries politely and professionally.`,
                leadNotificationEmail: leadNotificationEmail || adminEmail,
                isActive: true, 
                aiModel: aiModel || 'gpt-4o-mini',
                aiApiKey: aiApiKey || '',
                useWabexQuota: useWabexQuota !== false,
                origin: 'PLUGIN',
                metaConnected: !!(whatsappPhoneNumberId && permanentToken && wabaId),
                metaConnectedAt: (whatsappPhoneNumberId && permanentToken && wabaId) ? new Date() : undefined
            });

            // 2. Create the User (Client Admin)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(adminPassword, salt);

            user = await User.create({
                email: adminEmail,
                password: hashedPassword,
                role: 'CLIENT_ADMIN',
                clientId: client._id
            });
        }

        // 3. Generate Long-lived JWT Token for WP Plugin
        const token = generatePluginToken(user._id);

        res.status(201).json({
            success: true,
            message: 'WordPress Onboarding Successful! Client & Admin created.',
            token,
            client: {
                _id: client._id,
                businessName: client.businessName,
                phoneNumberId: client.phoneNumberId,
                wabaId: client.wabaId,
                metaConnected: client.metaConnected
            },
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                clientId: user.clientId
            }
        });
    } catch (error) {
        console.error('Error during WP onboarding:', error);
        res.status(500).json({ success: false, message: 'Server error during onboarding' });
    }
};

// Public endpoint for WordPress passwordless login (re-linking)
// NOTE: whatsappPhoneNumberId is now optional since new clients may not have connected Meta yet.
const wpLoginEmail = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Please provide your registered email to reconnect.' });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'No account found with this email. Please register first.' });
        }

        // Verify user is a CLIENT_ADMIN (not a Super Admin trying to use plugin login)
        if (user.role !== 'CLIENT_ADMIN') {
            return res.status(403).json({ success: false, message: 'This login is only for client accounts.' });
        }

        // Find associated client
        const client = await Client.findById(user.clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Your business account was not found. Please contact support.' });
        }
        
        // Generate Long-lived JWT Token
        const token = generatePluginToken(user._id);

        res.status(200).json({
            success: true,
            message: 'Login Successful! Account re-linked.',
            token,
            client: {
                _id: client._id,
                businessName: client.businessName,
                phoneNumberId: client.phoneNumberId,
                wabaId: client.wabaId,
                metaConnected: client.metaConnected
            },
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                clientId: user.clientId
            }
        });

    } catch (error) {
        console.error('Error during WordPress email login:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
};

module.exports = {
    login,
    createClientAdmin,
    getMe,
    wpOnboard,
    wpLoginEmail
};
