const crypto = require('crypto');
const logger = require('../logger');

module.exports = function verifySignature(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return next();
  }
  const signature = req.headers['x-signature'];
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    logger.warn('signature mismatch');
    return res.status(403).json({ error: 'Invalid signature' });
  }
  next();
};
