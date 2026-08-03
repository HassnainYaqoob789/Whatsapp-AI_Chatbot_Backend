// Client API Routes
// All routes are mounted under /api/clients in server.js

const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireSuperAdmin } = require("../middleware/roleMiddleware");

// --- Client Routes ---

// 1. Client Admin routes
router.get("/me/settings", authMiddleware, clientController.getMySettings);
router.put("/me/settings", authMiddleware, clientController.updateMySettings);
router.post("/me/test-smtp", authMiddleware, clientController.testSmtpConnection);

// 2. Super Admin Analytics
router.get("/analytics/global", authMiddleware, requireSuperAdmin, clientController.getGlobalAnalytics);

// 3. Super Admin Client Management
router.get("/", authMiddleware, requireSuperAdmin, clientController.getAllClients);
router.post("/", authMiddleware, requireSuperAdmin, clientController.createClient);
router.get("/:id", authMiddleware, requireSuperAdmin, clientController.getClientById);
router.put("/:id", authMiddleware, requireSuperAdmin, clientController.updateClient);
router.delete("/:id", authMiddleware, requireSuperAdmin, clientController.deleteClient);
router.patch("/:id/toggle", authMiddleware, requireSuperAdmin, clientController.toggleClient);

module.exports = router;
