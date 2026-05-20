const fs = require("fs");
const fsp = fs.promises;
const productsSqliteRepo = require("./productsSqliteRepo");
const { dataPath } = require("../utils/dataDir");
const { mapPaymentStatusCode } = require("../utils/paymentStatus");

const MOVEMENTS_PATH = dataPath("inventory-movements.jsonl");
const LOCK_PATH = dataPath(".catalog-inventory.lock");

function wait(ms = 50) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  while (true) {
    try {
      const fd = fs.openSync(LOCK_PATH, "wx");
      return () => {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(LOCK_PATH); } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      wait(50);
    }
  }
}

function normalizeValue(value) {
  if (value == null) return "";
  return String(value).trim();
}

function getOrderId(order = {}) {
  return normalizeValue(order.id || order.order_id || order.orderId || order.order_number || order.orderNumber || order.external_reference || order.externalReference || order.preference_id || order.preferenceId);
}

function orderMatches(order = {}, identifier = "") {
  const target = normalizeValue(identifier);
  if (!target) return false;
  return [
    order.id,
    order.order_id,
    order.orderId,
    order.order_number,
    order.orderNumber,
    order.external_reference,
    order.externalReference,
    order.preference_id,
    order.preferenceId,
    order.payment_id,
    order.paymentId,
  ].some((value) => normalizeValue(value) === target);
}

async function findOrder(identifier) {
  const ordersRepo = require("./ordersRepo");
  if (typeof ordersRepo.getById === "function") {
    const direct = await ordersRepo.getById(identifier);
    if (direct) return direct;
  }
  const orders = typeof ordersRepo.getAll === "function" ? await ordersRepo.getAll() : [];
  return orders.find((order) => orderMatches(order, identifier)) || null;
}

function normalizeOrderItems(order = {}) {
  const source = Array.isArray(order.items) && order.items.length
    ? order.items
    : Array.isArray(order.productos)
      ? order.productos
      : [];
  return source
    .map((item, index) => {
      const qty = Number(item.qty ?? item.quantity ?? item.cantidad ?? item.cant ?? 0);
      const identifiers = [
        item.product_id,
        item.productId,
        item.product?.id,
        item.id,
        item.sku,
        item.code,
        item.codigo,
        item.publicSlug,
        item.public_slug,
        item.slug,
        item.mpn,
        item.part_number,
      ].map(normalizeValue).filter(Boolean);
      const uniqueIdentifiers = [...new Set(identifiers)];
      return {
        index,
        identifier: uniqueIdentifiers[0] || "",
        identifiers: uniqueIdentifiers,
        product_id: normalizeValue(item.product_id || item.productId || item.product?.id || item.id),
        sku: normalizeValue(item.sku),
        code: normalizeValue(item.code || item.codigo),
        title: normalizeValue(item.name || item.title || item.titulo || item.descripcion),
        qty: Number.isFinite(qty) ? Math.max(0, qty) : 0,
        raw: item,
      };
    })
    .filter((item) => item.qty > 0);
}

async function resolveProduct(identifier) {
  const target = normalizeValue(identifier);
  if (!target) {
    const error = new Error("PRODUCT_IDENTIFIER_REQUIRED");
    error.code = "PRODUCT_IDENTIFIER_REQUIRED";
    throw error;
  }
  const found = await productsSqliteRepo.getInventoryProductByIdentifier(target);
  if (!found?.product) {
    const error = new Error(`PRODUCT_NOT_FOUND:${target}`);
    error.code = "PRODUCT_NOT_FOUND";
    error.identifier = target;
    throw error;
  }
  return found;
}

async function resolveProductForItem(item = {}) {
  const identifiers = Array.isArray(item.identifiers) && item.identifiers.length
    ? item.identifiers
    : [item.identifier].filter(Boolean);
  const errors = [];
  for (const identifier of identifiers) {
    try {
      return await resolveProduct(identifier);
    } catch (error) {
      errors.push({
        identifier,
        code: error.code || "PRODUCT_RESOLVE_FAILED",
        message: error.message,
      });
    }
  }
  const err = new Error(`PRODUCT_NOT_FOUND:${identifiers.join("|") || item.identifier || ""}`);
  err.code = "PRODUCT_NOT_FOUND";
  err.identifier = identifiers[0] || item.identifier || "";
  err.errors = errors;
  throw err;
}

async function getStock(identifier) {
  const found = await resolveProduct(identifier);
  return {
    source: found.source || "sqlite",
    foundBy: found.foundBy || null,
    product: found.product,
    stock: Number(found.product.stock || 0),
  };
}

