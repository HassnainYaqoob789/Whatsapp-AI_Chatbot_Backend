const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Client = require('../models/Client');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_123';

const generateToken = (userId) => {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
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

module.exports = {
    login,
    createClientAdmin,
    getMe
};
