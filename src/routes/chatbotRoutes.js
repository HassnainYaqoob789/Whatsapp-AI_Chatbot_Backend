// Chatbot API Routes
// All routes are mounted under /api/chatbot in server.js

const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhookController");
const messageController = require("../controllers/messageController");
const templateController = require("../controllers/templateController");
const broadcastController = require("../controllers/broadcastController");
const analyticsController = require("../controllers/analyticsController");
const authMiddleware = require("../middleware/authMiddleware");

// --- Webhook (Meta WhatsApp) ---
router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", webhookController.handleIncomingMessage);

// --- Dashboard Chat APIs ---
router.get("/chats", authMiddleware, messageController.getAllChats);
router.get("/chats/:phone", authMiddleware, messageController.getChatByPhone);

// --- Template Management ---
router.post("/templates/send", authMiddleware, templateController.sendTemplateManually);
router.get("/templates", authMiddleware, templateController.getAllTemplates);
router.post("/templates", authMiddleware, templateController.createTemplate);
router.delete("/templates/:name", authMiddleware, templateController.deleteTemplate);

// --- Broadcasts (Marketing) ---
router.post("/broadcast", authMiddleware, broadcastController.broadcastTemplate);
router.get("/broadcast", authMiddleware, broadcastController.getBroadcastHistory);

// --- Leads Management ---
router.get("/leads", authMiddleware, analyticsController.getLeads);

// --- Manual Chat & AI Handoff ---
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

router.patch("/chats/:phone/toggle-ai", authMiddleware, messageController.toggleAi);
router.post("/chats/send-message", authMiddleware, messageController.sendManualMessage);
router.post("/chats/send-media", authMiddleware, upload.single("media"), messageController.sendManualMedia);

// --- Analytics ---
router.get("/analytics", authMiddleware, analyticsController.getAnalytics);

// --- Auto Reply Rules (Hybrid Chatbot) ---
const autoReplyController = require("../controllers/autoReplyController");
router.get("/auto-replies", authMiddleware, autoReplyController.getAutoReplies);
router.post("/auto-replies", authMiddleware, autoReplyController.createAutoReply);
router.put("/auto-replies/:id", authMiddleware, autoReplyController.updateAutoReply);
router.delete("/auto-replies/:id", authMiddleware, autoReplyController.deleteAutoReply);

// --- Quota & Usage Management ---
const quotaController = require("../controllers/quotaController");
router.get("/quota", authMiddleware, quotaController.getMyQuota);
router.put("/quota/limits", authMiddleware, quotaController.updateQuotaLimits);
router.get("/quota/usage-report", authMiddleware, quotaController.getUsageReport);

module.exports = router;
