// CODEXFIX: ejecuta migraciones idempotentes
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not set'); // CODEXFIX
    return null;
  }
  const u = new URL(url);
  const ssl = u.hostname.includes('.internal')
    ? false
    : { rejectUnauthorized: false }; // CODEXFIX
  return new Pool({ connectionString: url, ssl });
}

async function run() {
  const pool = createPool();
  if (!pool) return;
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql); // CODEXFIX
  await pool.end();
}

run().catch((e) => {
  console.error('migrate failed', e); // CODEXFIX
  process.exit(1);
});
