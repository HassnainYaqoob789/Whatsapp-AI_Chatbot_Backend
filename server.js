// Main Server Entry Point for WhatsApp AI Chatbot
// This is a standalone, reusable WhatsApp AI Chatbot server.

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const chatbotRoutes = require("./src/routes/chatbotRoutes");
const clientRoutes = require("./src/routes/clientRoutes");
const authRoutes = require("./src/routes/authRoutes");
const seedSuperAdmin = require("./src/utils/seedSuperAdmin");

const app = express();
const PORT = process.env.PORT || 9999;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp-ai-chatbot";
mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log("✅ MongoDB Connected Successfully");
        await seedSuperAdmin();
    })
    .catch((err) => {
        console.error("❌ MongoDB Connection Error:", err.message);
        process.exit(1);
    });

// --- Routes ---
// Health Check
app.get("/", (req, res) => {
    res.json({ status: "ok", message: "WhatsApp AI Chatbot Server is Running! 🤖" });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// All chatbot routes under /api/chatbot
app.use("/api/chatbot", chatbotRoutes);

// Client management routes
app.use("/api/clients", clientRoutes);

// --- Server Setup with Socket.io ---
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Pass io to routes/controllers if needed (using app.set)
app.set("io", io);

io.on("connection", (socket) => {
    console.log("🟢 Client connected to Socket.io:", socket.id);
    
    // Clients will join a room based on their clientId so they only get their own messages
    socket.on("join-client-room", (clientId) => {
        socket.join(clientId);
        console.log(`Socket ${socket.id} joined room: ${clientId}`);
    });

    socket.on("disconnect", () => {
        console.log("🔴 Client disconnected:", socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 WhatsApp AI Chatbot Server running on port ${PORT}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/api/chatbot/webhook`);
    console.log(`💬 Chat API:    http://localhost:${PORT}/api/chatbot/chats`);
    console.log(`📋 Templates:   http://localhost:${PORT}/api/chatbot/templates\n`);
});
