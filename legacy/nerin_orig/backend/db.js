const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_URL.includes('render.com') || process.env.RENDER
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  return p.query(text, params);
}

async function init() {
  const p = getPool();
  if (!p) return;
  const schemaPath = path.join(__dirname, '../scripts/schema.sql');
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await p.query(sql);
  } catch (e) {
    console.error('db init fail', e.message);
  }
}

module.exports = { getPool, query, init };
