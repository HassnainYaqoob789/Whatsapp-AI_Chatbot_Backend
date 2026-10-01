const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const UsageLog = require('./src/models/UsageLog');
const MessageBuffer = require('./src/models/MessageBuffer');
const Lead = require('./src/models/Lead');
const ChatHistory = require('./src/models/ChatHistory');
const Broadcast = require('./src/models/Broadcast');
const AutoReplyRule = require('./src/models/AutoReplyRule');
const AICache = require('./src/models/AICache');

const clientId = '6abcb6f78fad4b91494bcd09'; // FinSmart Digital Invoicing

async function clearData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to DB.");

        const res1 = await ChatHistory.deleteMany({ clientId });
        console.log("Deleted ChatHistory:", res1.deletedCount);

        const res2 = await Lead.deleteMany({ clientId });
        console.log("Deleted Leads:", res2.deletedCount);

        const res3 = await MessageBuffer.deleteMany({ clientId });
        console.log("Deleted MessageBuffer:", res3.deletedCount);

        const res4 = await UsageLog.deleteMany({ clientId });
        console.log("Deleted UsageLog:", res4.deletedCount);

        const res5 = await AICache.deleteMany({ clientId });
        console.log("Deleted AICache:", res5.deletedCount);

        const res6 = await Broadcast.deleteMany({ clientId });
        console.log("Deleted Broadcasts:", res6.deletedCount);

        const res7 = await AutoReplyRule.deleteMany({ clientId });
        console.log("Deleted AutoReplyRules:", res7.deletedCount);

        console.log("✅ All data cleared for tenant:", clientId);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

clearData();
