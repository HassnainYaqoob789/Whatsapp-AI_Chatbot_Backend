const mongoose = require('mongoose');

const chatHistorySchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    index: true,
  },
  customerName: {
    type: String,
    default: "",
  },
  isAiPaused: {
    type: Boolean,
    default: false,
  },
  unreadCount: {
    type: Number,
    default: 0,
  },
  messages: [{
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    }
  }]
}, { timestamps: true });

// Compound index: same end-user can chat with different business clients
chatHistorySchema.index({ clientId: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);
