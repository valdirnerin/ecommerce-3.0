const crypto = require('crypto');
const logger = require('../logger');

module.exports = function verifySignature(req, _res, next) {
  const secret = process.env.MP_WEBHOOK_SECRET || '';
  if (!secret || secret === 'dummy') {
    logger.warn(
      `mp-webhook signature check ${JSON.stringify({
        signature_valid: false,
        reason: secret ? 'placeholder' : 'no_secret',
      })}`,
    );
    req.validSignature = true;
    return next();
  }
  const signature = req.headers['x-signature'];
  if (!signature || !req.rawBody) {
    logger.warn(
      `mp-webhook signature check ${JSON.stringify({
        signature_valid: false,
        reason: 'missing',
      })}`,
    );
    req.validSignature = false;
    return next();
  }
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(req.rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (
      sigBuf.length !== expBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expBuf)
    ) {
      logger.warn(
        `mp-webhook signature check ${JSON.stringify({
          signature_valid: false,
          reason: 'mismatch',
        })}`,
      );
      req.validSignature = false;
      return next();
    }
    logger.info(
      `mp-webhook signature check ${JSON.stringify({ signature_valid: true })}`,
    );
    req.validSignature = true;
  } catch (e) {
    logger.warn(
      `mp-webhook signature check ${JSON.stringify({
        signature_valid: false,
        reason: 'error',
        msg: e?.message,
      })}`,
    );
    req.validSignature = false;
  }
  next();
};
