// CODEXFIX: importa productos desde seed.json
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function toNum(v) {
  // CODEXFIX: normalizador de números
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v
      .replace(/[^0-9.,-]/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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
  const seedPath = path.join(__dirname, 'seed.json');
  if (!fs.existsSync(seedPath)) {
    console.warn('seed.json not found, skipping'); // CODEXFIX
    await pool.end();
    return;
  }
  const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.products || [];
  for (const p of list) {
    const tags = Array.isArray(p.tags) ? p.tags.join(',') : p.tags || null;
    await pool.query(
      `INSERT INTO products (sku, name, brand, model, category, subcategory, tags, stock, min_stock, price, price_min, price_may, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name,
         brand=EXCLUDED.brand,
         model=EXCLUDED.model,
         category=EXCLUDED.category,
         subcategory=EXCLUDED.subcategory,
         tags=EXCLUDED.tags,
         stock=EXCLUDED.stock,
         min_stock=EXCLUDED.min_stock,
         price=EXCLUDED.price,
         price_min=EXCLUDED.price_min,
         price_may=EXCLUDED.price_may,
         image_url=EXCLUDED.image_url`,
      [
        p.sku || null,
        p.name || '',
        p.brand || null,
        p.model || null,
        p.category || null,
        p.subcategory || null,
        tags,
        toNum(p.stock),
        toNum(p.min_stock),
        toNum(p.price),
        toNum(p.price_min),
        toNum(p.price_may),
        p.image_url || null,
      ]
    );
  }
  await pool.end();
}

run().catch((e) => {
  console.error('seed failed', e); // CODEXFIX
  process.exit(1);
});
