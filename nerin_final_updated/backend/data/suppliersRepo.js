const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const jsonPath = path.join(__dirname, '../../data/suppliers.json');
function readJson() { try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return { suppliers: [] }; } }
function writeJson(obj) { fs.writeFileSync(jsonPath, JSON.stringify(obj, null, 2), 'utf8'); }

async function getAll(client) {
  const pool = client || db.getPool();
  if (pool) {
    const { rows } = await pool.query('SELECT id, name, contact, email, phone, address, payment_terms, rating FROM suppliers ORDER BY name');
    return rows;
  }
  return readJson().suppliers;
}

async function create(s, client) {
  const pool = client || db.getPool();
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO suppliers(id, name, contact, email, phone, address, payment_terms, rating)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [s.name||'', s.contact||'', s.email||'', s.phone||'', s.address||'', s.payment_terms||'', Number(s.rating||0)]
    );
    return rows[0];
  }
  const obj = readJson(); const id = crypto.randomUUID();
  obj.suppliers.push({ id, ...s }); writeJson(obj); return { id, ...s };
}

module.exports = { getAll, create };
