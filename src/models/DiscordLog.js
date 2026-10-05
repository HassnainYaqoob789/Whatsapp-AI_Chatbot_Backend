const mongoose = require('mongoose');

const discordLogSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true, required: true },
  guildId: { type: String, index: true },
  channelId: String,
  userId: { type: String, index: true },
  username: String,
  action: { type: String, enum: ['delete', 'warn', 'timeout', 'kick', 'ban', 'flag', 'reply'], required: true },
  ruleName: String,
  strikes: Number,
  reason: String,
  dryRun: { type: Boolean, default: false },
  messageSnippet: { type: String, maxlength: 200 },
}, { timestamps: true });

module.exports = mongoose.model('DiscordLog', discordLogSchema);
