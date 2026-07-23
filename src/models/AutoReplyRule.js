const mongoose = require('mongoose');

const autoReplyRuleSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  keyword: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  matchType: {
    type: String,
    enum: ['exact', 'contains'],
    default: 'exact',
  },
  replyText: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, { timestamps: true });

// A client shouldn't have duplicate keywords
autoReplyRuleSchema.index({ clientId: 1, keyword: 1 }, { unique: true });

module.exports = mongoose.model('AutoReplyRule', autoReplyRuleSchema);
