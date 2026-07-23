// Main Server Entry Point for WhatsApp AI Chatbot
// This is a standalone, reusable WhatsApp AI Chatbot server.

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").default; // .default is required for rate-limit-redis v3+
const { redisClient } = require("./src/services/redisService");

// ── Security guard: refuse to start without a real JWT_SECRET ──
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    console.error('❌ FATAL: JWT_SECRET is not set in .env file.');
    console.error('   Add a long random string: JWT_SECRET=your_64_char_random_secret_here');
    process.exit(1);
}

const chatbotRoutes = require("./src/routes/chatbotRoutes");
const clientRoutes = require("./src/routes/clientRoutes");
const authRoutes = require("./src/routes/authRoutes");
const seedSuperAdmin = require("./src/utils/seedSuperAdmin");

const app = express();
const PORT = process.env.PORT || 9999;

// --- Middleware ---
// CORS: allow origins from env var (comma-separated list) or localhost in development
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'http://localhost:3000', 
        'http://localhost:5173',
        'http://localhost',
        'http://127.0.0.1',
        'http://localhost:80'
      ];

app.use(cors({
    origin: (origin, callback) => {
        // Since this is a SaaS, we allow plugins from any domain, but enforce security via JWT and Rate Limiting
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// Global Rate Limiter backed by Redis for PM2/Cluster consistency
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    standardHeaders: true, 
    legacyHeaders: false, 
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
    message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});

// Apply to all API routes
app.use("/api/", globalLimiter);

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
const { createAdapter } = require("@socket.io/redis-adapter");

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Configure Redis Adapter for PM2 Cluster consistency
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

// Since we use ioredis, duplicate() creates connected clients automatically.
io.adapter(createAdapter(pubClient, subClient));
console.log("✅ Socket.io Redis Adapter Configured (Cluster-Safe Sockets)");

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
