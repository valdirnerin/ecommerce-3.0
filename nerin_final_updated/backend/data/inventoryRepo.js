const productsRepo = require('./productsRepo');
const ordersRepo = require('./ordersRepo');

async function applyForOrder(order) {
  for (const it of order.productos || order.items || []) {
    const id = it.product_id || it.productId || it.id;
    const qty = Number(it.quantity || it.qty || 0);
    if (id && qty) {
      await productsRepo.adjustStock(id, -qty, 'order', order.id);
    }
  }
  if (order.id) await ordersRepo.markInventoryApplied(order.id);
  return true;
}

async function revertForOrder(order) {
  for (const it of order.productos || order.items || []) {
    const id = it.product_id || it.productId || it.id;
    const qty = Number(it.quantity || it.qty || 0);
    if (id && qty) {
      await productsRepo.adjustStock(id, qty, 'order-revert', order.id);
    }
  }
  if (order.id) {
    try {
      await ordersRepo.clearInventoryApplied(order.id);
    } catch {}
  }
  return true;
}

module.exports = { applyForOrder, revertForOrder };
