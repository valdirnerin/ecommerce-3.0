const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { DATA_DIR } = require('./dataDir');

const AUDIT_DIR = path.join(DATA_DIR, 'audit');
const AUDIT_FILE = path.join(AUDIT_DIR, 'reviews.jsonl');

function ensureAuditDir() {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  } catch (err) {
    console.error('audit dir create fail', err);
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function appendAuditEvent({ type, actor = null, data = {} }) {
  const entry = {
    id: crypto.randomUUID(),
    type,
    actor,
    data,
    created_at: new Date().toISOString(),
  };
  ensureAuditDir();
  try {
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error('audit write fail', err);
  }

  const pool = db.getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO audit_log (id, type, actor, data, created_at)
         VALUES ($1, $2, $3, $4, $5)` ,
        [entry.id, entry.type, entry.actor, JSON.stringify(entry.data || {}), entry.created_at]
      );
    } catch (err) {
      console.error('audit db write fail', err);
    }
  }
  return entry;
}

async function getAuditEvents({ from, to } = {}) {
  const fromDate = normalizeDate(from);
  const toDate = normalizeDate(to);
  const pool = db.getPool();
  if (pool) {
    const conditions = [];
    const params = [];
    if (fromDate) {
      params.push(fromDate.toISOString());
      conditions.push(`created_at >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate.toISOString());
      conditions.push(`created_at <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC`,
      params
    );
    return rows;
  }
  ensureAuditDir();
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
  const lines = raw.split(/\n+/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (fromDate || toDate) {
        const created = normalizeDate(entry.created_at);
        if (!created) continue;
        if (fromDate && created < fromDate) continue;
        if (toDate && created > toDate) continue;
      }
      entries.push(entry);
    } catch (err) {
      continue;
    }
  }
  return entries;
}

module.exports = { appendAuditEvent, getAuditEvents };
