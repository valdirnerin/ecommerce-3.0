const fs = require('fs');
const path = require('path');
const db = require('../db');
const { DATA_DIR: dataDir } = require('../utils/dataDir');

const filePath = path.join(dataDir, 'invoices.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).invoices || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query('SELECT * FROM invoices');
  return rows;
}

module.exports = { getAll };
