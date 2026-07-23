const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  date: {
    type: String, // format YYYY-MM-DD for easy grouping
    required: true,
    index: true,
  },
  tokensUsed: {
    type: Number,
    default: 0,
  },
  audioMinutesUsed: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

// Ensure one log entry per client per day
usageLogSchema.index({ clientId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('UsageLog', usageLogSchema);
