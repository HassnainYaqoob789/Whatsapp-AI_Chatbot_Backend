const mongoose = require('mongoose');

const moderationStatsSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true, required: true },
  guildId: { type: String, index: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  messagesSeen: { type: Number, default: 0 },
  decidedByRules: { type: Number, default: 0 },
  skippedPreFilter: { type: Number, default: 0 },
  cacheHits: { type: Number, default: 0 },
  moderationApiCalls: { type: Number, default: 0 },
  gptCalls: { type: Number, default: 0 },
  violations: { type: Number, default: 0 },
}, { timestamps: true });

// Composite unique index
moderationStatsSchema.index({ clientId: 1, guildId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('ModerationStats', moderationStatsSchema);
