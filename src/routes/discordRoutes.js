// Discord routes - mounted at /api/discord
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const router = express.Router();
const Client = require('../models/Client');
const DiscordLog = require('../models/DiscordLog');
const authMiddleware = require('../middleware/authMiddleware');
const gateway = require('../discord/gatewayManager');
const ModerationStats = require('../models/ModerationStats');
const { invalidateTenant } = require('../discord/messageHandler');
const { encrypt } = require('../discord/crypto');
const { generateAIResponse } = require('../services/aiService');

// View Channels + Send Messages + Manage Messages + Read History + Send in Threads + Kick + Ban + Moderate Members(timeout)
const PERMISSIONS = '1374389611526';

function getClientId(req) {
  return req.user.role === 'CLIENT_ADMIN' ? req.user.clientId : (req.query.clientId || req.body.clientId);
}
const redirectUri = () => process.env.DISCORD_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:8888'}/api/discord/callback`;
const frontend = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// 1. Client clicks "Add to Discord" -> frontend calls this, gets URL, redirects browser
router.get('/connect-url', authMiddleware, (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID) return res.status(503).json({ success: false, message: 'Discord is not configured on the server.' });
  const clientId = getClientId(req);
  const state = jwt.sign({ clientId, purpose: 'discord' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID, permissions: PERMISSIONS,
    scope: 'bot applications.commands', response_type: 'code',
    redirect_uri: redirectUri(), state,
  });
  res.json({ success: true, url });
});

// 2. Discord redirects here after the server owner approves
router.get('/callback', async (req, res) => {
  const { code, state, guild_id, error } = req.query;
  if (error) return res.redirect(`${frontend()}/client/settings?discord=denied`);
  try {
    const { clientId } = jwt.verify(state, process.env.JWT_SECRET);
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const guild = tokenRes.data.guild || { id: guild_id, name: '' };
    const gid = guild.id || guild_id;
    if (!gid) throw new Error('No guild returned');

    const taken = await Client.findOne({ 'discord.guildId': gid, _id: { $ne: clientId } });
    if (taken) return res.redirect(`${frontend()}/client/settings?discord=already_linked`);

    await Client.findByIdAndUpdate(clientId, {
      'channels.discord': true, 'discord.guildId': gid, 'discord.guildName': guild.name || '',
      'discord.botMode': 'shared', 'discord.connectedAt': new Date(),
    });
    invalidateTenant(gid);
    res.redirect(`${frontend()}/client/settings?discord=connected`);
  } catch (e) {
    console.error('[Discord] callback error:', e.response?.data || e.message);
    res.redirect(`${frontend()}/client/settings?discord=error`);
  }
});

// 3. Get settings
router.get('/settings', authMiddleware, async (req, res) => {
  const client = await Client.findById(getClientId(req)).select('channels discord businessName');
  if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
  res.json({ success: true, channels: client.channels, discord: client.discord });
});

