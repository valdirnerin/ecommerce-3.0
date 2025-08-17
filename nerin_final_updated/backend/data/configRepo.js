const fs = require('fs');
const path = require('path');
const db = require('../db');

const filePath = path.join(__dirname, '../../data/config.json');
const shippingPath = path.join(__dirname, '../../data/shippingTable.json');

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

async function getShippingTable(client) {
  const pool = client || db.getPool();
  if (!pool) {
    try {
      const obj = JSON.parse(fs.readFileSync(shippingPath, 'utf8'));
      return Array.isArray(obj.costos) ? obj.costos : [];
    } catch {
      return [];
    }
  }
  try {
    const { rows } = await pool.query('SELECT value FROM config WHERE key=$1', ['shipping_table']);
    const val = rows[0] ? rows[0].value : [];
    return Array.isArray(val) ? val : val.costos || [];
  } catch {
    return [];
  }
}

async function saveShippingTable(rows, client) {
  const pool = client || db.getPool();
  if (!pool) {
    fs.writeFileSync(shippingPath, JSON.stringify({ costos: rows }, null, 2), 'utf8');
    return;
  }
  await pool.query(
    'INSERT INTO config(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    ['shipping_table', JSON.stringify(rows)]
  );
}

module.exports = { get, save, getShippingTable, saveShippingTable };
