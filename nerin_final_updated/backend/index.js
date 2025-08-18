// Servidor Express básico para NERIN
// CODEXFIX: backend simplificado con conexión a Postgres y frontend estático

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

function createPool() {
  if (!DATABASE_URL) {
    console.warn('DATABASE_URL not set'); // CODEXFIX
    return null;
  }
  const url = new URL(DATABASE_URL);
  const ssl = url.hostname.includes('.internal')
    ? false
    : { rejectUnauthorized: false }; // CODEXFIX
  return new Pool({ connectionString: DATABASE_URL, ssl });
}

const pool = createPool();

function normalizePrice(v) {
  // CODEXFIX: normalizador de precios
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

async function initDB() {
  if (!pool) return;
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql); // CODEXFIX
  } catch (e) {
    console.error('initDB error', e); // CODEXFIX
  }
}

initDB();

const app = express();
app.use(express.json());

const publicDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(publicDir)); // CODEXFIX

app.get('/api/health', (_req, res) => {
  res.json({ ok: true }); // CODEXFIX
});

app.get('/api/products', async (_req, res) => {
  try {
    if (!pool) return res.json({ products: [] }); // CODEXFIX
    const { rows } = await pool.query(
      'SELECT id, sku, name, brand, model, category, subcategory, tags, stock, min_stock, price, price_min, price_may, image_url FROM products'
    );
    const products = rows.map((p) => ({
      ...p,
      stock: Number(p.stock ?? 0),
      min_stock: p.min_stock != null ? Number(p.min_stock) : null,
      price: normalizePrice(p.price),
      price_min: normalizePrice(p.price_min),
      price_may: normalizePrice(p.price_may),
      tags: p.tags ? p.tags.split(',').map((t) => t.trim()) : [],
    }));
    res.json({ products });
  } catch (e) {
    console.error('/api/products', e); // CODEXFIX
    res.status(500).json({ error: 'failed to fetch products' });
  }
});

const pageMap = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/shop.html': 'shop.html',
  '/admin.html': 'admin.html',
  '/contacto.html': 'contact.html',
};

app.get(Object.keys(pageMap), (req, res) => {
  res.sendFile(path.join(publicDir, pageMap[req.path])); // CODEXFIX
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`); // CODEXFIX
});