// 4. Update settings (whitelist fields)
router.put('/settings', authMiddleware, async (req, res) => {
  try {
    const b = req.body;
    const set = {};
    if (typeof b.enabled === 'boolean') set['channels.discord'] = b.enabled;
    if (Array.isArray(b.allowedChannelIds)) set['discord.allowedChannelIds'] = b.allowedChannelIds.map(String);
    if (typeof b.modLogChannelId === 'string') set['discord.modLogChannelId'] = b.modLogChannelId;
    if (typeof b.moderatorPrompt === 'string') set['discord.moderatorPrompt'] = b.moderatorPrompt.slice(0, 2000);
    const m = b.moderation || {};
    if (typeof m.enabled === 'boolean') set['discord.moderation.enabled'] = m.enabled;
    if (typeof m.dryRun === 'boolean') set['discord.moderation.dryRun'] = m.dryRun;
    if (typeof m.aiMode === 'string') set['discord.moderation.aiMode'] = m.aiMode;
    // Legacy mapping just in case old UI sends it
    if (typeof m.aiClassify === 'boolean' && !m.aiMode) set['discord.moderation.aiMode'] = m.aiClassify ? 'smart' : 'off';
    
    // Cost optimizations
    if (Array.isArray(m.trustedRoleIds)) set['discord.moderation.trustedRoleIds'] = m.trustedRoleIds.map(String);
    if (Array.isArray(m.exemptChannelIds)) set['discord.moderation.exemptChannelIds'] = m.exemptChannelIds.map(String);
    if (typeof m.scanOnlyNewMembers === 'boolean') set['discord.moderation.scanOnlyNewMembers'] = m.scanOnlyNewMembers;
    if (Number.isInteger(m.newMemberDays)) set['discord.moderation.newMemberDays'] = Math.max(m.newMemberDays, 1);
    if (Number.isInteger(m.aiChecksPerMinute)) set['discord.moderation.aiChecksPerMinute'] = Math.max(m.aiChecksPerMinute, 1);

    if (Array.isArray(m.bannedWords)) set['discord.moderation.bannedWords'] = m.bannedWords.map(w => String(w).trim()).filter(Boolean).slice(0, 200);
    if (Number.isInteger(m.spamLimit)) set['discord.moderation.spamLimit'] = Math.min(Math.max(m.spamLimit, 2), 30);
    if (m.actions) {
      for (const k of ['delete', 'warn', 'timeout', 'kick', 'ban']) {
        if (typeof m.actions[k] === 'boolean') set[`discord.moderation.actions.${k}`] = m.actions[k];
      }
    }
    if (m.escalation) {
      const e = m.escalation;
      if (Number.isInteger(e.strikeLimit)) set['discord.moderation.escalation.strikeLimit'] = Math.min(Math.max(e.strikeLimit, 1), 20);
      if (Number.isInteger(e.windowDays)) set['discord.moderation.escalation.windowDays'] = Math.min(Math.max(e.windowDays, 1), 90);
      if (['none', 'timeout', 'kick', 'ban'].includes(e.action)) set['discord.moderation.escalation.action'] = e.action;
      if (Number.isInteger(e.timeoutMinutes)) set['discord.moderation.escalation.timeoutMinutes'] = Math.min(Math.max(e.timeoutMinutes, 1), 40320);
    }
    let policyChanged = false;
    if (b.policy) {
      if (typeof b.policy.privacyPolicy === 'string') {
        set['discord.policy.privacyPolicy'] = b.policy.privacyPolicy.slice(0, 20000);
        policyChanged = true;
      }
      if (typeof b.policy.terms === 'string') {
        set['discord.policy.terms'] = b.policy.terms.slice(0, 20000);
        policyChanged = true;
      }
    }
    if (Array.isArray(b.rules)) {
      set['discord.rules'] = b.rules.slice(0, 50).map(r => ({
        name: String(r.name || '').slice(0, 80),
        description: String(r.description || '').slice(0, 500),
        keywords: Array.isArray(r.keywords) ? r.keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 100) : [],
        action: ['warn', 'delete', 'timeout', 'kick', 'ban'].includes(r.action) ? r.action : 'delete',
      })).filter(r => r.name);
    }
    const client = await Client.findByIdAndUpdate(getClientId(req), { $set: set }, { new: true });
    
    // Auto-generate a short policy digest if it changed
    if (policyChanged && client) {
      const combined = `${client.discord.policy.terms}\n\n${client.discord.policy.privacyPolicy}`.trim();
      if (combined.length > 50) {
        try {
          const sys = `You are a summarizer. Extract the most important community rules and moderation constraints from the text below. Output exactly as a concise bulleted list (max 10 bullets). Do not include filler text.`;
          const res = await generateAIResponse(combined.slice(0, 10000), [], sys, client, null, null, { temperature: 0, maxTokens: 400 });
          client.discord.policy.digest = res.text;
          await client.save();
        } catch (e) { console.error('[Discord] failed to generate policy digest', e.message); }
      } else {
        client.discord.policy.digest = '';
        await client.save();
      }
    }

    if (client?.discord?.guildId) invalidateTenant(client.discord.guildId);
    res.json({ success: true, discord: client.discord, channels: client.channels });
  } catch (e) {
    console.error(e); res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// 5. Channel list (for dropdowns)
router.get('/channels', authMiddleware, async (req, res) => {
  const client = await Client.findById(getClientId(req));
  if (!client?.discord?.guildId) return res.status(400).json({ success: false, message: 'Discord not connected.' });
  res.json({ success: true, channels: await gateway.listChannels(client) });
});

// 6. Custom bot token (optional)
router.post('/custom-bot', authMiddleware, async (req, res) => {
  const { token, guildId } = req.body;
  if (!token || !guildId) return res.status(400).json({ success: false, message: 'token and guildId are required.' });
  const clientId = getClientId(req);
  try {
    const taken = await Client.findOne({ 'discord.guildId': guildId, _id: { $ne: clientId } });
    if (taken) return res.status(409).json({ success: false, message: 'This server is already linked to another account.' });
    await gateway.startCustom(clientId, token);
    const client = await Client.findByIdAndUpdate(clientId, {
      'channels.discord': true, 'discord.botMode': 'custom', 'discord.guildId': guildId,
      'discord.customBotToken': encrypt(token), 'discord.connectedAt': new Date(),
    }, { new: true });
    invalidateTenant(guildId);
    res.json({ success: true, discord: client.discord });
  } catch (e) {
    res.status(400).json({ success: false, message: 'Invalid bot token or login failed.' });
  }
});

// 7. Disconnect
router.post('/disconnect', authMiddleware, async (req, res) => {
  const clientId = getClientId(req);
  const client = await Client.findById(clientId);
  if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
  const gid = client.discord.guildId;
  await gateway.leaveGuild(client).catch(() => {});
  await gateway.stopCustom(clientId);
  await Client.findByIdAndUpdate(clientId, {
    'channels.discord': false, 'discord.guildId': '', 'discord.guildName': '',
    'discord.customBotToken': '', 'discord.botMode': 'shared',
  });
  if (gid) invalidateTenant(gid);
  res.json({ success: true });
});

// 8. Moderation log
router.get('/logs', authMiddleware, async (req, res) => {
  const logs = await DiscordLog.find({ clientId: getClientId(req) }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, logs });
});

module.exports = router;

// 9. Moderation Stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const dateStr = since.toISOString().split('T')[0];

    const stats = await ModerationStats.find({ 
      clientId: getClientId(req),
      date: { $gte: dateStr }
    });

    let totalSeen = 0, byRules = 0, skipped = 0, cached = 0, modApi = 0, gpt = 0, violations = 0;
    stats.forEach(s => {
      totalSeen += s.messagesSeen;
      byRules += s.decidedByRules;
      skipped += s.skippedPreFilter;
      cached += s.cacheHits;
      modApi += s.moderationApiCalls;
      gpt += s.gptCalls;
      violations += s.violations;
    });

    // Assume average 500 tokens per GPT call, standard API cost
    const estimatedGptCost = (gpt * 500) / 1000000 * 0.150; // gpt-4o-mini price

    // Without optimizations, everything goes to GPT with a huge prompt (e.g. 2500 tokens)
    const naiveCost = (totalSeen - byRules) * 2500 / 1000000 * 0.150;

    res.json({
      success: true,
      summary: {
        days,
        messagesSeen: totalSeen,
        decidedByRules: byRules,
        skippedPreFilter: skipped,
        cacheHits: cached,
        moderationApiCalls: modApi,
        gptCalls: gpt,
        violations,
        percentHandledFree: totalSeen ? Math.round(((totalSeen - gpt) / totalSeen) * 100) : 100,
        estimatedGptCost,
        estimatedSavings: Math.max(0, naiveCost - estimatedGptCost)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});
