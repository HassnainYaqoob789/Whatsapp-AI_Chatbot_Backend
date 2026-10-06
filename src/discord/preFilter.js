// =============================================================================
// PRE-FILTER - Quick checks to decide if AI scan is needed (Cost Optimization)
// =============================================================================

// List of trivial messages that don't need AI (exact matches after trim/lowercase)
const TRIVIAL = new Set([
  'hi', 'hello', 'hey', 'sup', 'yo',
  'ok', 'okay', 'kk',
  'thanks', 'ty', 'tysm', 'thank you',
  'lol', 'lmao', 'rofl', 'haha', 'hehe',
  'yes', 'no', 'yeah', 'yep', 'nope',
  'gm', 'gn', 'good morning', 'good night',
  'wow', 'wtf', 'omg',
  '?', '!', '...', '..'
]);

function shouldSkipAi(client, message) {
  const mod = client.discord?.moderation || {};
  const member = message.member;
  
  // 1. Staff / Admins skip AI
  const isStaff = member && (member.permissions.has('Administrator') || member.permissions.has('ManageGuild'));
  if (isStaff) return { skip: true, reason: 'staff' };

  // 2. Exempt Channels
  const exemptChans = mod.exemptChannelIds || [];
  if (exemptChans.includes(message.channel.id)) return { skip: true, reason: 'exempt_channel' };

  // 3. Trusted Roles
  const trusted = mod.trustedRoleIds || [];
  if (member && trusted.length > 0) {
    const hasTrustedRole = member.roles.cache.some(r => trusted.includes(r.id));
    if (hasTrustedRole) return { skip: true, reason: 'trusted_role' };
  }

  // 4. Scan Only New Members (if enabled)
  if (mod.scanOnlyNewMembers && member && member.joinedAt) {
    const days = mod.newMemberDays || 7;
    const ms = days * 24 * 60 * 60 * 1000;
    if (Date.now() - member.joinedAt.getTime() > ms) {
      return { skip: true, reason: 'tenured_member' };
    }
  }

  // 5. Trivial message / emoji only
  const text = (message.content || '').trim().toLowerCase();
  if (!text) return { skip: true, reason: 'empty_or_media' };
  
  // Just custom emoji format <:name:id> or animated <a:name:id>
  const onlyCustomEmoji = /^<a?:\w+:\d+>$/i.test(text);
  if (onlyCustomEmoji) return { skip: true, reason: 'emoji_only' };
  
  // Just standard emoji / short symbol chars
  // Not perfect, but catches single/double unicode emojis
  if (text.length <= 4 && /^[^\w]+$/.test(text)) {
    return { skip: true, reason: 'symbol_only' };
  }
  
  if (TRIVIAL.has(text)) return { skip: true, reason: 'trivial_text' };

  return { skip: false };
}

module.exports = { shouldSkipAi };
