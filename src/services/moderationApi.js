// =============================================================================
// OPENAI MODERATION API - Free toxicity classifier (Layer 4 of Discord pipeline)
// =============================================================================
// Endpoint: POST https://api.openai.com/v1/moderations (omni-moderation-latest)
// The moderation endpoint is free of charge, so it is used as the first AI
// layer before any paid GPT call. Fails OPEN (returns null) on any error so a
// provider outage never blocks or punishes members.
// =============================================================================

const axios = require('axios');
const { resolveOpenAIKey } = require('./aiService');

const ENDPOINT = 'https://api.openai.com/v1/moderations';
const MODEL = 'omni-moderation-latest';
const TIMEOUT_MS = 2500;

// Score bands
const CLEAR_THRESHOLD = 0.85;      // >= : confident violation, act without GPT
const BORDERLINE_THRESHOLD = 0.40; // >= : uncertain, escalate to GPT judge

// Category -> human label + default action when confidently flagged
const CATEGORY_MAP = {
  'harassment': { label: 'Harassment', action: 'delete' },
  'harassment/threatening': { label: 'Threats / harassment', action: 'delete' },
  'hate': { label: 'Hate speech', action: 'delete' },
  'hate/threatening': { label: 'Threatening hate speech', action: 'delete' },
  'sexual': { label: 'Sexual content', action: 'delete' },
  'sexual/minors': { label: 'Sexual content involving minors', action: 'delete' },
  'violence': { label: 'Violent content', action: 'delete' },
  'violence/graphic': { label: 'Graphic violence', action: 'delete' },
  'illicit': { label: 'Illicit activity', action: 'delete' },
  'illicit/violent': { label: 'Violent illicit activity', action: 'delete' },
  // Self-harm: never punish harshly - warn + alert moderators
  'self-harm': { label: 'Self-harm concern', action: 'warn' },
  'self-harm/intent': { label: 'Self-harm concern', action: 'warn' },
  'self-harm/instructions': { label: 'Self-harm instructions', action: 'delete' },
};

/**
 * Classifies text with the free moderation endpoint.
 * @returns {Promise<null | { band: 'clear'|'borderline'|'clean', category: string, label: string, score: number, action: string }>}
 *          null when the API is unavailable (caller should fall back gracefully).
 */
async function classify(text, client) {
  const apiKey = resolveOpenAIKey(client);
  if (!apiKey || !text) return null;

  try {
    const res = await axios.post(
      ENDPOINT,
      { model: MODEL, input: text.slice(0, 2000) },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
    );
    const result = res.data?.results?.[0];
    if (!result) return null;

    // Pick the highest-scoring category
    let category = '';
    let score = 0;
    for (const [cat, s] of Object.entries(result.category_scores || {})) {
      if (s > score) { score = s; category = cat; }
    }

    const meta = CATEGORY_MAP[category] || { label: category || 'Policy', action: 'delete' };
    let band = 'clean';
    if (score >= CLEAR_THRESHOLD) band = 'clear';
    else if (score >= BORDERLINE_THRESHOLD || result.flagged) band = 'borderline';

    return { band, category, label: meta.label, score: Number(score.toFixed(3)), action: meta.action };
  } catch (e) {
    console.error('[ModerationAPI] classify failed:', e.response?.status || '', e.message);
    return null;
  }
}

module.exports = { classify, CLEAR_THRESHOLD, BORDERLINE_THRESHOLD };
