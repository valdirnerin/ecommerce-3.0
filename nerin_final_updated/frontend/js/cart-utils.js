const CART_KEY = "nerinCart";

export function getProductIdentifier(product = {}) {
  const candidates = [
    product?.id,
    product?.productId,
    product?.product_id,
    product?.identifier,
    product?.sku,
    product?.code,
    product?.publicSlug,
    product?.public_slug,
    product?.slug,
    product?.partNumber,
    product?.part_number,
    product?.mpn,
    product?.ean,
    product?.gtin,
    product?.supplierCode,
    product?.supplier_code,
  ];
  for (const value of candidates) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function normalizeCartItem(product = {}, quantity = 1) {
  const identifier = getProductIdentifier(product);
  if (!identifier) {
    console.error("[add-to-cart:blocked-invalid-product]", product);
    throw new Error("No se puede agregar al carrito un producto sin identificador");
  }
  return {
    ...product,
    id: product?.id ?? product?.productId ?? product?.product_id ?? null,
    identifier: identifier || null,
    sku: product?.sku ?? null,
    code: product?.code ?? null,
    publicSlug: product?.publicSlug ?? product?.public_slug ?? null,
    slug: product?.slug ?? null,
    partNumber: product?.partNumber ?? product?.part_number ?? null,
    mpn: product?.mpn ?? null,
    ean: product?.ean ?? null,
    gtin: product?.gtin ?? null,
    supplierCode: product?.supplierCode ?? product?.supplier_code ?? null,
    productId: product?.productId ?? product?.product_id ?? product?.id ?? null,
    product_id: product?.product_id ?? product?.productId ?? product?.id ?? null,
    quantity: Number(quantity || product?.quantity || product?.qty || 1),
  };
}

export function isValidCartItem(item = {}) {
  const normalized = normalizeCartItem(item);
  return Boolean(normalized.identifier && Number.isFinite(normalized.quantity) && normalized.quantity > 0);
}

export function sanitizeCart(items = []) {
  const src = Array.isArray(items) ? items : [];
  return src
    .map((item) => {
      try {
        return normalizeCartItem(item);
      } catch (_err) {
        return null;
      }
    })
    .filter((item) => item && isValidCartItem(item));
}

export function readCart({ migrate = true, onInvalidItems = null } = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    const items = Array.isArray(parsed) ? parsed : [];
    const valid = sanitizeCart(items);
    if (migrate && valid.length !== items.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(valid));
      console.warn("[cart:removed-invalid-items]", {
        before: items,
        after: valid,
      });
      if (typeof onInvalidItems === "function") onInvalidItems(items.length - valid.length);
    }
    return valid;
  } catch (_err) {
    localStorage.removeItem(CART_KEY);
    return [];
  }
}

export function writeCart(items = []) {
  const nextCart = Array.isArray(items) ? items : [];
  console.log("[cart:before-save]", nextCart);
  const validCart = nextCart.filter((item) => Boolean(getProductIdentifier(item)));
  if (validCart.length !== nextCart.length) {
    console.error("[cart:blocked-invalid-items]", { before: nextCart, after: validCart });
  }
  const valid = sanitizeCart(validCart);
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
