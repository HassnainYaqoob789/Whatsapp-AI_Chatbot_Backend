const mongoose = require('mongoose'); // Touched to force nodemon restart

const clientSchema = new mongoose.Schema({
  businessName: {
    type: String,
    required: true,
    trim: true,
  },
  phoneNumberId: {
    type: String,
    default: '',
    index: true,
    sparse: true,
  },
  whatsappToken: {
    type: String,
    default: '',
  },
  wabaId: {
    type: String,
    default: '',
  },

  systemPrompt: {
    type: String,
    required: true,
  },
  leadNotificationEmail: {
    type: String,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  aiModel: {
    type: String,
    enum: ['gpt-4o-mini', 'gpt-4o', 'gemini-flash'],
    default: 'gpt-4o-mini',
  },
  aiApiKey: {
    type: String,
    default: '',
  },
  useNaracordQuota: {
    type: Boolean,
    default: true,
  },
  origin: {
    type: String,
    enum: ['PLUGIN', 'DIRECT'],
    default: 'DIRECT',
  },
  metaConnected: {
    type: Boolean,
    default: false,
  },
  metaConnectedAt: {
    type: Date,
  },
  country: {
    type: String,
    default: 'Pakistan',
  },
  // ── Quota & Billing Fields ──
  monthlyTokenLimit: {
    type: Number,
    default: 500000, // Default 500k tokens per month
  },
  monthlyTokensUsed: {
    type: Number,
    default: 0,
  },
  billingCycleStartDate: {
    type: Date,
    default: Date.now,
  },
  dailyTokenLimit: {
    type: Number,
    default: 15000, // Default 15k tokens per day
  },
  dailyTokensUsed: {
    type: Number,
    default: 0,
  },
  dailyResetTime: {
    type: Date,
    default: Date.now, // Will be reset at midnight logic
  },
  // ── Per-tenant SMTP for lead notification emails ──
  smtpHost: {
    type: String,
    default: '',
  },
  smtpPort: {
    type: Number,
    default: 465,
  },
  smtpUser: {
    type: String,
    default: '',
  },
  smtpPassword: {
    type: String,
    default: '',
  },
  smtpFrom: {
    type: String,
    default: '',
  },
  // ── Welcome Menu Configuration (Interactive Buttons on First Message) ──
  welcomeMessage: {
    type: String,
    default: '',  // If empty, uses default: "Welcome to {businessName}! 👋\n\nHow can we help you today?"
  },
  welcomeButtons: {
    type: [{
      id: { type: String, required: true },
      title: { type: String, required: true }
    }],
    default: [],  // If empty, uses defaults: Learn More, Pricing & Plans, Talk to Team
  },
  // ── Dynamic Lead Capture (SaaS) ──
  leadCaptureFields: {
    type: [{
      label: { type: String, required: true },
      key: { type: String, required: true },
      required: { type: Boolean, default: false }
    }],
    default: [],
  },
  // ── Universal External Webhook/API (For SaaS Onboarding & Integrations) ──
  externalApiUrl: {
    type: String,
    default: '',
  },
  externalApiKey: {
    type: String,
    default: '',
  },
  // ── Channels (WhatsApp is on by default; Discord is opt-in) ──
  channels: {
    whatsapp: { type: Boolean, default: true },
    discord: { type: Boolean, default: false },
  },
  // ── Discord AI Moderator Configuration ──
  discord: {
    guildId: { type: String, default: '', index: true },
    guildName: { type: String, default: '' },
    botMode: { type: String, enum: ['shared', 'custom'], default: 'shared' },
    customBotToken: { type: String, default: '', select: false }, // AES-encrypted
    allowedChannelIds: { type: [String], default: [] }, // empty = all channels
    modLogChannelId: { type: String, default: '' },
    moderatorPrompt: { type: String, default: '' },
    // Community Privacy Policy & Terms - used to answer questions AND to judge violations
    policy: {
      privacyPolicy: { type: String, default: '' },
      terms: { type: String, default: '' },
      // Compact AI-generated summary of terms/privacy used by the moderation judge (saves tokens per message)
      digest: { type: String, default: '' },
    },
    // Dynamic rules set by the client: keywords and/or plain-language description (AI judged)
    rules: {
      type: [{
        name: { type: String, required: true },
        description: { type: String, default: '' },
        keywords: { type: [String], default: [] },
        action: { type: String, enum: ['warn', 'delete', 'timeout', 'kick', 'ban'], default: 'delete' },
      }],
      default: [],
    },
    moderation: {
      enabled: { type: Boolean, default: true },
      dryRun: { type: Boolean, default: true }, // log-only until client turns it off
      bannedWords: { type: [String], default: [] },
      spamLimit: { type: Number, default: 5 }, // msgs per 10s per user
      aiClassify: { type: Boolean, default: false }, // legacy - superseded by aiMode
      // off = rules only | smart = layered pipeline (recommended) | strict = every eligible message to GPT
      aiMode: { type: String, enum: ['off', 'smart', 'strict'], default: 'smart' },
      // ── Cost & performance controls ──
      trustedRoleIds: { type: [String], default: [] },   // members with these roles skip AI scans
      exemptChannelIds: { type: [String], default: [] }, // channels never AI-scanned
      scanOnlyNewMembers: { type: Boolean, default: false },
      newMemberDays: { type: Number, default: 7 },
      aiChecksPerMinute: { type: Number, default: 30 },  // per-guild GPT circuit breaker
      actions: {
        delete: { type: Boolean, default: true },
        warn: { type: Boolean, default: true },
        timeout: { type: Boolean, default: true },
        kick: { type: Boolean, default: true },
        ban: { type: Boolean, default: false },
      },
      // After N strikes inside windowDays, apply `action` automatically
      escalation: {
        strikeLimit: { type: Number, default: 3 },
        windowDays: { type: Number, default: 7 },
        action: { type: String, enum: ['none', 'timeout', 'kick', 'ban'], default: 'kick' },
        timeoutMinutes: { type: Number, default: 60 },
      },
    },
    connectedAt: { type: Date },
  },
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);
