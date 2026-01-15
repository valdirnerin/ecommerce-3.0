function safeParseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch (err) {
      return {};
    }
  }
  return {};
}

export function resolveSku(item = {}) {
  const meta = safeParseMetadata(item.metadata);
  const candidates = [
    item.sku,
    item.mpn,
    meta.sku,
    meta.mpn,
    item.id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function getMetaContents(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const id = resolveSku(item);
      const quantity = Number(item.quantity ?? item.qty ?? item.cantidad ?? 1);
      if (!id) return null;
      return {
        id,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      };
    })
    .filter(Boolean);
}

export function getContentIds(items = []) {
  return getMetaContents(items).map((item) => item.id);
}

export function trackMetaEvent(name, params = {}, options = {}) {
  if (typeof window === "undefined") return false;
  if (typeof window.fbq !== "function") return false;
  try {
    window.fbq("track", name, params, options);
    return true;
  } catch (err) {
    console.warn("meta-pixel", err);
    return false;
  }
}

export function buildValueFromItems(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((total, item) => {
    const price = Number(
      item.price ??
        item.price_minorista ??
        item.precio ??
        item.unit_price ??
        0,
    );
    const quantity = Number(item.quantity ?? item.qty ?? item.cantidad ?? 1);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return total;
    return total + price * quantity;
  }, 0);
}

export function shouldSendEventOnce(key) {
  if (typeof window === "undefined" || !key) return true;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch (err) {
    return true;
  }
}
