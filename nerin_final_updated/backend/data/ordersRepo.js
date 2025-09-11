const fs = require('fs');
const path = require('path');
const db = require('../db');
const productsRepo = require('./productsRepo');
const { DATA_DIR: dataDir } = require('../utils/dataDir');

const filePath = path.join(dataDir, 'orders.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).orders || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  return rows;
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!rows[0]) return null;
  const order = rows[0];
  const items = await pool.query(
    'SELECT product_id, qty, price FROM order_items WHERE order_id=$1',
    [id]
  );
  order.items = items.rows;
  return order;
}

async function saveAll(orders) {
  const pool = db.getPool();
  if (!pool) {
    fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), 'utf8');
    return;
  }
  await pool.query('BEGIN');
  try {
    for (const o of orders) {
      await pool.query(
        `INSERT INTO orders (id, created_at, customer_email, status, total)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           customer_email=EXCLUDED.customer_email,
           status=EXCLUDED.status,
           total=EXCLUDED.total`,
        [o.id, o.created_at || new Date(), o.customer_email || null, o.status || 'pendiente', o.total || 0]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function create(order) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    orders.push(order);
    await saveAll(orders);
    return order;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total) VALUES ($1, now(), $2, $3, $4)',
      [order.id, order.customer_email || null, order.status || 'pendiente', order.total || 0]
    );
    for (const it of order.items || []) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [order.id, it.product_id, it.qty, it.price]
      );
    }
    await pool.query('COMMIT');
    return order;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function createOrder({ id, customer_email, items }) {
  const pool = db.getPool();
  const total = (items || []).reduce(
    (t, it) => t + Number(it.price) * Number(it.qty || it.quantity || 0),
    0
  );
  if (!pool) {
    const orders = await getAll();
    const existing = orders.find((o) => String(o.id) === String(id));
    if (existing) return existing;
    const order = {
      id,
      customer_email,
      status: 'approved',
      total,
      created_at: new Date().toISOString(),
      items,
    };
    orders.push(order);
    await saveAll(orders);
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      if (pid && qty) {
        await productsRepo.adjustStock(pid, -qty, 'order', id);
      }
    }
    return order;
  }
  await pool.query('BEGIN');
  try {
    // Upsert primero, para evitar doble inserción en concurrencia
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total, inventory_applied) ' +
      'VALUES ($1, now(), $2, $3, $4, false) ' +
      'ON CONFLICT (id) DO NOTHING',
      [id, customer_email || null, 'approved', total]
    );
    // Ahora si: tomar lock de la fila
    const { rows } = await pool.query(
      'SELECT inventory_applied FROM orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    const alreadyApplied = !!(rows[0] && rows[0].inventory_applied);
    if (alreadyApplied) {
      await pool.query(
        'UPDATE orders SET customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
        [id, customer_email || null, total]
      );
      await pool.query('COMMIT');
      return { id, customer_email, status: 'approved', total };
    }
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      const price = Number(it.price || 0);
      if (!pid || !qty) continue;
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id, product_id) DO NOTHING',
        [id, pid, qty, price]
      );
      await pool.query(
        'UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at=now() WHERE id=$2',
        [qty, pid]
      );
      await pool.query(
        'INSERT INTO stock_movements(product_id, delta, reason, ref_id) VALUES ($1,$2,$3,$4)',
        [pid, -qty, 'order', id]
      );
    }
    await pool.query(
      'UPDATE orders SET inventory_applied=true, customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
      [id, customer_email || null, total]
    );
    await pool.query('COMMIT');
    return { id, customer_email, status: 'approved', total };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function markInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return; // JSON mode not used
  await pool.query('UPDATE orders SET inventory_applied = true WHERE id=$1', [id]);
}

async function clearInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return;
  await pool.query('UPDATE orders SET inventory_applied=false WHERE id=$1', [id]);
}

module.exports = {
  getAll,
  getById,
  saveAll,
  create,
  createOrder,
  markInventoryApplied,
  clearInventoryApplied,
};
