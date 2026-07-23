// =============================================================================
// QUOTA SERVICE - Token Limit Management (Daily & Monthly)
// =============================================================================
// Handles: Checking if client has quota, deducting tokens, resetting limits,
//          and logging usage for Super Admin reports.
// =============================================================================

const Client = require("../models/Client");
const UsageLog = require("../models/UsageLog");

/**
 * Check if a client has enough quota to make an AI call.
 * Also auto-resets daily/monthly counters if the period has passed.
 * @returns { allowed: boolean, reason: string }
 */
async function checkQuota(clientId) {
    const client = await Client.findById(clientId);
    if (!client) return { allowed: false, reason: "Client not found." };

    const now = new Date();

    // ── Auto-Reset Monthly Counter ──
    const billingStart = new Date(client.billingCycleStartDate);
    const monthsSince = (now.getFullYear() - billingStart.getFullYear()) * 12 + (now.getMonth() - billingStart.getMonth());
    if (monthsSince >= 1) {
        client.monthlyTokensUsed = 0;
        client.billingCycleStartDate = now;
        client.dailyTokensUsed = 0;
        client.dailyResetTime = now;
        await client.save();
        console.log(`[Quota] Monthly reset for client: ${client.businessName}`);
    }

    // ── Auto-Reset Daily Counter ──
    const lastReset = new Date(client.dailyResetTime);
    const isNewDay = now.toDateString() !== lastReset.toDateString();
    if (isNewDay) {
        client.dailyTokensUsed = 0;
        client.dailyResetTime = now;
        await client.save();
        console.log(`[Quota] Daily reset for client: ${client.businessName}`);
    }

    // ── Check Monthly Limit ──
    if (client.monthlyTokensUsed >= client.monthlyTokenLimit) {
        return { allowed: false, reason: `Monthly AI token limit reached (${client.monthlyTokenLimit.toLocaleString()} tokens). Your limit will reset on your next billing cycle.` };
    }

    // ── Check Daily Limit ──
    if (client.dailyTokensUsed >= client.dailyTokenLimit) {
        return { allowed: false, reason: `Daily AI token limit reached (${client.dailyTokenLimit.toLocaleString()} tokens). Your limit will reset at midnight.` };
    }

    return { allowed: true, reason: "OK" };
}

/**
 * Deduct tokens from a client's quota after a successful AI call.
 * Also logs usage for Super Admin reporting.
 */
async function deductTokens(clientId, tokensUsed) {
    if (!tokensUsed || tokensUsed <= 0) return;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Update client quotas atomically
    await Client.findByIdAndUpdate(clientId, {
        $inc: {
            monthlyTokensUsed: tokensUsed,
            dailyTokensUsed: tokensUsed,
        }
    });

    // Upsert daily usage log for Super Admin reports
    await UsageLog.findOneAndUpdate(
        { clientId, date: today },
        { $inc: { tokensUsed } },
        { upsert: true, new: true }
    );

    console.log(`[Quota] Deducted ${tokensUsed} tokens for client ${clientId}. Date: ${today}`);
}

/**
 * Get current quota status for a client (used by API endpoints).
 */
async function getQuotaStatus(clientId) {
    const client = await Client.findById(clientId).select(
        'businessName monthlyTokenLimit monthlyTokensUsed billingCycleStartDate dailyTokenLimit dailyTokensUsed dailyResetTime useWabexQuota'
    );
    if (!client) return null;

    return {
        businessName: client.businessName,
        useWabexQuota: client.useWabexQuota !== false,
        monthly: {
            limit: client.monthlyTokenLimit,
            used: client.monthlyTokensUsed,
            remaining: Math.max(0, client.monthlyTokenLimit - client.monthlyTokensUsed),
            percentUsed: Math.round((client.monthlyTokensUsed / client.monthlyTokenLimit) * 100),
            billingCycleStart: client.billingCycleStartDate,
        },
        daily: {
            limit: client.dailyTokenLimit,
            used: client.dailyTokensUsed,
            remaining: Math.max(0, client.dailyTokenLimit - client.dailyTokensUsed),
            percentUsed: Math.round((client.dailyTokensUsed / client.dailyTokenLimit) * 100),
            resetsAt: client.dailyResetTime,
        }
    };
}

module.exports = { checkQuota, deductTokens, getQuotaStatus };
