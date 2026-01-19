const META_PIXEL_STATE_KEY = "__NERIN_META_PIXEL_STATE__";

function getPixelState() {
  if (typeof window === "undefined") return null;
  if (!window[META_PIXEL_STATE_KEY]) {
    window[META_PIXEL_STATE_KEY] = {
      fired: new Set(),
    };
  }
  return window[META_PIXEL_STATE_KEY];
}

function buildKey(eventName, keyHint) {
  return keyHint ? `${eventName}:${keyHint}` : eventName;
}

export function trackPixel(eventName, payload = {}) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") {
    return false;
  }
  window.fbq("track", eventName, payload);
  return true;
}

export function trackPixelOnce(eventName, payload = {}, keyHint = "") {
  const state = getPixelState();
  if (!state || typeof window.fbq !== "function") return false;
  const key = buildKey(eventName, keyHint);
  if (state.fired.has(key)) return false;
  state.fired.add(key);
  window.fbq("track", eventName, payload);
  return true;
}

export function normalizeContentId(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function buildPixelContents(items = []) {
  const contents = [];
  let value = 0;
  items.forEach((item) => {
    const id = normalizeContentId(item?.sku || item?.product_id || item?.productId || item?.id);
    if (!id) return;
    const quantity = Number(item?.quantity || 1);
    const price = Number(item?.unit_price ?? item?.price ?? 0);
    contents.push({ id, quantity });
    value += price * quantity;
  });
  return { contents, value };
}
