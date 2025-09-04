module.exports = function requireHttps(req, res, next) {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.status(403).json({ error: 'HTTPS required' });
  }
  next();
};
