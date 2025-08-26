const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/storage');

function safeJoin(base, file) {
  const target = path.resolve(base, file);
  if (!target.startsWith(path.resolve(base))) {
    throw new Error('Invalid path');
  }
  return target;
}

function pathFor(file) {
  return safeJoin(DATA_DIR, file);
}

function readJSONSafe(file, defVal) {
  try {
    const content = fs.readFileSync(pathFor(file), 'utf8');
    return JSON.parse(content);
  } catch {
    return defVal;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(pathFor(file), JSON.stringify(data, null, 2));
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
  } catch {}
}

function initializeData() {
  ensureDataDir();
  const defaults = {
    'products.json': { products: [] },
    'orders.json': { orders: [] },
    'clients.json': { clients: [] },
    'returns.json': { returns: [] },
  };
  const legacyDirs = [
    path.resolve(__dirname, '../data'),
    path.resolve(__dirname, '../../data'),
  ];

  for (const [file, def] of Object.entries(defaults)) {
    const dest = pathFor(file);
    if (fs.existsSync(dest)) continue;
    let copied = false;
    for (const dir of legacyDirs) {
      const legacyPath = path.join(dir, file);
      if (fs.existsSync(legacyPath)) {
        fs.copyFileSync(legacyPath, dest);
        copied = true;
        break;
      }
    }
    if (!copied) {
      writeJSON(file, def);
    }
  }
}

module.exports = { pathFor, readJSONSafe, writeJSON, initializeData };

