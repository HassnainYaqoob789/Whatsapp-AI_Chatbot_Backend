const mongoose = require('mongoose');

const aiCacheSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  query: {
    type: String,
    required: true,
  },
  response: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 172800 // TTL Index: Documents automatically delete after 48 hours (48 * 60 * 60)
  }
});

// Compound index to quickly find a cached query for a specific client
aiCacheSchema.index({ clientId: 1, query: 1 });

module.exports = mongoose.model('AICache', aiCacheSchema);
