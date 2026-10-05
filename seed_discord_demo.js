// Seeds a standalone "Naracord Discord Demo" client (NOT linked to FinSmart) and links the test server to it.
// Usage: node seed_discord_demo.js
require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./src/models/Client');
const { Client: D, GatewayIntentBits } = require('discord.js');

const TERMS = `NARACORD DEMO COMMUNITY - TERMS & CONDITIONS
1. Be respectful. No harassment, hate speech, threats or bullying of any member.
2. No spam: no repeated messages, flooding, or mass mentions.
3. No advertising or promoting other servers/products without staff permission. Invite links are not allowed.
4. No scams, phishing, or malicious links. Never ask members for passwords or payment details.
5. No sharing of other people's private information (doxxing), including phone numbers, addresses or ID numbers.
6. No explicit, violent or illegal content.
7. Staff decisions are final. Repeated violations lead to a timeout, then removal from the server.
Enforcement: each violation is a strike. 3 strikes within 7 days result in removal (kick). Severe violations may result in an immediate kick or ban.`;

const PRIVACY = `NARACORD DEMO COMMUNITY - PRIVACY POLICY
- We only process the messages you post in this server to provide support and keep the community safe.
- Messages are analysed by an AI moderator to detect rule violations. They are NOT used to train AI models.
- Moderation logs (user ID, short message excerpt, reason, action) are kept for 90 days.
- We never sell or share your data with third parties.
- You can ask staff to delete your moderation data at any time.
- Do not share personal or financial information in public channels.`;

const RULES = [
  { name: 'Hate & Harassment', description: 'Insults, slurs, threats, bullying or hate speech toward any person or group.', keywords: [], action: 'delete' },
  { name: 'Scam & Phishing', description: 'Scam offers, phishing links, requests for passwords/OTP/payment details, fake giveaways.', keywords: ['free nitro', 'send otp', 'send your password'], action: 'kick' },
  { name: 'Advertising', description: 'Promoting other servers, products, services or channels without permission.', keywords: ['dm me for service', 'join my server'], action: 'delete' },
  { name: 'Doxxing', description: 'Sharing someone else\'s private information such as phone number, address or ID.', keywords: [], action: 'ban' },
];

(async () => {
  const bot = new D({ intents: [GatewayIntentBits.Guilds] });
  await bot.login(process.env.DISCORD_BOT_TOKEN);
  await new Promise(r => setTimeout(r, 3000));
  const g = [...bot.guilds.cache.values()].find(x => x.name === 'Naracord Test');
  await bot.destroy();
  if (!g) { console.log('Bot is not in "Naracord Test" server.'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-ai-chatbot');

  // Unlink from the FinSmart demo account
  await Client.updateMany({ 'discord.guildId': g.id }, { $set: { 'discord.guildId': '', 'discord.guildName': '', 'channels.discord': false } });

  let c = await Client.findOne({ businessName: 'Naracord Discord Demo' });
  if (!c) c = new Client({ businessName: 'Naracord Discord Demo' });
  c.systemPrompt = 'You are the friendly assistant and moderator of the "Naracord Demo Community" Discord server. Help members with questions about the community, its Terms & Conditions and Privacy Policy. Be concise and polite. If you do not know something, say so and suggest contacting staff.';
  c.channels = { whatsapp: false, discord: true };
  c.discord = {
    guildId: g.id, guildName: g.name, botMode: 'shared', connectedAt: new Date(),
    allowedChannelIds: [], modLogChannelId: '', moderatorPrompt: '',
    policy: { privacyPolicy: PRIVACY, terms: TERMS },
    rules: RULES,
    moderation: {
      enabled: true, dryRun: false, bannedWords: [], spamLimit: 5, aiClassify: true,
      actions: { delete: true, warn: true, timeout: true, kick: true, ban: false },
      escalation: { strikeLimit: 3, windowDays: 7, action: 'kick', timeoutMinutes: 60 },
    },
  };
  await c.save();
  console.log('DEMO CLIENT READY:', c._id.toString(), '-> guild', g.id);
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
