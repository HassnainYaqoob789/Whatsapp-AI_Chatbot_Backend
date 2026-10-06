// Discord Moderation Engine
// Order: client's dynamic rules (keywords) -> built-in checks -> optional AI judge using policy + rules.
// Returns { action: 'none'|'warn'|'delete'|'timeout'|'kick'|'ban', reason, ruleName }
const { generateAIResponse } = require('../services/aiService');
const { checkQuota, deductTokens } = require('../services/quotaService');
const { classify, BORDERLINE_THRESHOLD } = require('../services/moderationApi');
const { shouldSkipAi } = require('./preFilter');
const { getVerdict, setVerdict } = require('./verdictCache');
const { consumeAiBudget } = require('./aiBudget');

const NONE = { action: 'none', reason: '', ruleName: '', decidedBy: 'none' };

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
        return { action: r.action, reason: `Rule "${r.name}" violated (keyword: "${kw}")`, ruleName: r.name, decidedBy: 'rules' };
      }
    }
  }

  // 2. Legacy banned words list
  for (const w of mod.bannedWords || []) {
    const word = w.trim().toLowerCase();
    if (word && text.includes(word)) return { action: 'delete', reason: `Banned word: "${word}"`, ruleName: 'Banned word', decidedBy: 'rules' };
  }

  if (INVITE_RE.test(text)) return { action: 'delete', reason: 'Unsolicited server invite link', ruleName: 'Invite spam', decidedBy: 'rules' };

  if (message.mentions && message.mentions.users.size >= 5) {
    return { action: 'delete', reason: 'Mass mention spam', ruleName: 'Mention spam', decidedBy: 'rules' };
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = (floodMap.get(key) || []).filter(t => now - t < 10000);
  arr.push(now);
  floodMap.set(key, arr);
  if (arr.length > (mod.spamLimit || 5)) return { action: 'delete', reason: 'Message flooding', ruleName: 'Flooding', decidedBy: 'rules' };

  return NONE;
}

// The lean GPT judge
async function gptCheck(client, message, rulesText) {
  const quota = await checkQuota(client._id);
  if (!quota.allowed) return NONE;

  const policyDigest = client.discord.policy?.digest || '';
  const sys = `You are a strict but fair Discord moderator for "${client.businessName}".\n` +
    (policyDigest ? `POLICY DIGEST:\n${policyDigest}\n\n` : '') +
    (rulesText ? `COMMUNITY RULES:\n${rulesText}\n\n` : '') +
    (client.discord.moderatorPrompt ? `EXTRA INSTRUCTIONS: ${client.discord.moderatorPrompt}\n\n` : '') +
    `Judge ONLY the user message below. Do not punish normal conversation. ` +
    `Reply strictly in JSON: {"violation":true|false,"rule":"exact rule name or empty","severity":"warn"|"delete","reason":"short reason"}.`;

  const options = { temperature: 0, maxTokens: 80, jsonMode: true };
  const res = await generateAIResponse(message.content.slice(0, 1000), [], sys, client, null, null, options);
  if (res.tokensUsed) await deductTokens(client._id, res.tokensUsed);
  try {
    const j = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    if (!j.violation) return NONE;
    const rules = client.discord.rules || [];
    const matched = rules.find(r => r.name.toLowerCase() === String(j.rule || '').toLowerCase());
    const action = matched ? matched.action : (j.severity === 'delete' ? 'delete' : 'warn');
    return { action, reason: String(j.reason || 'Policy violation').slice(0, 150), ruleName: matched ? matched.name : (j.rule || 'Policy'), decidedBy: 'gpt' };
  } catch (_) { return NONE; }
}

async function evaluate(client, message) {
  const mod = client.discord.moderation;
  if (!mod.enabled || !message.content) return NONE;
  
  // LAYER 1: Hard Rules
  const ruleRes = ruleCheck(client, message);
  if (ruleRes.action !== 'none') return ruleRes;

  // Check if AI is active (migrate legacy aiClassify)
  const aiMode = mod.aiMode || (mod.aiClassify ? 'smart' : 'off');
  if (aiMode === 'off') return NONE;

  // LAYER 2: Pre-filter skip
  if (aiMode === 'smart') {
    const skip = shouldSkipAi(client, message);
    if (skip.skip) return { ...NONE, decidedBy: 'prefilter', skipReason: skip.reason };
  }

  // LAYER 3: Verdict Cache
  const cached = getVerdict(message.guild.id, message.content);
  if (cached) return { ...cached, decidedBy: 'cache' };

  let finalRes = NONE;
  let gptNeeded = aiMode === 'strict';

  const customRules = (client.discord.rules || []).filter(r => r.description && (!r.keywords || !r.keywords.length));
  const rulesText = customRules.map((r, i) => `${i + 1}. ${r.name}: ${r.description}`).join('\n');
  if (rulesText) gptNeeded = true; // Needs GPT if there are semantic rules

  // LAYER 4: Free OpenAI Moderation API
  if (aiMode === 'smart') {
    const modApi = await classify(message.content, client);
    if (modApi) {
      if (modApi.band === 'clear') {
        finalRes = { action: modApi.action, reason: `Violation: ${modApi.label} (AI Moderation)`, ruleName: modApi.label, decidedBy: 'mod_api' };
        gptNeeded = false; // Resolved clearly
      } else if (modApi.band === 'borderline') {
        gptNeeded = true;
      }
    }
  }

  // LAYER 5: Lean GPT Judge
  if (gptNeeded && finalRes.action === 'none') {
    const allowed = consumeAiBudget(message.guild.id, mod.aiChecksPerMinute || 30);
    if (!allowed) {
       // Circuit breaker tripped! We skip GPT.
       return { ...NONE, decidedBy: 'circuit_breaker' };
    }
    try { 
      finalRes = await gptCheck(client, message, rulesText);
    } catch (e) { 
      console.error('[Discord] gptCheck error:', e.message); 
    }
  }

  // Cache the verdict (even if clean)
  if (finalRes.decidedBy !== 'circuit_breaker') {
    setVerdict(message.guild.id, message.content, { 
      action: finalRes.action, reason: finalRes.reason, ruleName: finalRes.ruleName 
    });
  }

  return finalRes;
}

module.exports = { evaluate };
