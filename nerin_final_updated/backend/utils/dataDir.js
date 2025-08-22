const path = require('path');
const fs = require('fs');

const DISK_PATH = process.env.RENDER_DISK_PATH || path.join(__dirname, '..', '..');
const DATA_DIR = path.join(DISK_PATH, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = DATA_DIR;
