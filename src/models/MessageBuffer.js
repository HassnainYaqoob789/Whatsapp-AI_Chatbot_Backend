const mongoose = require('mongoose');

const messageBufferSchema = new mongoose.Schema({
  clientId: {
    type: String,
    required: true,
    unique: true // Exactly one document per client/phone combo
  },
  messages: [{
    role: { type: String, required: true },
    content: { type: String, required: true },
    timestamp: { type: Number, required: true }
  }],
  updatedAt: {
    type: Date,
    default: Date.now,
    expires: 180 // Auto-delete doc after 3 minutes of inactivity
  }
});

module.exports = mongoose.model('MessageBuffer', messageBufferSchema);
