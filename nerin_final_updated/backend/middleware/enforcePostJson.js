module.exports = function enforcePostJson(req, res, next) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Unsupported content type' });
  }
  next();
};