async function readMovements({ orderId = null } = {}) {
  let lines = [];
  try {
    const raw = await fsp.readFile(MOVEMENTS_PATH, "utf8");
    lines = raw.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
  const movements = [];
  for (const line of lines) {
    try {
      const movement = JSON.parse(line);
      if (orderId && normalizeValue(movement.orderId) !== normalizeValue(orderId)) continue;
      movements.push(movement);
    } catch {}
  }
  return movements;
}

async function recordMovement(movement) {
  await fsp.mkdir(require("path").dirname(MOVEMENTS_PATH), { recursive: true });
  await fsp.appendFile(MOVEMENTS_PATH, `${JSON.stringify(movement)}\n`, "utf8");
}

async function adjustStock(identifier, delta, reason = "manual", orderId = null) {
  const timestamp = new Date().toISOString();
  const result = await productsSqliteRepo.adjustStockForInventory(identifier, delta, {
    reason,
    orderId,
    timestamp,
  });
  const qty = Math.abs(Number(delta) || 0);
  const movement = {
    orderId: orderId || null,
    productId: result.productId || null,
    sku: result.sku || null,
    identifier: normalizeValue(identifier),
    qty,
    delta: result.delta,
    before: result.before,
    after: result.after,
    reason,
    source: result.source || "sqlite",
    foundBy: result.foundBy || null,
    timestamp,
  };
  await recordMovement(movement);
  return { ...result, movement };
}

async function resolveItemsOrThrow(items = []) {
  const resolved = [];
  const errors = [];
  for (const item of items) {
    try {
      const product = await resolveProductForItem(item);
      resolved.push({ item, product });
    } catch (error) {
      errors.push({
        item,
        code: error.code || "PRODUCT_RESOLVE_FAILED",
        message: error.message,
      });
    }
  }
  if (errors.length) {
    const err = new Error("ORDER_INVENTORY_PRODUCT_NOT_FOUND");
    err.code = "ORDER_INVENTORY_PRODUCT_NOT_FOUND";
    err.errors = errors;
    throw err;
  }
  return resolved;
}

async function markOrderApplied(orderId, value) {
  const ordersRepo = require("./ordersRepo");
  if (value) return ordersRepo.markInventoryApplied(orderId);
  return ordersRepo.clearInventoryApplied(orderId);
}

async function applyOrderInventory(order = {}) {
  const release = acquireLock();
  try {
    const orderId = getOrderId(order);
    if (!orderId) {
      const err = new Error("ORDER_ID_REQUIRED");
      err.code = "ORDER_ID_REQUIRED";
      throw err;
    }
    const latest = await findOrder(orderId) || order;
    if (latest.inventoryApplied === true || latest.inventory_applied === true) {
      return { applied: false, alreadyApplied: true, orderId, source: "sqlite", movements: [] };
    }
    const items = normalizeOrderItems(latest);
    if (!items.length) {
      const err = new Error("ORDER_WITHOUT_ITEMS");
      err.code = "ORDER_WITHOUT_ITEMS";
      throw err;
    }
    const resolvedItems = await resolveItemsOrThrow(items);
    const movements = [];
    for (const { item, product } of resolvedItems) {
      const adjusted = await adjustStock(product.product.id || item.identifier, -item.qty, "order-approved", orderId);
      movements.push(adjusted.movement);
    }
    await markOrderApplied(orderId, true);
    return { applied: true, alreadyApplied: false, orderId, source: "sqlite", movements };
  } finally {
    release();
  }
}

async function revertOrderInventory(order = {}) {
  const release = acquireLock();
  try {
    const orderId = getOrderId(order);
    if (!orderId) {
      const err = new Error("ORDER_ID_REQUIRED");
      err.code = "ORDER_ID_REQUIRED";
      throw err;
    }
    const latest = await findOrder(orderId) || order;
    if (latest.inventoryApplied !== true && latest.inventory_applied !== true) {
      return { reverted: false, alreadyReverted: true, orderId, source: "sqlite", movements: [] };
    }
    const items = normalizeOrderItems(latest);
    if (!items.length) {
      const err = new Error("ORDER_WITHOUT_ITEMS");
      err.code = "ORDER_WITHOUT_ITEMS";
      throw err;
    }
    const resolvedItems = await resolveItemsOrThrow(items);
    const movements = [];
    for (const { item, product } of resolvedItems) {
      const adjusted = await adjustStock(product.product.id || item.identifier, item.qty, "order-revert", orderId);
      movements.push(adjusted.movement);
    }
    await markOrderApplied(orderId, false);
    return { reverted: true, alreadyReverted: false, orderId, source: "sqlite", movements };
  } finally {
    release();
  }
}

async function debugOrderInventory(orderIdentifier) {
  const order = await findOrder(orderIdentifier);
  const errors = [];
  const orderId = order ? getOrderId(order) : normalizeValue(orderIdentifier);
  if (!order) {
    errors.push({ code: "ORDER_NOT_FOUND", message: `Order not found: ${orderIdentifier}` });
  }
  const items = order ? normalizeOrderItems(order) : [];
  const products = [];
  for (const item of items) {
    try {
      const product = await resolveProductForItem(item);
      const resolved = {
        source: product.source || "sqlite",
        foundBy: product.foundBy || null,
        product: product.product,
        stock: Number(product.product.stock || 0),
      };
      products.push({
        item,
        found: true,
        foundBy: resolved.foundBy,
        source: resolved.source,
        product: {
          id: resolved.product.id,
          sku: resolved.product.sku,
          code: resolved.product.code,
          title: resolved.product.name || resolved.product.title,
          publicSlug: resolved.product.publicSlug || resolved.product.public_slug,
        },
        stock: resolved.stock,
      });
    } catch (error) {
      const entry = { item, found: false, code: error.code || "PRODUCT_RESOLVE_FAILED", message: error.message };
      products.push(entry);
      errors.push(entry);
    }
  }
  const movements = await readMovements({ orderId });
  const paymentStatusCode = mapPaymentStatusCode(order?.payment_status_code || order?.payment_status || order?.estado_pago || order?.status);
  return {
    orderId,
    paymentStatus: order?.payment_status || order?.estado_pago || null,
    paymentStatusCode: order ? paymentStatusCode : null,
    inventory_applied: Boolean(order?.inventory_applied || order?.inventoryApplied),
    inventoryApplied: Boolean(order?.inventory_applied || order?.inventoryApplied),
    items,
    products,
    movements,
    source: "sqlite",
    errors,
  };
}

module.exports = {
  resolveProduct,
  getStock,
  adjustStock,
  applyOrderInventory,
  revertOrderInventory,
  normalizeOrderItems,
  readMovements,
  debugOrderInventory,
};
