// Discord Moderation Engine
// Order: client's dynamic rules (keywords) -> built-in checks -> optional AI judge using policy + rules.
// Returns { action: 'none'|'warn'|'delete'|'timeout'|'kick'|'ban', reason, ruleName }
const { generateAIResponse } = require('../services/aiService');
const { checkQuota, deductTokens } = require('../services/quotaService');

const NONE = { action: 'none', reason: '', ruleName: '' };

// userKey -> array of timestamps (flood detection)
const floodMap = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, arr] of floodMap) {
    if (!arr.length || arr[arr.length - 1] < cutoff) floodMap.delete(k);
  }
}, 60000).unref();

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/\w+/i;

function ruleCheck(client, message) {
  const mod = client.discord.moderation;
  const text = (message.content || '').toLowerCase();

  // 1. Client's dynamic rules with keywords
  for (const r of client.discord.rules || []) {
    for (const k of r.keywords || []) {
      const kw = k.trim().toLowerCase();
      if (kw && text.includes(kw)) {
        return { action: r.action, reason: `Rule "${r.name}" violated (keyword: "${kw}")`, ruleName: r.name };
      }
    }
  }

  // 2. Legacy banned words list
  for (const w of mod.bannedWords || []) {
    const word = w.trim().toLowerCase();
    if (word && text.includes(word)) return { action: 'delete', reason: `Banned word: "${word}"`, ruleName: 'Banned word' };
  }

  if (INVITE_RE.test(text)) return { action: 'delete', reason: 'Unsolicited server invite link', ruleName: 'Invite spam' };

  if (message.mentions && message.mentions.users.size >= 5) {
    return { action: 'delete', reason: 'Mass mention spam', ruleName: 'Mention spam' };
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = (floodMap.get(key) || []).filter(t => now - t < 10000);
  arr.push(now);
  floodMap.set(key, arr);
  if (arr.length > (mod.spamLimit || 5)) return { action: 'delete', reason: 'Message flooding', ruleName: 'Flooding' };

  return NONE;
}

async function aiCheck(client, message) {
  const quota = await checkQuota(client._id);
  if (!quota.allowed) return NONE;

  const rules = client.discord.rules || [];
  const policy = client.discord.policy || {};
  const ruleList = rules.map((r, i) => `${i + 1}. ${r.name}: ${r.description || '(see keywords)'}`).join('\n');

  const sys = `You are a strict but fair Discord moderator for "${client.businessName}".\n` +
    (policy.terms ? `TERMS & CONDITIONS:\n${policy.terms.slice(0, 4000)}\n\n` : '') +
    (policy.privacyPolicy ? `PRIVACY POLICY:\n${policy.privacyPolicy.slice(0, 3000)}\n\n` : '') +
    (ruleList ? `COMMUNITY RULES:\n${ruleList}\n\n` : '') +
    (client.discord.moderatorPrompt ? `EXTRA INSTRUCTIONS: ${client.discord.moderatorPrompt}\n\n` : '') +
    `Judge ONLY the user message below against the rules above. Do not punish normal conversation or questions about the rules. ` +
    `Reply ONLY with JSON: {"violation":true|false,"rule":"exact rule name or empty","severity":"warn"|"delete","reason":"short reason"}.`;

  const res = await generateAIResponse(message.content.slice(0, 1000), [], sys, client);
  if (res.tokensUsed) await deductTokens(client._id, res.tokensUsed);
  try {
    const j = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    if (!j.violation) return NONE;
    const matched = rules.find(r => r.name.toLowerCase() === String(j.rule || '').toLowerCase());
    const action = matched ? matched.action : (j.severity === 'delete' ? 'delete' : 'warn');
    return { action, reason: String(j.reason || 'Policy violation').slice(0, 200), ruleName: matched ? matched.name : (j.rule || 'Policy') };
  } catch (_) { return NONE; }
}

async function evaluate(client, message) {
  const mod = client.discord.moderation;
  if (!mod.enabled || !message.content) return NONE;
  const r = ruleCheck(client, message);
  if (r.action !== 'none') return r;
  if (mod.aiClassify) {
    try { return await aiCheck(client, message); } catch (e) { console.error('[Discord] aiCheck error:', e.message); }
  }
  return NONE;
}

module.exports = { evaluate };
