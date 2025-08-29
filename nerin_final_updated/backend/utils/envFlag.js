function envFlag(name, defaultValue = false) {
  const val = process.env[name];
  if (val == null) return defaultValue;
  const str = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(str)) return true;
  if (['0', 'false', 'no', ''].includes(str)) return false;
  return defaultValue;
}
module.exports = { envFlag };
