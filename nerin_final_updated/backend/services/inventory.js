const fs = require('fs');
const path = require('path');

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

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
  const release = acquireLock();
  try {
    const orders = getOrders();
    const idx = findOrderIndex(orders, order);
    if (idx === -1) return false;
    const row = orders[idx];
    if (row.inventory_applied) {
      logger.info('inventory skipped (already applied)', {
        order: row.id || row.external_reference,
      });
      return false;
    }
    const products = getProducts();
    const logItems = [];
    let oversell = false;
    (row.productos || row.items || []).forEach((it) => {
      const pIdx = products.findIndex(
        (p) => String(p.id) === String(it.id) || p.sku === it.sku,
      );
      if (pIdx !== -1) {
        const current = Number(products[pIdx].stock || 0);
        const qty = Number(it.quantity || 0);
        let next = current - qty;
        if (next < 0) {
          oversell = true;
          next = 0;
          products[pIdx].oversell = true;
        }
        products[pIdx].stock = next;
        logItems.push({ sku: products[pIdx].sku, qty });
      }
    });
    saveProducts(products);
    row.inventory_applied = true;
    row.inventory_applied_at = new Date().toISOString();
    if (oversell) row.oversell = true;
    orders[idx] = row;
    saveOrders(orders);
    logger.info('inventory applied for ' + (row.id || row.external_reference), {
      items: logItems,
    });
    return true;
  } finally {
    release();
  }
}

function revertInventoryForOrder(order) {
  const release = acquireLock();
  try {
    const orders = getOrders();
    const idx = findOrderIndex(orders, order);
    if (idx === -1) return false;
    const row = orders[idx];
    if (!row.inventory_applied) {
      logger.info('inventory skipped (not applied)', {
        order: row.id || row.external_reference,
      });
      return false;
    }
    const products = getProducts();
    const logItems = [];
    (row.productos || row.items || []).forEach((it) => {
      const pIdx = products.findIndex(
        (p) => String(p.id) === String(it.id) || p.sku === it.sku,
      );
      if (pIdx !== -1) {
        const qty = Number(it.quantity || 0);
        products[pIdx].stock = Number(products[pIdx].stock || 0) + qty;
        logItems.push({ sku: products[pIdx].sku, qty });
      }
    });
    saveProducts(products);
    row.inventory_applied = false;
    row.inventory_applied_at = null;
    delete row.oversell;
    orders[idx] = row;
    saveOrders(orders);
    logger.info('inventory reverted for ' + (row.id || row.external_reference), {
      items: logItems,
    });
    return true;
  } finally {
    release();
  }
}

module.exports = { applyInventoryForOrder, revertInventoryForOrder };
