const catalogInventoryRepo = require('../data/catalogInventoryRepo');

async function applyInventoryForOrder(order) {
  return catalogInventoryRepo.applyOrderInventory(order);
}

async function revertInventoryForOrder(order) {
  return catalogInventoryRepo.revertOrderInventory(order);
}

module.exports = { applyInventoryForOrder, revertInventoryForOrder };
