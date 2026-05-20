const catalogInventoryRepo = require('./catalogInventoryRepo');

async function applyForOrder(order) {
  return catalogInventoryRepo.applyOrderInventory(order);
}

async function revertForOrder(order) {
  return catalogInventoryRepo.revertOrderInventory(order);
}

module.exports = { applyForOrder, revertForOrder };
