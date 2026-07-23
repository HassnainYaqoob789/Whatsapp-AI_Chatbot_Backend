const mongoose = require('mongoose');

const messageBufferSchema = new mongoose.Schema({
  clientId: {
    type: String,
    required: true,
    index: true
  },
  role: {
    type: String,
    required: true,
    default: "user"
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 180 // Auto-delete after 180 seconds to prevent DB bloat if flush fails
  }
});

module.exports = mongoose.model('MessageBuffer', messageBufferSchema);
