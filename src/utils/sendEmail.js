const nodemailer = require('nodemailer');

/**
 * Sends a lead notification email using the CLIENT's own SMTP credentials.
 *
 * ── Design decision ──
 * There is NO global .env fallback.
 * Every business tenant must configure their own SMTP in Settings.
 * If SMTP is not configured → email is silently skipped (returns false).
 *
 * @param {Object}  params
 * @param {string}  params.to           - Recipient email address
 * @param {string}  params.subject      - Email subject
 * @param {string}  [params.text]       - Plain text fallback (optional)
 * @param {string}  [params.html]       - HTML body (optional)
 * @param {Object}  params.clientSmtp   - REQUIRED: per-tenant SMTP config
 * @param {string}  params.clientSmtp.host
 * @param {number}  [params.clientSmtp.port]      - default 465
 * @param {string}  params.clientSmtp.user
 * @param {string}  params.clientSmtp.password
 * @param {string}  [params.clientSmtp.from]      - defaults to user
 * @param {string}  [params.businessName]         - used in log messages
 *
 * @returns {Promise<boolean>} true if sent, false if skipped or failed
 */
const sendEmail = async ({ to, subject, text, html, clientSmtp, businessName }) => {
    try {
        const host = clientSmtp?.host?.trim();
        const user = clientSmtp?.user?.trim();
        const pass = clientSmtp?.password?.trim();
        const port = Number(clientSmtp?.port) || 465;
        const from = clientSmtp?.from?.trim() || user;

        // ── Guard: no client SMTP configured → skip + remind ──
        if (!host || !user || !pass) {
            console.warn(
                `[${businessName || 'Client'}] ⚠️  Lead email NOT sent — SMTP not configured.` +
                ` Go to Settings → Email Notification SMTP and fill in your credentials.`
            );
            return false;
        }

        if (!to) {
            console.warn(`[${businessName || 'Client'}] ⚠️  Lead email NOT sent — No recipient email address (leadNotificationEmail) configured.`);
            return false;
        }

        const secure = (port === 465);

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: false },
            connectionTimeout: 10000,
            greetingTimeout: 5000,
            socketTimeout: 10000,
        });

        const info = await transporter.sendMail({ from, to, subject, text, html });

        console.log(`[${businessName || 'Client'}] ✅ Lead email sent successfully to ${to}. MessageId: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error(`[${businessName || 'Client'}] ❌ SMTP error sending lead email to ${to}:`, error.message);
        return false;
    }
};

module.exports = sendEmail;
