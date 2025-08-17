const db = require('../db');
const ordersRepo = require('../data/ordersRepo');
const productsRepo = require('../data/productsRepo');
const { resolveFromWebhook } = require('../services/mercadoPago');

const logger = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

function mapStatus(mpStatus) {
  const s = String(mpStatus || '').toLowerCase();
  if (s === 'approved') return 'approved';
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(s))
    return 'rejected';
  return 'pending';
}

async function processNotification(reqOrTopic, maybeId) {
  const body = reqOrTopic?.body || {};
  const query = reqOrTopic?.query || {};
  const topic =
    query.topic ||
    query.type ||
    body.type ||
    body.topic ||
    (typeof reqOrTopic === 'string' ? reqOrTopic : undefined);
  const rawId =
    query.id ||
    body?.data?.id ||
    body?.id ||
    (typeof reqOrTopic === 'string' ? maybeId : undefined) ||
    maybeId;

  const info = await resolveFromWebhook({ topic, id: rawId, body, query });
  const orderId = info.externalRef || info.preferenceId;
  if (!orderId) {
    logger.warn('mp-webhook unresolved', { topic, rawId });
    return;
  }

  const pool = db.getPool();
  const items = info.items || [];
  logger.info('mp-items', { source: info.source || 'unknown', count: items.length });

  if (!pool) {
    // JSON fallback
    await ordersRepo.insertOrderItemsIfMissing(orderId, items);
    await ordersRepo.recalcOrderTotal(orderId);
    const order = await ordersRepo.getById(orderId);
    const mapped = mapStatus(info.status);
    if (order) {
      order.status = mapped;
      await ordersRepo.saveAll([order]);
      if (mapped === 'approved' && !order.inventory_applied) {
        for (const it of items) {
          const prods = await productsRepo.getAll();
          const prod = prods.find((p) => p.sku === it.sku);
          if (prod) await productsRepo.adjustStock(prod.id, -it.qty, 'sale', orderId);
        }
        await ordersRepo.markInventoryApplied(orderId);
      }
    }
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO orders (id, nrn, preference_id, email, status, total, inventory_applied, created_at, updated_at)
       VALUES ($1,$1,$2,$3,$4,0,false,now(),now())
       ON CONFLICT (id) DO UPDATE SET preference_id=EXCLUDED.preference_id, email=COALESCE(EXCLUDED.email,orders.email), status=EXCLUDED.status, updated_at=now()`,
      [orderId, info.preferenceId || null, info.email || null, mapStatus(info.status)]
    );
    const { rows } = await client.query(
      'SELECT inventory_applied FROM orders WHERE id=$1 FOR UPDATE',
      [orderId]
    );
    const inventoryApplied = rows[0] ? rows[0].inventory_applied : false;

    const inserted = await ordersRepo.insertOrderItemsIfMissing(orderId, items, client);
    if (inserted) logger.info('mp-order_items inserted', { orderId, count: inserted });
    await ordersRepo.recalcOrderTotal(orderId, client);

    if (mapStatus(info.status) === 'approved' && !inventoryApplied) {
      for (const it of items) {
        const { rows: pidRows } = await client.query(
          'SELECT id FROM products WHERE sku=$1',
          [it.sku]
        );
        const pid = pidRows[0] ? pidRows[0].id : null;
        if (!pid) continue;
        await client.query(
          'UPDATE products SET stock=stock-$1, updated_at=now() WHERE id=$2',
          [it.qty, pid]
        );
        await client.query(
          'INSERT INTO stock_movements(id, product_id, qty, reason, order_id, created_at) VALUES ($1,$2,$3,$4,$5,now())',
          [require('crypto').randomUUID(), pid, -it.qty, 'sale', orderId]
        );
      }
      await client.query(
        'UPDATE orders SET inventory_applied=true WHERE id=$1',
        [orderId]
      );
      logger.info('mp-inventory applied', { orderId });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('mp-webhook error', e);
  } finally {
    client.release();
  }
}

module.exports = { processNotification };
