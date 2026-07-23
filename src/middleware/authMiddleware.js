const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No authentication token provided.' });
        }

        const token = authHeader.replace('Bearer ', '');
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');
            
            if (!user) {
                return res.status(401).json({ success: false, message: 'Invalid token: User not found.' });
            }

            req.user = user;
            next();
        } catch (jwtError) {
            console.error("JWT Verify Error:", jwtError.message, "Token received:", token);
            return res.status(401).json({ success: false, message: 'Authentication failed. Invalid or expired token.' });
        }
    } catch (error) {
        console.error("Auth Middleware Outer Error:", error);
        return res.status(500).json({ success: false, message: 'Server error in auth middleware.' });
    }
};

module.exports = authMiddleware;
