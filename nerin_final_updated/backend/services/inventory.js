const fs = require('fs');
const path = require('path');

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};
const db = require('../db');
const inventoryRepo = require('../data/inventoryRepo');

function dataPath(file) {
  return path.join(__dirname, '../../data', file);
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(file), 'utf8'));
  } catch {
    return {};
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(dataPath(file), JSON.stringify(data, null, 2), 'utf8');
}

function getOrders() {
  return readJSON('orders.json').orders || [];
}

function saveOrders(orders) {
  writeJSON('orders.json', { orders });
}

function getProducts() {
  return readJSON('products.json').products || [];
}

function saveProducts(products) {
  writeJSON('products.json', { products });
}

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchProduct(products, item) {
  const id = normalize(item.productId || item.id);
  const sku = normalize(item.sku);
  const title = normalize(item.title || item.name);
  return (
    products.find((p) => normalize(p.id) === id || normalize(p.sku) === sku) ||
    products.find((p) => normalize(p.name) === title)
  );
}

function acquireLock() {
  const lockFile = dataPath('.inventory.lock');
  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      return () => {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lockFile); } catch {}
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // esperar 50ms y reintentar
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function findOrderIndex(orders, order) {
  const identifier =
    order.id || order.external_reference || order.order_number || order.preference_id;
  return orders.findIndex(
    (o) =>
      String(o.id) === String(identifier) ||
      String(o.external_reference) === String(identifier) ||
      String(o.order_number) === String(identifier) ||
      String(o.preference_id) === String(identifier)
  );
}

function applyInventoryForOrder(order) {
  if (db.getPool()) {
    return inventoryRepo.applyForOrder(order);
  }
  const release = acquireLock();
  try {
    const orders = getOrders();
    const idx = findOrderIndex(orders, order);
    if (idx === -1) return false;
    const row = orders[idx];
    if (row.inventoryApplied || row.inventory_applied) {
      logger.info(
        `inventory: skip (already applied) nrn=${row.external_reference || row.id} pref=${row.preference_id || ''}`,
      );
      return false;
    }
    const products = getProducts();
    const logItems = [];
    (row.productos || row.items || []).forEach((it) => {
      const prod = matchProduct(products, it);
      if (!prod) {
        logger.warn('inventory: product not found', { item: it });
        return;
      }
      const before = Number(prod.stock || 0);
      const qty = Number(it.quantity || it.qty || 0);
      let after = before - qty;
      if (after < 0) {
        logger.warn('inventory: negative stock', {
          id: prod.id || prod.sku,
          before,
          qty,
        });
        after = 0;
      }
      prod.stock = after;
      logItems.push({ id: prod.id || prod.sku, qty, before, after });
    });
    saveProducts(products);
    row.inventoryApplied = true;
    row.inventory_applied = true;
    row.inventory_applied_at = new Date().toISOString();
    orders[idx] = row;
    saveOrders(orders);
    const nrn = row.external_reference || row.id || row.order_number;
    logger.info(
      `inventory: apply nrn=${nrn} pref=${row.preference_id || ''} items=${JSON.stringify(logItems)}`,
    );
    return true;
  } finally {
    release();
  }
}

function revertInventoryForOrder(order) {
  if (db.getPool()) {
    return inventoryRepo.revertForOrder(order);
  }
  const release = acquireLock();
  try {
    const orders = getOrders();
    const idx = findOrderIndex(orders, order);
    if (idx === -1) return false;
    const row = orders[idx];
    if (!row.inventoryApplied && !row.inventory_applied) {
      logger.info(
        `inventory: skip (not applied) nrn=${row.external_reference || row.id} pref=${row.preference_id || ''}`,
      );
      return false;
    }
    const products = getProducts();
    const logItems = [];
    (row.productos || row.items || []).forEach((it) => {
      const prod = matchProduct(products, it);
      if (!prod) {
        logger.warn('inventory: product not found', { item: it });
        return;
      }
      const qty = Number(it.quantity || it.qty || 0);
      const before = Number(prod.stock || 0);
      const after = before + qty;
      prod.stock = after;
      logItems.push({ id: prod.id || prod.sku, qty, before, after });
    });
    saveProducts(products);
    row.inventoryApplied = false;
    row.inventory_applied = false;
    row.inventory_applied_at = null;
    delete row.oversell;
    orders[idx] = row;
    saveOrders(orders);
    const nrn = row.external_reference || row.id || row.order_number;
    logger.info(
      `inventory: revert nrn=${nrn} pref=${row.preference_id || ''} items=${JSON.stringify(logItems)}`,
    );
    return true;
  } finally {
    release();
  }
}

module.exports = { applyInventoryForOrder, revertInventoryForOrder };
