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
    'SELECT id, name, price, stock, sku, category, updated_at FROM products ORDER BY id'
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
    'SELECT id, name, price, stock, sku, category, updated_at FROM products WHERE id=$1',
    [id]
  );
  return rows[0] || null;
}

async function save(product) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(product.id));
    if (idx !== -1) products[idx] = { ...products[idx], ...product };
    else products.push(product);
    fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), 'utf8');
    return;
  }
  await pool.query(
    `INSERT INTO products (id, name, price, stock, sku, category, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name,
       price=EXCLUDED.price,
       stock=EXCLUDED.stock,
       sku=EXCLUDED.sku,
       category=EXCLUDED.category,
       updated_at=now()`,
    [product.id, product.name, product.price, product.stock, product.sku, product.category]
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
      saveAll(products);
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

async function adjustStock(id, qty, reason = 'manual', orderId = null) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      const before = Number(products[idx].stock || 0);
      let after = before + Number(qty);
      if (after < 0) after = 0;
      products[idx].stock = after;
      saveAll(products);
    }
    return;
  }
  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query(
      'UPDATE products SET stock=GREATEST(stock + $1,0), updated_at=now() WHERE id=$2 RETURNING stock',
      [qty, id]
    );
    await pool.query(
      'INSERT INTO stock_movements(id, product_id, qty, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [require('crypto').randomUUID(), id, qty, reason, orderId]
    );
    await pool.query('COMMIT');
    return rows[0] ? rows[0].stock : null;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}
module.exports = { getAll, getById, saveAll, save, updatePrice, adjustStock };
