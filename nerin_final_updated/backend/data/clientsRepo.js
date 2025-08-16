const fs = require('fs');
const path = require('path');
const db = require('../db');

const filePath = path.join(__dirname, '../../data/clients.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).clients || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query('SELECT * FROM clients');
  return rows;
}

module.exports = { getAll };
