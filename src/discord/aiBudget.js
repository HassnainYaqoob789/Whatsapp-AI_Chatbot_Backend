// =============================================================================
// AI BUDGET - Circuit breaker to prevent runaway costs during server raids
// =============================================================================

// guildId -> { minuteStart: timestamp, count: number }
const counters = new Map();

setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, v] of counters) {
    if (v.minuteStart < cutoff) counters.delete(k);
  }
}, 60000).unref();

/**
 * Checks if the guild is under its AI rate limit.
 * Increments the counter.
 * @returns true if allowed, false if tripped
 */
function consumeAiBudget(guildId, maxPerMinute = 30) {
  const now = Date.now();
  let v = counters.get(guildId);
  
  // reset if older than a minute
  if (!v || now - v.minuteStart > 60000) {
    v = { minuteStart: now, count: 0 };
  }
  
  v.count++;
  counters.set(guildId, v);
  
  return v.count <= maxPerMinute;
}

/**
 * Just checks without incrementing.
 */
function isUnderBudget(guildId, maxPerMinute = 30) {
  let v = counters.get(guildId);
  if (!v || Date.now() - v.minuteStart > 60000) return true;
  return v.count < maxPerMinute;
}

module.exports = { consumeAiBudget, isUnderBudget };
