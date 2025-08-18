const { Pool } = require('pg');

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not set');
    return null;
  }
  const u = new URL(url);
  const ssl = u.hostname.includes('.internal') ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: url, ssl });
}

async function run() {
  const pool = createPool();
  if (!pool) return;
  await pool.query('TRUNCATE TABLE products RESTART IDENTITY');
  await pool.end();
  console.log('TRUNCATE OK');
  process.exit(0);
}

run().catch((e) => {
  console.error('wipe failed', e);
  process.exit(1);
});
