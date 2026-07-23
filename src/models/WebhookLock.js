const mongoose = require('mongoose');

const webhookLockSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 // Auto-delete after 60 seconds
  }
});

module.exports = mongoose.model('WebhookLock', webhookLockSchema);
