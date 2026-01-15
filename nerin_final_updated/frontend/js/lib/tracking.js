import { getTrackingSessionId, trackEvent } from "../tracker.js";
import {
  buildValueFromItems,
  getMetaContents,
  resolveSku,
  shouldSendEventOnce,
  trackMetaEvent,
} from "../meta-pixel.js";

const DEFAULT_CURRENCY = "ARS";

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function resolveCurrency(value) {
  const currency = normalizeText(value);
  return currency ? currency.toUpperCase() : DEFAULT_CURRENCY;
}

function buildEventId(prefix) {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildTrackingItem(item, overrides = {}) {
  const sku = normalizeText(overrides.sku || resolveSku(item));
  if (!sku) return null;
  const quantity = Number(overrides.quantity ?? item.quantity ?? item.qty ?? item.cantidad ?? 1);
  const price = Number(
    overrides.price ??
      item.price ??
      item.price_minorista ??
      item.price_mayorista ??
      item.precio ??
      item.unit_price ??
      0,
  );
  return {
    sku,
    name: normalizeText(overrides.name || item.name || item.title || item.titulo),
    category: normalizeText(overrides.category || item.category || item.categoria),
    price: Number.isFinite(price) ? price : 0,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    currency: resolveCurrency(overrides.currency || item.currency || item.currency_id),
  };
}

function buildGtagItems(items) {
  return items.map((item) => ({
    item_id: item.sku,
    item_name: item.name || undefined,
    item_category: item.category || undefined,
    price: Number.isFinite(item.price) ? item.price : undefined,
    quantity: Number.isFinite(item.quantity) ? item.quantity : undefined,
  }));
}

function fireGtagEvent(name, payload) {
  if (typeof window === "undefined") return false;
  if (typeof window.gtag !== "function") return false;
  try {
    window.gtag("event", name, payload);
    return true;
  } catch (err) {
    console.warn("tracking:gtag", err);
    return false;
  }
}

export function trackViewItem({ sku, name, price, currency, category } = {}) {
  const normalizedSku = normalizeText(sku);
  if (!normalizedSku) return;
  const item = buildTrackingItem(
    { sku: normalizedSku, name, price, currency, category },
    { sku: normalizedSku, name, price, currency, category, quantity: 1 },
  );
  if (!item) return;
  const eventId = buildEventId("view_item");
  trackEvent("view_item", {
    eventId,
    sku: item.sku,
    name: item.name,
    price: item.price,
    currency: item.currency,
    category: item.category,
    items: [item],
  });
  const viewKey = `nerin:track:view:${item.sku}`;
  if (shouldSendEventOnce(viewKey)) {
    trackMetaEvent("ViewContent", {
      content_type: "product",
      content_ids: [item.sku],
      value: Number.isFinite(item.price) ? item.price : 0,
      currency: item.currency,
    });
    fireGtagEvent("view_item", {
      currency: item.currency,
      value: Number.isFinite(item.price) ? item.price : 0,
      items: buildGtagItems([item]),
    });
  }
}

export function trackAddToCart({ sku, name, price, currency, quantity, category } = {}) {
  const normalizedSku = normalizeText(sku);
  if (!normalizedSku) return;
  const item = buildTrackingItem(
    { sku: normalizedSku, name, price, currency, quantity, category },
    { sku: normalizedSku, name, price, currency, quantity, category },
  );
  if (!item) return;
  const eventId = buildEventId("add_to_cart");
  trackEvent("add_to_cart", {
    eventId,
    sku: item.sku,
    name: item.name,
    price: item.price,
    currency: item.currency,
    quantity: item.quantity,
    items: [item],
  });
  const value = Number.isFinite(item.price) ? item.price * item.quantity : 0;
  trackMetaEvent("AddToCart", {
    content_type: "product",
    content_ids: [item.sku],
    contents: [{ id: item.sku, quantity: item.quantity }],
    value,
    currency: item.currency,
  });
  fireGtagEvent("add_to_cart", {
    currency: item.currency,
    value,
    items: buildGtagItems([item]),
  });
}

export function trackBeginCheckout({ items = [], total, currency } = {}) {
  const normalizedItems = items
    .map((item) => buildTrackingItem(item))
    .filter(Boolean);
  if (!normalizedItems.length) return;
  const eventId = buildEventId("begin_checkout");
  const fallbackTotal = buildValueFromItems(normalizedItems);
  const checkoutTotal = Number.isFinite(Number(total)) ? Number(total) : fallbackTotal;
  const resolvedCurrency =
    resolveCurrency(currency) || normalizedItems[0]?.currency || DEFAULT_CURRENCY;
  const sessionKey = getTrackingSessionId() || "anon";
  const key = `nerin:track:checkout:${sessionKey}`;
  if (shouldSendEventOnce(key)) {
    trackEvent("begin_checkout", {
      eventId,
      items: normalizedItems,
      total: checkoutTotal,
      currency: resolvedCurrency,
    });
    const contents = getMetaContents(normalizedItems);
    trackMetaEvent("InitiateCheckout", {
      contents,
      content_ids: contents.map((entry) => entry.id),
      value: checkoutTotal,
      currency: resolvedCurrency,
    });
    fireGtagEvent("begin_checkout", {
      currency: resolvedCurrency,
      value: checkoutTotal,
      items: buildGtagItems(normalizedItems),
    });
  }
}

export function trackPurchase({ orderId, items = [], total, currency } = {}) {
  const normalizedItems = items
    .map((item) => buildTrackingItem(item))
    .filter(Boolean);
  if (!normalizedItems.length) return;
  const resolvedCurrency =
    resolveCurrency(currency) || normalizedItems[0]?.currency || DEFAULT_CURRENCY;
  const fallbackTotal = buildValueFromItems(normalizedItems);
  const purchaseTotal = Number.isFinite(Number(total)) ? Number(total) : fallbackTotal;
  const eventId = normalizeText(orderId) || buildEventId("purchase");
  const dedupeKey = `nerin:track:purchase:${eventId}`;
  if (!shouldSendEventOnce(dedupeKey)) return;
  trackEvent("purchase", {
    eventId,
    orderId: eventId,
    items: normalizedItems,
    total: purchaseTotal,
    currency: resolvedCurrency,
  });
  trackMetaEvent(
    "Purchase",
    {
      contents: getMetaContents(normalizedItems),
      value: purchaseTotal,
      currency: resolvedCurrency,
    },
    { eventID: eventId },
  );
  fireGtagEvent("purchase", {
    currency: resolvedCurrency,
    value: purchaseTotal,
    transaction_id: eventId,
    items: buildGtagItems(normalizedItems),
  });
}
