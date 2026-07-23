const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/roleMiddleware');
const rateLimit = require('express-rate-limit');

// ── Rate limiter for passwordless WP login — max 5 attempts per IP per 15 min ──
const wpLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});

// ── Rate limiter for onboarding — max 3 new accounts per IP per hour ──
const wpOnboardLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many registration attempts. Please try again in 1 hour.' }
});

router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.getMe);
router.post('/create-client-admin', authMiddleware, requireSuperAdmin, authController.createClientAdmin);
router.post('/wp-onboard', wpOnboardLimiter, authController.wpOnboard);
router.post('/wp-login-email', wpLoginLimiter, authController.wpLoginEmail);

module.exports = router;
