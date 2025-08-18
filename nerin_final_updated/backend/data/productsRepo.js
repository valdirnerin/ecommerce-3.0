const fs = require('fs');
const path = require('path');
const db = require('../db');

const filePath = path.join(__dirname, '../../data/products.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).products || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query(
    `SELECT id, sku, name, brand, model, category, subcategory,
            tags, stock, min_stock, price, price_minorista,
            price_mayorista, image, updated_at
     FROM products
     ORDER BY CAST(id AS INTEGER) NULLS LAST, id`
  );
  return rows;
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const prods = await getAll();
    return prods.find((p) => String(p.id) === String(id)) || null;
  }
  const { rows } = await pool.query(
    `SELECT id, sku, name, brand, model, category, subcategory,
            tags, stock, min_stock, price, price_minorista,
            price_mayorista, image, updated_at
     FROM products WHERE id=$1`,
    [id]
  );
  return rows[0] || null;
}

// normaliza "" -> null y números
const toNum = (v) => (v === '' || v == null ? null : Number(v));
const toInt = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const toJson = (v) => {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') {
    try { return JSON.stringify(JSON.parse(v)); } catch { return JSON.stringify([v]); }
  }
  return JSON.stringify(v);
};

async function save(product) {
  const pool = db.getPool();
  if (!pool) {
    // archivo
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(product.id));
    const merged = { ...(idx !== -1 ? products[idx] : {}), ...product };
    if (idx !== -1) products[idx] = merged; else products.push(merged);
    fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), 'utf8');
    return;
  }
  // DB
  const vals = {
    id: String(product.id),
    sku: product.sku ?? null,
    name: product.name ?? null,
    brand: product.brand ?? null,
    model: product.model ?? null,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    tags: toJson(product.tags),
    stock: toInt(product.stock),
    min_stock: toInt(product.min_stock),
    price: toNum(product.price),
    price_minorista: toNum(product.price_minorista),
    price_mayorista: toNum(product.price_mayorista),
    image: product.image ?? product.image_url ?? null
  };

  await pool.query(
    `INSERT INTO products
       (id, sku, name, brand, model, category, subcategory, tags,
        stock, min_stock, price, price_minorista, price_mayorista, image, created_at, updated_at)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       sku=EXCLUDED.sku,
       name=EXCLUDED.name,
       brand=EXCLUDED.brand,
       model=EXCLUDED.model,
       category=EXCLUDED.category,
       subcategory=EXCLUDED.subcategory,
       tags=EXCLUDED.tags,
       stock=EXCLUDED.stock,
       min_stock=EXCLUDED.min_stock,
       price=EXCLUDED.price,
       price_minorista=EXCLUDED.price_minorista,
       price_mayorista=EXCLUDED.price_mayorista,
       image=EXCLUDED.image,
       updated_at=now()`,
    [
      vals.id, vals.sku, vals.name, vals.brand, vals.model, vals.category,
      vals.subcategory, vals.tags, vals.stock, vals.min_stock, vals.price,
      vals.price_minorista, vals.price_mayorista, vals.image
    ]
  );
}

async function saveAll(products) {
  for (const p of products) await save(p);
}

async function updatePrice(id, newPrice) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      products[idx].price = newPrice;
      fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), 'utf8');
    }
    return;
  }
  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query('SELECT price FROM products WHERE id=$1', [id]);
    const oldPrice = rows[0] ? rows[0].price : null;
    await pool.query('UPDATE products SET price=$1, updated_at=now() WHERE id=$2', [newPrice, id]);
    await pool.query(
      'INSERT INTO price_changes(id, product_id, old_price, new_price) VALUES ($1,$2,$3,$4)',
      [require('crypto').randomUUID(), id, oldPrice, newPrice]
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function adjustStock(id, qty, reason='manual', orderId=null) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      const before = Number(products[idx].stock || 0);
      let after = before + Number(qty);
      if (after < 0) after = 0;
      products[idx].stock = after;
      fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), 'utf8');
    }
    return;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'UPDATE products SET stock=GREATEST(COALESCE(stock,0) + $1, 0), updated_at=now() WHERE id=$2',
      [Number(qty), String(id)]
    );
    await pool.query(
      'INSERT INTO stock_movements(id, product_id, qty, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [require('crypto').randomUUID(), String(id), Number(qty), reason, orderId]
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function remove(id) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      products.splice(idx, 1);
      fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), 'utf8');
    }
    return;
  }
  await pool.query('DELETE FROM products WHERE id=$1', [String(id)]);
}

module.exports = { getAll, getById, saveAll, save, updatePrice, adjustStock, remove };

