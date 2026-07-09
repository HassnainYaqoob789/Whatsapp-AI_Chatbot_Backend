const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['SUPER_ADMIN', 'CLIENT_ADMIN'],
    required: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null, // Null for SUPER_ADMIN
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
