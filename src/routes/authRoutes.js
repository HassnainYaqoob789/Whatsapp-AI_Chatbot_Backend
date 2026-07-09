const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/roleMiddleware');

router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.getMe);
router.post('/create-client-admin', authMiddleware, requireSuperAdmin, authController.createClientAdmin);

module.exports = router;
