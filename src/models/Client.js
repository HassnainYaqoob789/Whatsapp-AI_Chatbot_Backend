const mongoose = require('mongoose');

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
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);
