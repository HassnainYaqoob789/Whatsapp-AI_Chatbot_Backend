# 🤖 NARACORD AI — Multi-Tenant WhatsApp Business AI Automation Platform

A complete, production-ready WhatsApp AI Chatbot & Automation platform built with **Meta Cloud API**, **OpenAI GPT-4o-mini**, and **Google Gemini Flash**.

This chatbot automatically replies to WhatsApp messages using AI, captures leads, sends email notifications, and provides a full dashboard API for managing chats and templates.

---

## ✨ Features

| Feature | Description |
|---|---|
| **AI-Powered Replies** | Automatically responds to customer messages using Pollinations AI (Free) |
| **Multi-Language** | Dynamically mirrors the user's language (English / Roman Urdu) |
| **Message Buffering** | Waits 3 seconds to merge rapid messages before processing |
| **Chat History** | Remembers last 10 messages per user for context-aware replies |
| **Lead Capture** | AI extracts Name, Phone, Email from conversations and saves to DB |
| **Email Alerts** | Sends instant email to sales team when a new lead is captured |
| **Template Management** | Create, delete, and send WhatsApp templates via API |
| **Button Click Handling** | Processes Quick Reply button clicks from templates |
| **Media Rejection** | Gracefully handles voice notes, images, and videos with helpful replies |
| **Dashboard API** | REST API endpoints for building a chat inbox dashboard |

---

## 📁 Project Structure

```
Whatsapp-AI-Chatbot/
├── server.js                          # Entry point
├── package.json
├── .env                               # Environment variables (not in git)
├── .env.example                       # Template for env variables
├── .gitignore
├── README.md
└── src/
    ├── controllers/
    │   └── chatbotController.js       # Main webhook & API logic
    ├── models/
    │   ├── ChatHistory.js             # Chat history schema
    │   └── Lead.js                    # Lead capture schema
    ├── routes/
    │   └── chatbotRoutes.js           # API route definitions
    ├── services/
    │   ├── aiService.js               # Pollinations AI integration
    │   ├── systemPrompt.js            # AI brain/personality config
    │   └── whatsappService.js         # Meta WhatsApp Cloud API
    └── utils/
        └── sendEmail.js               # Email notification utility
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

### 3. Required Environment Variables
| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `WHATSAPP_TOKEN` | Meta permanent access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Phone Number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Your WABA ID |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string for webhook verification |
| `SMTP_HOST` | SMTP server for email notifications |
| `SMTP_USER` | SMTP username/email |
| `SMTP_PASSWORD` | SMTP password |
| `LEAD_NOTIFICATION_EMAIL` | Email to receive lead alerts |

### 4. Start the Server
```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

### 5. Set Up Meta Webhook
In your Meta Developer Portal → WhatsApp → Configuration:
- **Callback URL**: `https://your-domain.com/api/chatbot/webhook`
- **Verify Token**: Same value as `WHATSAPP_VERIFY_TOKEN` in your `.env`
- Subscribe to: `messages`

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/chatbot/webhook` | Meta webhook verification |
| `POST` | `/api/chatbot/webhook` | Receive incoming WhatsApp messages |
| `GET` | `/api/chatbot/chats` | Get all chat histories |
| `GET` | `/api/chatbot/chats/:phone` | Get chat history for a specific number |
| `POST` | `/api/chatbot/templates/send` | Send a template message manually |
| `GET` | `/api/chatbot/templates` | Get all Meta templates |
| `POST` | `/api/chatbot/templates` | Create a new Meta template |
| `DELETE` | `/api/chatbot/templates/:name` | Delete a Meta template |

---

## 🧠 Customizing for a New Client

To deploy this chatbot for a different business, you only need to change **2 things**:

### 1. Update `.env`
Replace all WhatsApp credentials with the new client's Meta API credentials.

### 2. Update `src/services/systemPrompt.js`
Replace the AI's identity, knowledge base, and pricing with the new client's business information. The file has clear comments showing what to change.

---

## 🛠 Tech Stack

- **Runtime**: Node.js + Express.js
- **Database**: MongoDB (Mongoose)
- **AI Engine**: Pollinations AI (100% Free, no API key needed)
- **Messaging**: Meta WhatsApp Cloud API v25.0
- **Email**: Nodemailer (SMTP)

---

## 📄 License

MIT License - Feel free to use this for any project.
