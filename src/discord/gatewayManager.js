// Gateway Manager - runs the shared Naracord bot + optional per-client custom bots.
const { Client: DiscordClient, GatewayIntentBits, Partials } = require('discord.js');
const Client = require('../models/Client');
const { handleMessage } = require('./messageHandler');
const { decrypt } = require('./crypto');

let shared = null;
const customBots = new Map(); // clientId -> discord.js client

function build() {
  return new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
  });
}

function wire(bot, mode) {
  bot.once('clientReady', () => console.log(`🤖 Discord ${mode} bot online as ${bot.user.tag}`));
  bot.on('messageCreate', (msg) => {
    handleMessage(msg, bot.user, mode).catch(e => console.error('[Discord] handler error:', e.message));
  });
  bot.on('error', (e) => console.error(`[Discord:${mode}] error:`, e.message));
}

async function startShared() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.log('ℹ️ DISCORD_BOT_TOKEN not set — Discord shared bot disabled.'); return; }
  shared = build();
  wire(shared, 'shared');
  try { await shared.login(token); } catch (e) { console.error('❌ Discord shared login failed:', e.message); shared = null; }
}

async function startCustom(clientId, token) {
  await stopCustom(clientId);
  const bot = build();
  wire(bot, 'custom');
  await bot.login(token); // throws on invalid token
  customBots.set(String(clientId), bot);
  return bot;
}

async function stopCustom(clientId) {
  const b = customBots.get(String(clientId));
  if (b) { await b.destroy(); customBots.delete(String(clientId)); }
}

async function startAll() {
  await startShared();
  try {
    const clients = await Client.find({ isActive: true, 'channels.discord': true, 'discord.botMode': 'custom' })
      .select('+discord.customBotToken');
    for (const c of clients) {
      if (!c.discord.customBotToken) continue;
      try { await startCustom(c._id, decrypt(c.discord.customBotToken)); }
      catch (e) { console.error(`[Discord] custom bot for ${c.businessName} failed:`, e.message); }
    }
  } catch (e) { console.error('[Discord] startAll error:', e.message); }
}

// Used by settings UI to list text channels of the connected server
async function listChannels(client) {
  const bot = client.discord.botMode === 'custom' ? customBots.get(String(client._id)) : shared;
  if (!bot) return [];
  const guild = await bot.guilds.fetch(client.discord.guildId).catch(() => null);
  if (!guild) return [];
  const chans = await guild.channels.fetch();
  return [...chans.values()].filter(c => c && c.isTextBased() && !c.isThread())
    .map(c => ({ id: c.id, name: c.name }));
}

async function leaveGuild(client) {
  const bot = client.discord.botMode === 'custom' ? customBots.get(String(client._id)) : shared;
  if (!bot || !client.discord.guildId) return;
  const guild = await bot.guilds.fetch(client.discord.guildId).catch(() => null);
  if (guild && client.discord.botMode === 'shared') await guild.leave().catch(() => {});
}

module.exports = { startAll, startCustom, stopCustom, listChannels, leaveGuild };
