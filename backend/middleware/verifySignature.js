const crypto = require('crypto');

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
  if (expected !== signature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  next();
};
