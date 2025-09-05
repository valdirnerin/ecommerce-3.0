module.exports = function enforcePostJson(req, res, next) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  const isJson = req.is('application/json');
  const isForm = req.is('application/x-www-form-urlencoded');
  if (!isJson && !isForm) {
    return res.status(415).json({ error: 'Unsupported content type' });
  }
  next();
};
