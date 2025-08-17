const fs = require('fs');
const path = require('path');
const db = require('../db');
const productsRepo = require('./productsRepo');

const filePath = path.join(__dirname, '../../data/orders.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).orders || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query(
    `SELECT o.id, o.nrn, o.preference_id, o.email, o.status,
            COALESCE(o.total, SUM(oi.qty*oi.price), 0) AS total,
            o.inventory_applied, o.created_at, o.updated_at
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id
     ORDER BY o.created_at DESC`
  );
  return rows;
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }
  const { rows } = await pool.query(
    'SELECT id, nrn, preference_id, email, status, total, inventory_applied, created_at, updated_at FROM orders WHERE id=$1',
    [id]
  );
  if (!rows[0]) return null;
  const order = rows[0];
  const items = await pool.query(
    'SELECT product_id, qty, price FROM order_items WHERE order_id=$1',
    [id]
  );
  order.items = items.rows;
  return order;
}

const orderItemsPath = path.join(
  __dirname,
  '../../data/order_items.json'
);

async function insertOrderItemsIfMissing(orderId, items, client) {
  const pool = client || db.getPool();
  if (!pool) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(orderItemsPath, 'utf8'));
    } catch {
      data = { order_items: [] };
    }
    const existing = data.order_items.filter((it) => it.order_id === orderId);
    if (existing.length) return 0;
    for (const it of items) {
      const prods = await productsRepo.getAll();
      const prod = prods.find((p) => String(p.sku) === String(it.sku));
      if (!prod) continue;
      data.order_items.push({
        order_id: orderId,
        product_id: prod.id,
        qty: Number(it.qty),
        price: Number(it.price),
      });
    }
    fs.writeFileSync(orderItemsPath, JSON.stringify(data, null, 2), 'utf8');
    return items.length;
  }
  const { rows } = await pool.query(
    'SELECT 1 FROM order_items WHERE order_id=$1 LIMIT 1',
    [orderId]
  );
  if (rows.length) return 0;
  for (const it of items) {
    const { rows: pidRows } = await pool.query(
      'SELECT id FROM products WHERE sku=$1',
      [it.sku]
    );
    const pid = pidRows[0] ? pidRows[0].id : null;
    if (!pid) continue;
    await pool.query(
      'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
      [orderId, pid, Number(it.qty), Number(it.price)]
    );
  }
  return items.length;
}

async function recalcOrderTotal(orderId, client) {
  const pool = client || db.getPool();
  if (!pool) {
    let orders = await getAll();
    const idx = orders.findIndex((o) => String(o.id) === String(orderId));
    if (idx === -1) return 0;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(orderItemsPath, 'utf8'));
    } catch {
      data = { order_items: [] };
    }
    const total = data.order_items
      .filter((it) => it.order_id === orderId)
      .reduce((t, it) => t + Number(it.qty) * Number(it.price), 0);
    orders[idx].total = total;
    fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), 'utf8');
    return total;
  }
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(qty*price),0) AS t FROM order_items WHERE order_id=$1',
    [orderId]
  );
  const total = rows[0] ? Number(rows[0].t) : 0;
  await pool.query(
    'UPDATE orders SET total=$2, updated_at=now() WHERE id=$1 AND (total IS NULL OR total=0)',
    [orderId, total]
  );
  return total;
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
        `INSERT INTO orders (id, nrn, preference_id, email, status, total, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()),now())
         ON CONFLICT (id) DO UPDATE SET
           nrn=EXCLUDED.nrn,
           preference_id=EXCLUDED.preference_id,
           email=EXCLUDED.email,
           status=EXCLUDED.status,
           total=EXCLUDED.total,
           updated_at=now()` ,
        [
          o.id,
          o.nrn || null,
          o.preference_id || null,
          o.email || o.customer_email || null,
          o.status || 'pendiente',
          o.total || 0,
          o.created_at || null,
        ]
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
      'INSERT INTO orders (id, nrn, preference_id, email, status, total, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now())',
      [
        order.id,
        order.nrn || null,
        order.preference_id || null,
        order.email || order.customer_email || null,
        order.status || 'pendiente',
        order.total || 0,
      ]
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

async function createOrder({ id, email, customer_email, items, preference_id, nrn }) {
  const pool = db.getPool();
  const mail = email || customer_email || null;
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
      email: mail,
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
      if (pid && qty) await productsRepo.adjustStock(pid, -qty, 'order', id);
    }
    return order;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO orders (id, nrn, preference_id, email, status, total, inventory_applied, created_at, updated_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,false,now(),now()) ON CONFLICT (id) DO NOTHING',
      [id, nrn || null, preference_id || null, mail, 'approved', total]
    );
    const { rows } = await pool.query(
      'SELECT inventory_applied FROM orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    const already = rows[0] && rows[0].inventory_applied;
    if (already) {
      await pool.query(
        'UPDATE orders SET email=COALESCE($2,email), total=$3, updated_at=now() WHERE id=$1',
        [id, mail, total]
      );
      await pool.query('COMMIT');
      return { id, email: mail, status: 'approved', total };
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
        'INSERT INTO stock_movements(id, product_id, qty, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [require('crypto').randomUUID(), pid, -qty, 'order', id]
      );
    }
    await pool.query(
      'UPDATE orders SET inventory_applied=true, email=COALESCE($2,email), total=$3, updated_at=now() WHERE id=$1',
      [id, mail, total]
    );
    await pool.query('COMMIT');
    return { id, email: mail, status: 'approved', total };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function markInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex((o) => String(o.id) === String(id));
    if (idx !== -1) {
      orders[idx].inventory_applied = true;
      fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), 'utf8');
    }
    return;
  }
  await pool.query('UPDATE orders SET inventory_applied=true, updated_at=now() WHERE id=$1', [id]);
}

async function clearInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex((o) => String(o.id) === String(id));
    if (idx !== -1) {
      orders[idx].inventory_applied = false;
      fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), 'utf8');
    }
    return;
  }
  await pool.query('UPDATE orders SET inventory_applied=false, updated_at=now() WHERE id=$1', [id]);
}

module.exports = {
  getAll,
  getById,
  saveAll,
  create,
  createOrder,
  insertOrderItemsIfMissing,
  recalcOrderTotal,
  markInventoryApplied,
  clearInventoryApplied,
};
