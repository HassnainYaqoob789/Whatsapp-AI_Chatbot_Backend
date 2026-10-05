require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-ai-chatbot');
  const cs = await mongoose.connection.db.collection('clients').find({}, { projection: { businessName: 1, systemPrompt: 1, 'discord.guildId': 1 } }).toArray();
  cs.forEach(c => console.log(c._id.toString(), '|', c.businessName, '| guild=', c.discord && c.discord.guildId, '\n   PROMPT:', (c.systemPrompt || '').slice(0, 120).replace(/\n/g, ' ')));
  process.exit(0);
})();
