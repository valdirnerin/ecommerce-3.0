const crypto = require('crypto');

const TOKEN_PEPPER = process.env.REVIEW_TOKEN_PEPPER || process.env.SECURITY_PEPPER || '';

function hashWithPepper(value, salt) {
  return crypto.scryptSync(`${value}${TOKEN_PEPPER}`, salt, 64).toString('hex');
}

function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function generateSalt(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token, salt) {
  if (!token || !salt) return null;
  return hashWithPepper(token, salt);
}

function verifyToken(token, salt, expectedHash) {
  if (!token || !salt || !expectedHash) return false;
  const computed = hashToken(token, salt);
  if (!computed) return false;
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const computedBuffer = Buffer.from(computed, 'hex');
  if (expectedBuffer.length !== computedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto
    .createHash('sha256')
    .update(`${ip}${TOKEN_PEPPER}`)
    .digest('hex');
}

module.exports = {
  generateRandomToken,
  generateSalt,
  hashToken,
  verifyToken,
  hashIp,
};
