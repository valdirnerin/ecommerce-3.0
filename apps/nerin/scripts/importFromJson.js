const fs = require('fs');
const path = require('path');
const db = require('../backend/db');
const dataDir = require('../backend/utils/dataDir');

async function importProducts(pool) {
  const file = path.join(dataDir, 'products.json');
  let products = [];
  try {
    products = JSON.parse(fs.readFileSync(file, 'utf8')).products || [];
  } catch {}
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
           metadata=EXCLUDED.metadata`,
        [p.id, p.name, p.price, p.stock, p.image_url, p.metadata || null]
      );
    }
    await pool.query('COMMIT');
    console.log(`Imported ${products.length} products`);
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function importOrders(pool) {
  const file = path.join(dataDir, 'orders.json');
  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(file, 'utf8')).orders || [];
  } catch {}
  await pool.query('BEGIN');
  try {
    for (const o of orders) {
      await pool.query(
        'INSERT INTO orders (id, created_at, customer_email, status, total, inventory_applied) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [o.id, o.created_at || new Date(), o.cliente?.email || null, o.payment_status || o.estado_pago || 'pendiente', o.total || 0, o.inventoryApplied || o.inventory_applied || false]
      );
      for (const it of o.productos || o.items || []) {
        const id = it.productId || it.id;
        const qty = Number(it.quantity || it.qty || 0);
        const price = Number(it.price || 0);
        if (!id) continue;
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [o.id, id, qty, price]
        );
      }
    }
    await pool.query('COMMIT');
    console.log(`Imported ${orders.length} orders`);
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const pool = db.getPool();
  if (!pool) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  await importProducts(pool);
  await importOrders(pool);
  await pool.end();
}

main().catch((e) => {
  console.error('Import failed', e);
  process.exit(1);
});
