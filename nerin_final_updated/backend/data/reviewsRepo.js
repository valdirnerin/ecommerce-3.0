const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { DATA_DIR } = require('../utils/dataDir');

const filePath = path.join(DATA_DIR, 'reviews.json');

function readAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.reviews) ? parsed.reviews : [];
  } catch {
    return [];
  }
}

function writeAll(reviews) {
  const payload = { reviews: reviews || [] };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizeReview(review = {}) {
  const now = new Date().toISOString();
  return {
    id: String(review.id || crypto.randomUUID()),
    rating: review.rating,
    text: review.text || '',
    photos: Array.isArray(review.photos) ? review.photos.filter(Boolean) : [],
    product_id: review.product_id || null,
    partner_id: review.partner_id || null,
    order_id: review.order_id || null,
    referral_id: review.referral_id || null,
    verification_type: review.verification_type || null,
    status: review.status || 'PENDING',
    created_at: review.created_at || now,
    updated_at: now,
    soft_deleted_at: review.soft_deleted_at || null,
  };
}

async function getAll() {
  const pool = db.getPool();
  if (!pool) return readAll();
  const { rows } = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC');
  return rows.map((row) => ({
    ...row,
    photos: Array.isArray(row.photos) ? row.photos : row.photos ? row.photos : [],
  }));
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().find((review) => String(review.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM reviews WHERE id=$1', [id]);
  return rows[0] || null;
}

async function create(review) {
  const record = normalizeReview(review);
  const pool = db.getPool();
  if (!pool) {
    const list = readAll();
    list.push(record);
    writeAll(list);
    return record;
  }
  await pool.query(
    `INSERT INTO reviews (id, rating, text, photos, product_id, partner_id, order_id, referral_id, verification_type, status, created_at, updated_at, soft_deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)` ,
    [
      record.id,
      record.rating,
      record.text,
      JSON.stringify(record.photos || []),
      record.product_id,
      record.partner_id,
      record.order_id,
      record.referral_id,
      record.verification_type,
      record.status,
      record.created_at,
      record.updated_at,
      record.soft_deleted_at,
    ]
  );
  return record;
}

async function update(id, updates = {}) {
  const pool = db.getPool();
  if (!pool) {
    const list = readAll();
    const idx = list.findIndex((review) => String(review.id) === String(id));
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
    `UPDATE reviews SET rating=$2, text=$3, photos=$4, product_id=$5, partner_id=$6, order_id=$7,
     referral_id=$8, verification_type=$9, status=$10, updated_at=$11, soft_deleted_at=$12 WHERE id=$1`,
    [
      id,
      merged.rating,
      merged.text,
      JSON.stringify(merged.photos || []),
      merged.product_id,
      merged.partner_id,
      merged.order_id,
      merged.referral_id,
      merged.verification_type,
      merged.status,
      merged.updated_at,
      merged.soft_deleted_at,
    ]
  );
  return merged;
}

async function listPublishedByProduct(productId) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().filter(
      (review) =>
        String(review.product_id) === String(productId) &&
        review.status === 'PUBLISHED' &&
        !review.soft_deleted_at,
    );
  }
  const { rows } = await pool.query(
    'SELECT * FROM reviews WHERE product_id=$1 AND status=$2 AND soft_deleted_at IS NULL ORDER BY created_at DESC',
    [productId, 'PUBLISHED']
  );
  return rows;
}

async function listPublishedByPartner(partnerId) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().filter(
      (review) =>
        String(review.partner_id) === String(partnerId) &&
        review.status === 'PUBLISHED' &&
        !review.soft_deleted_at,
    );
  }
  const { rows } = await pool.query(
    'SELECT * FROM reviews WHERE partner_id=$1 AND status=$2 AND soft_deleted_at IS NULL ORDER BY created_at DESC',
    [partnerId, 'PUBLISHED']
  );
  return rows;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  listPublishedByProduct,
  listPublishedByPartner,
};
