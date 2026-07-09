const nodemailer = require('nodemailer');

/**
 * Sends an email notification.
 * Uses SMTP credentials from environment variables.
 *
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.subject - Email subject
 * @param {string} params.text - Plain text content (optional)
 * @param {string} params.html - HTML content (optional)
 */
const sendEmail = async ({ to, subject, text, html }) => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !user) {
    console.error('SMTP Configuration is missing. Please set SMTP_HOST and SMTP_USER in .env file.');
    return;
  }

  const secure = (Number(port) === 465);

  const transporter = nodemailer.createTransport({
    host: host,
    port: Number(port),
    secure: secure,
    auth: {
      user: user,
      pass: pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: from,
    to: to,
    subject: subject,
    text: text,
    html: html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`Email successfully sent to ${to}. MessageId: ${info.messageId}`);
  return info;
};

module.exports = sendEmail;
