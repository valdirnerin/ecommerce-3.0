const fs = require('fs');
const path = require('path');
const db = require('../db');

const filePath = path.join(__dirname, '../../data/config.json');

async function get() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return {};
    }
  }
  const { rows } = await pool.query('SELECT value FROM config WHERE key=$1', ['general']);
  return rows[0] ? rows[0].value : {};
}

async function save(cfg) {
  const pool = db.getPool();
  if (!pool) {
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf8');
    return;
  }
  await pool.query(
    'INSERT INTO config(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    ['general', JSON.stringify(cfg)]
  );
}

module.exports = { get, save };
