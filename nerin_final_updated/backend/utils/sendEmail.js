const nodemailer = require('nodemailer');
const logger = require('../logger');

async function sendEmail(to, subject, text) {
  if (!process.env.SMTP_HOST) {
    logger.info(`Mock email to ${to}: ${subject} - ${text}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

module.exports = sendEmail;
