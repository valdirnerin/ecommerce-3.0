const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { DATA_DIR } = require('../utils/dataDir');

const filePath = path.join(DATA_DIR, 'partners.json');

function readAll() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.partners) ? parsed.partners : [];
  } catch {
    return [];
  }
}

function writeAll(partners) {
  const payload = { partners: partners || [] };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizePartner(partner = {}) {
  const now = new Date().toISOString();
  return {
    id: String(partner.id || crypto.randomUUID()),
    status: partner.status || 'PENDING',
    name: partner.name || '',
    address: partner.address || '',
    lat: partner.lat != null ? Number(partner.lat) : null,
    lng: partner.lng != null ? Number(partner.lng) : null,
    whatsapp: partner.whatsapp || '',
    photos: Array.isArray(partner.photos) ? partner.photos.filter(Boolean) : [],
    tags: Array.isArray(partner.tags) ? partner.tags.filter(Boolean) : [],
    created_at: partner.created_at || now,
    updated_at: now,
  };
}

async function getAll() {
  const pool = db.getPool();
  if (!pool) return readAll();
  const { rows } = await pool.query('SELECT * FROM partners ORDER BY created_at DESC');
  return rows.map((row) => ({
    ...row,
    photos: Array.isArray(row.photos) ? row.photos : row.photos ? row.photos : [],
    tags: Array.isArray(row.tags) ? row.tags : row.tags ? row.tags : [],
  }));
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    return readAll().find((partner) => String(partner.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM partners WHERE id=$1', [id]);
  return rows[0] || null;
}

async function create(partner) {
  const record = normalizePartner(partner);
  const pool = db.getPool();
  if (!pool) {
    const list = readAll();
    list.push(record);
    writeAll(list);
    return record;
  }
  await pool.query(
    `INSERT INTO partners (id, status, name, address, lat, lng, whatsapp, photos, tags, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)` ,
    [
      record.id,
      record.status,
      record.name,
      record.address,
      record.lat,
      record.lng,
      record.whatsapp,
      JSON.stringify(record.photos || []),
      JSON.stringify(record.tags || []),
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
    const idx = list.findIndex((partner) => String(partner.id) === String(id));
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
    `UPDATE partners SET status=$2, name=$3, address=$4, lat=$5, lng=$6, whatsapp=$7,
     photos=$8, tags=$9, updated_at=$10 WHERE id=$1`,
    [
      id,
      merged.status,
      merged.name,
      merged.address,
      merged.lat,
      merged.lng,
      merged.whatsapp,
      JSON.stringify(merged.photos || []),
      JSON.stringify(merged.tags || []),
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
