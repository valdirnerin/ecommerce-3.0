const fs = require('fs');
const path = require('path');

const STORAGE_DIR = process.env.STORAGE_DIR || '/var/nerin-data';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(STORAGE_DIR, 'uploads');
const INVOICES_DIR = process.env.INVOICES_DIR || path.join(STORAGE_DIR, 'invoices');
const DATA_DIR = process.env.DATA_DIR || path.join(STORAGE_DIR, 'data');
const CACHE_DIR = process.env.CACHE_DIR || path.join(STORAGE_DIR, 'cache');
const LOG_DIR = process.env.LOG_DIR || path.join(STORAGE_DIR, 'logs');

for (const dir of [STORAGE_DIR, UPLOADS_DIR, INVOICES_DIR, DATA_DIR, CACHE_DIR, LOG_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  } catch {}
}

module.exports = { STORAGE_DIR, UPLOADS_DIR, INVOICES_DIR, DATA_DIR, CACHE_DIR, LOG_DIR };
