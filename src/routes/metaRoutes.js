const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const authMiddleware = require('../middleware/authMiddleware');

// 1. Exchange OAuth code for Meta Access Token
router.post('/oauth/exchange', authMiddleware, metaController.exchangeToken);

// 2. Get Meta connection status for the logged-in client
router.get('/connection-status', authMiddleware, metaController.getConnectionStatus);

module.exports = router;
