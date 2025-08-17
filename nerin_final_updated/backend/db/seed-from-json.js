const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  });

  await pool.query('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value JSONB)');

  const { rows } = await pool.query('SELECT COUNT(*) FROM products');
  if (Number(rows[0].count) === 0) {
    const seedPath = fs.existsSync(path.join(__dirname, '../../data/products.seed.json'))
      ? path.join(__dirname, '../../data/products.seed.json')
      : path.join(__dirname, '../../data/products.json');
    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.products || [];
    for (const p of list) {
      const price = p.price != null ? p.price : p.price_minorista || 0;
      await pool.query(
        'INSERT INTO products(id, name, price, stock, sku, category) VALUES ($1,$2,$3,$4,$5,$6)',
        [String(p.id || crypto.randomUUID()), p.name || '', price, p.stock || 0, p.sku || null, p.category || null]
      );
    }
  }

  const cfg = await pool.query('SELECT COUNT(*) FROM config');
  if (Number(cfg.rows[0].count) === 0) {
    await pool.query('INSERT INTO config(key, value) VALUES ($1, $2::jsonb)', ['general', JSON.stringify({})]);
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
