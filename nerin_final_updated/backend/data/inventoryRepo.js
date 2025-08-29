const productsRepo = require('./productsRepo');
const ordersRepo = require('./ordersRepo');

async function applyForOrder(order) {
  const items = [];
  let total = 0;
  for (const it of order.productos || order.items || []) {
    const id = it.product_id || it.productId || it.id;
    const qty = Number(it.quantity || it.qty || 0);
    if (id && qty) {
      const before = (await productsRepo.getById(id))?.stock || 0;
      const after = await productsRepo.adjustStock(id, -qty, 'order', order.id);
      items.push({ sku: id, before: Number(before), after: Number(after) });
      total += qty;
    }
  }
  if (order.id) await ordersRepo.markInventoryApplied(order.id);
  return { total, items };
}

async function revertForOrder(order) {
  const items = [];
  let total = 0;
  for (const it of order.productos || order.items || []) {
    const id = it.product_id || it.productId || it.id;
    const qty = Number(it.quantity || it.qty || 0);
    if (id && qty) {
      const before = (await productsRepo.getById(id))?.stock || 0;
      const after = await productsRepo.adjustStock(id, qty, 'order-revert', order.id);
      items.push({ sku: id, before: Number(before), after: Number(after) });
      total += qty;
    }
  }
  if (order.id) {
    try {
      await ordersRepo.clearInventoryApplied(order.id);
    } catch {}
  }
  return { total, items };
}

module.exports = { applyForOrder, revertForOrder };
