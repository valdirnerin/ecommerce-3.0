const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { DATA_DIR } = require('../utils/dataDir');
const {
  generateRandomToken,
  generateSalt,
  hashToken,
  verifyToken,
} = require('../utils/security');

const filePath = path.join(DATA_DIR, 'review_tokens.json');
let writeLock = Promise.resolve();

function withLock(task) {
  const next = writeLock.then(task, task);
  writeLock = next.catch(() => {});
  return next;
}

function readAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.tokens) ? parsed.tokens : [];
  } catch {
    return [];
  }
}

function writeAll(tokens) {
  const payload = { tokens: tokens || [] };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function issueToken({ scope, orderId, referralId, recipientEmail, expiresAt, createdIpHash }) {
  const tokenPlain = generateRandomToken(32);
  const tokenSalt = generateSalt();
  const tokenHash = hashToken(tokenPlain, tokenSalt);
  const record = {
    id: crypto.randomUUID(),
    token_hash: tokenHash,
    token_salt: tokenSalt,
    scope,
    order_id: orderId || null,
    referral_id: referralId || null,
    recipient_email: recipientEmail || null,
    expires_at: expiresAt,
    used_at: null,
    created_at: new Date().toISOString(),
    created_ip_hash: createdIpHash || null,
    used_ip_hash: null,
  };

  const pool = db.getPool();
  if (!pool) {
    const tokens = readAll();
    tokens.push(record);
    writeAll(tokens);
    return { token: tokenPlain, record };
  }

  await pool.query(
    `INSERT INTO review_tokens (id, token_hash, token_salt, scope, order_id, referral_id, recipient_email, expires_at, used_at, created_at, created_ip_hash, used_ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)` ,
    [
      record.id,
      record.token_hash,
      record.token_salt,
      record.scope,
      record.order_id,
      record.referral_id,
      record.recipient_email,
      record.expires_at,
      record.used_at,
      record.created_at,
      record.created_ip_hash,
      record.used_ip_hash,
    ]
  );
  return { token: tokenPlain, record };
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().find((token) => String(token.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM review_tokens WHERE id=$1', [id]);
  return rows[0] || null;
}

function isExpired(token) {
  if (!token?.expires_at) return false;
  const exp = new Date(token.expires_at);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() < Date.now();
}

async function verifyTokenById(id, tokenPlain) {
  const record = await getById(id);
  if (!record) return { valid: false, reason: 'not_found' };
  if (record.used_at) return { valid: false, reason: 'used', record };
  if (isExpired(record)) return { valid: false, reason: 'expired', record };
  const isValid = verifyToken(tokenPlain, record.token_salt, record.token_hash);
  if (!isValid) return { valid: false, reason: 'invalid', record };
  return { valid: true, record };
}

async function consumeToken({ id, tokenPlain, usedIpHash }) {
  const pool = db.getPool();
  if (!pool) {
    return withLock(async () => {
      const tokens = readAll();
      const idx = tokens.findIndex((item) => String(item.id) === String(id));
      if (idx === -1) return { ok: false, reason: 'not_found' };
      const token = tokens[idx];
      if (token.used_at) return { ok: false, reason: 'used', record: token };
      if (isExpired(token)) return { ok: false, reason: 'expired', record: token };
      const isValid = verifyToken(tokenPlain, token.token_salt, token.token_hash);
      if (!isValid) return { ok: false, reason: 'invalid', record: token };
      const updated = {
        ...token,
        used_at: new Date().toISOString(),
        used_ip_hash: usedIpHash || null,
      };
      tokens[idx] = updated;
      writeAll(tokens);
      return { ok: true, record: updated };
    });
  }

  const record = await getById(id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.used_at) return { ok: false, reason: 'used', record };
  if (isExpired(record)) return { ok: false, reason: 'expired', record };
  const matches = verifyToken(tokenPlain, record.token_salt, record.token_hash);
  if (!matches) return { ok: false, reason: 'invalid', record };
  const result = await pool.query(
    `UPDATE review_tokens
     SET used_at=now(), used_ip_hash=$2
     WHERE id=$1 AND used_at IS NULL AND expires_at > now()
     RETURNING *`,
    [id, usedIpHash || null]
  );
  if (!result.rows[0]) return { ok: false, reason: 'used', record };
  return { ok: true, record: result.rows[0] };
}

module.exports = {
  issueToken,
  getById,
  verifyTokenById,
  consumeToken,
};
