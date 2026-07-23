const mongoose = require('mongoose'); // Touched to force nodemon restart

const clientSchema = new mongoose.Schema({
  businessName: {
    type: String,
    required: true,
    trim: true,
  },
  phoneNumberId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  whatsappToken: {
    type: String,
    required: true,
  },
  wabaId: {
    type: String,
    required: true,
  },
  verifyToken: {
    type: String,
    default: 'my_secret_verify_token_123',
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
  useWabexQuota: {
    type: Boolean,
    default: true,
  },
  origin: {
    type: String,
    enum: ['PLUGIN', 'DIRECT'],
    default: 'DIRECT',
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
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);
