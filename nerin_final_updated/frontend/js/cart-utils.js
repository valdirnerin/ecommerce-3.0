const CART_KEY = "nerinCart";

const IDENTIFIER_FIELDS = [
  "id",
  "productId",
  "product_id",
  "sku",
  "code",
  "slug",
  "publicSlug",
  "public_slug",
  "partNumber",
  "mpn",
  "ean",
  "gtin",
  "supplierCode",
];

function pickIdentifier(item = {}) {
  for (const key of IDENTIFIER_FIELDS) {
    const value = String(item?.[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function normalizeCartItem(item = {}) {
  const normalized = {
    ...item,
    id: String(item?.id ?? item?.productId ?? item?.product_id ?? "").trim(),
    productId: String(item?.productId ?? item?.product_id ?? item?.id ?? "").trim(),
    product_id: String(item?.product_id ?? item?.productId ?? item?.id ?? "").trim(),
    publicSlug: String(item?.publicSlug ?? item?.public_slug ?? "").trim(),
    public_slug: String(item?.public_slug ?? item?.publicSlug ?? "").trim(),
    quantity: Number(item?.quantity ?? item?.qty ?? 1),
  };
  const identifier = pickIdentifier(normalized);
  normalized.identifier = identifier;
  return normalized;
}

export function isValidCartItem(item = {}) {
  const normalized = normalizeCartItem(item);
  return Boolean(normalized.identifier && Number.isFinite(normalized.quantity) && normalized.quantity > 0);
}

export function sanitizeCart(items = []) {
  const src = Array.isArray(items) ? items : [];
  return src
    .map((item) => normalizeCartItem(item))
    .filter((item) => isValidCartItem(item));
}

export function readCart({ migrate = true, onInvalidItems = null } = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    const items = Array.isArray(parsed) ? parsed : [];
    const valid = sanitizeCart(items);
    if (migrate && valid.length !== items.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(valid));
      if (typeof onInvalidItems === "function") onInvalidItems(items.length - valid.length);
    }
    return valid;
  } catch (_err) {
    localStorage.removeItem(CART_KEY);
    return [];
  }
}

export function writeCart(items = []) {
  const valid = sanitizeCart(items);
  localStorage.setItem(CART_KEY, JSON.stringify(valid));
  return valid;
}

export function buildCartItemFromProduct(product = {}, extras = {}) {
  const base = normalizeCartItem({
    id: product?.id,
    productId: product?.productId,
    product_id: product?.product_id,
    sku: product?.sku,
    code: product?.code,
    slug: product?.slug,
    publicSlug: product?.publicSlug,
    public_slug: product?.public_slug,
    partNumber: product?.partNumber,
    mpn: product?.mpn,
    ean: product?.ean,
    gtin: product?.gtin,
    supplierCode: product?.supplierCode,
    ...extras,
  });
  return base;
}
