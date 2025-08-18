const { Pool } = require('pg');

function poolFromEnv() {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.warn('DATABASE_URL not set'); return null; }
  const host = new URL(cs).hostname;
  const ssl = host.includes('.internal') ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: cs, ssl });
}

(async () => {
  const pool = poolFromEnv(); if (!pool) process.exit(1);
  const sql = `
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='order_items') THEN
      EXECUTE 'TRUNCATE TABLE order_items RESTART IDENTITY CASCADE';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='orders') THEN
      EXECUTE 'TRUNCATE TABLE orders RESTART IDENTITY CASCADE';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='products') THEN
      EXECUTE 'TRUNCATE TABLE products RESTART IDENTITY CASCADE';
    END IF;
  END$$;`;
  await pool.query(sql);
  console.log('TRUNCATE OK');
  process.exit(0);
})().catch(e => { console.error('wipe failed', e); process.exit(1); });
