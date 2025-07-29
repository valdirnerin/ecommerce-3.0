const logger = require('../logger');

module.exports = function enforcePostJson(req, res, next) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  if (Object.keys(req.query || {}).length) {
    logger.warn('query parameters not allowed');
    return res.status(400).json({ error: 'Query parameters not allowed' });
  }
  if (req.headers['content-type'] !== 'application/json') {
    return res.status(415).json({ error: 'Unsupported content type' });
  }
  next();
};
