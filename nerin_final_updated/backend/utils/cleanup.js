const fs = require('fs').promises;
const path = require('path');
const { UPLOADS_DIR, INVOICES_DIR, CACHE_DIR } = require('../config/storage');

async function cleanDir(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (entry.name.endsWith('.tmp')) {
          await fs.unlink(full).catch(() => {});
          continue;
        }
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > 48 * 60 * 60 * 1000) {
          await fs.unlink(full).catch(() => {});
        }
      }
    }
  } catch {}
}

async function cleanup() {
  await Promise.all([cleanDir(UPLOADS_DIR), cleanDir(INVOICES_DIR), cleanDir(CACHE_DIR)]);
}

module.exports = cleanup;
