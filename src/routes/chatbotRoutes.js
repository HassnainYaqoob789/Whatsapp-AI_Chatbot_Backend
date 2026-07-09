// Chatbot API Routes
// All routes are mounted under /api/chatbot in server.js

const express = require("express");
const router = express.Router();
const chatbotController = require("../controllers/chatbotController");
const authMiddleware = require("../middleware/authMiddleware");

// --- Webhook (Meta WhatsApp) ---
router.get("/webhook", chatbotController.verifyWebhook);
router.post("/webhook", chatbotController.handleIncomingMessage);

// --- Dashboard Chat APIs ---
router.get("/chats", authMiddleware, chatbotController.getAllChats);
router.get("/chats/:phone", authMiddleware, chatbotController.getChatByPhone);

// --- Template Management ---
router.post("/templates/send", authMiddleware, chatbotController.sendTemplateManually);
router.get("/templates", authMiddleware, chatbotController.getAllTemplates);
router.post("/templates", authMiddleware, chatbotController.createTemplate);
router.delete("/templates/:name", authMiddleware, chatbotController.deleteTemplate);

// --- Broadcasts (Marketing) ---
router.post("/broadcast", authMiddleware, chatbotController.broadcastTemplate);

// --- Leads Management ---
router.get("/leads", authMiddleware, chatbotController.getLeads);

// --- Manual Chat & AI Handoff ---
router.patch("/chats/:phone/toggle-ai", authMiddleware, chatbotController.toggleAi);
router.post("/chats/send-message", authMiddleware, chatbotController.sendManualMessage);

// --- Analytics ---
router.get("/analytics", authMiddleware, chatbotController.getAnalytics);

module.exports = router;
