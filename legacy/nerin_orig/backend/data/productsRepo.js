const fs = require('fs');
const path = require('path');
const db = require('../db');
const dataDir = require('../utils/dataDir');

const filePath = path.join(dataDir, 'products.json');

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
    'SELECT id, name, price, stock, image_url, metadata, updated_at FROM products ORDER BY id'
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
    'SELECT id, name, price, stock, image_url, metadata, updated_at FROM products WHERE id=$1',
    [id]
  );
  return rows[0] || null;
}

async function saveAll(products) {
  const pool = db.getPool();
  if (!pool) {
    await fs.promises.writeFile(
      filePath,
      JSON.stringify({ products }, null, 2),
      'utf8'
    );
    return;
  }
  await pool.query('BEGIN');
  try {
    for (const p of products) {
      await pool.query(
        `INSERT INTO products (id, name, price, stock, image_url, metadata)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name,
           price=EXCLUDED.price,
           stock=EXCLUDED.stock,
           image_url=EXCLUDED.image_url,
           metadata=EXCLUDED.metadata,
           updated_at=now()`,
        [p.id, p.name, p.price, p.stock, p.image_url, p.metadata || null]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function updatePrice(id, newPrice, changedBy = 'system') {
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
      'INSERT INTO price_changes(product_id, old_price, new_price, changed_by) VALUES ($1,$2,$3,$4)',
      [id, oldPrice, newPrice, changedBy]
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function adjustStock(id, delta, reason = 'manual', refId = null) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      const before = Number(products[idx].stock || 0);
      let after = before + Number(delta);
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
      [delta, id]
    );
    await pool.query(
      'INSERT INTO stock_movements(product_id, delta, reason, ref_id) VALUES ($1,$2,$3,$4)',
      [id, delta, reason, refId]
    );
    await pool.query('COMMIT');
    return rows[0] ? rows[0].stock : null;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

module.exports = { getAll, getById, saveAll, updatePrice, adjustStock };
