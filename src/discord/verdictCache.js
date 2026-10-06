// =============================================================================
// VERDICT CACHE - Local in-memory LRU cache for moderation decisions
// =============================================================================
// Prevents charging for the exact same message pasted repeatedly (spam/raids).
// Uses a simple Map with max size to avoid memory leaks.
// Keys are formatted as `guildId:sha1(normalizedText)`
// =============================================================================

const crypto = require('crypto');

// Map<key, { decision, at }>
const cache = new Map();
const MAX_ENTRIES = 10000;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalize(text) {
  // Lowercase, remove all non-alphanumeric chars (keep basic space), collapse spaces
  return text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey(guildId, text) {
  const norm = normalize(text);
  if (!norm) return null;
  const hash = crypto.createHash('sha1').update(norm).digest('hex');
  return `${guildId}:${hash}`;
}

function getVerdict(guildId, text) {
  const key = makeKey(guildId, text);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) {
    if (Date.now() - hit.at > TTL_MS) {
      cache.delete(key);
      return null;
    }
    return hit.decision;
  }
  return null;
}

function setVerdict(guildId, text, decision) {
  const key = makeKey(guildId, text);
  if (!key) return;
  // Basic LRU logic if map gets too big (keys() returns in insertion order)
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { decision, at: Date.now() });
}

module.exports = { getVerdict, setVerdict };
