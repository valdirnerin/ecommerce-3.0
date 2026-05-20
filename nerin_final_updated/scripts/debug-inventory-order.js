#!/usr/bin/env node

const catalogInventoryRepo = require("../backend/data/catalogInventoryRepo");

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("Uso: node scripts/debug-inventory-order.js ORDER_ID");
    process.exit(1);
  }
  const payload = await catalogInventoryRepo.debugOrderInventory(orderId);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.errors && payload.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[debug-inventory-order] failed", error);
  process.exit(1);
});
