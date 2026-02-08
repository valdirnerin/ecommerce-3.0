const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { DATA_DIR } = require('../utils/dataDir');

const filePath = path.join(DATA_DIR, 'referrals.json');

function readAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.referrals) ? parsed.referrals : [];
  } catch {
    return [];
  }
}

function writeAll(referrals) {
  const payload = { referrals: referrals || [] };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizeReferral(referral = {}) {
  const now = new Date().toISOString();
  return {
    id: String(referral.id || crypto.randomUUID()),
    order_id: referral.order_id || null,
    partner_id: referral.partner_id || null,
    customer_email: referral.customer_email || '',
    customer_name: referral.customer_name || '',
    status: referral.status || 'OPEN',
    created_at: referral.created_at || now,
    updated_at: now,
  };
}

async function getAll() {
  const pool = db.getPool();
  if (!pool) return readAll();
  const { rows } = await pool.query('SELECT * FROM referrals ORDER BY created_at DESC');
  return rows;
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().find((ref) => String(ref.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM referrals WHERE id=$1', [id]);
  return rows[0] || null;
}

async function create(referral) {
  const record = normalizeReferral(referral);
  const pool = db.getPool();
  if (!pool) {
    const list = readAll();
    list.push(record);
    writeAll(list);
    return record;
  }
  await pool.query(
    `INSERT INTO referrals (id, order_id, partner_id, customer_email, customer_name, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)` ,
    [
      record.id,
      record.order_id,
      record.partner_id,
      record.customer_email,
      record.customer_name,
      record.status,
      record.created_at,
      record.updated_at,
    ]
  );
  return record;
}

async function update(id, updates = {}) {
  const pool = db.getPool();
  if (!pool) {
    const list = readAll();
    const idx = list.findIndex((ref) => String(ref.id) === String(id));
    if (idx === -1) return null;
    const next = {
      ...list[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    list[idx] = next;
    writeAll(list);
    return next;
  }
  const existing = await getById(id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  await pool.query(
    `UPDATE referrals SET order_id=$2, partner_id=$3, customer_email=$4, customer_name=$5, status=$6, updated_at=$7 WHERE id=$1`,
    [
      id,
      merged.order_id,
      merged.partner_id,
      merged.customer_email,
      merged.customer_name,
      merged.status,
      merged.updated_at,
    ]
  );
  return merged;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
};
