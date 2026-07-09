const mongoose = require("mongoose");

const broadcastSchema = new mongoose.Schema({
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    templateName: { type: String, required: true },
    totalRecipients: { type: Number, required: true },
    successCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    failedNumbers: [{ type: String }],
    status: { type: String, enum: ['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'], default: 'COMPLETED' },
}, { timestamps: true });

module.exports = mongoose.model("Broadcast", broadcastSchema);
