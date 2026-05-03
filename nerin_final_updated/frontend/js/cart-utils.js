const CART_KEY = "nerinCart";

export function getProductIdentifier(product = {}) {
  const candidates = [
    product?.id,
    product?.productId,
    product?.product_id,
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

export function normalizeCartItem(item = {}) {
  const identifier = getProductIdentifier(item);
  if (!identifier) {
    console.error("[add-to-cart:invalid-product]", item);
    throw new Error("No se puede agregar al carrito un producto sin identificador");
  }
  return {
    ...item,
    id: item?.id ?? item?.productId ?? item?.product_id ?? null,
    sku: item?.sku ?? null,
    code: item?.code ?? null,
    publicSlug: item?.publicSlug ?? item?.public_slug ?? null,
    slug: item?.slug ?? null,
    partNumber: item?.partNumber ?? item?.part_number ?? null,
    mpn: item?.mpn ?? null,
    ean: item?.ean ?? null,
    gtin: item?.gtin ?? null,
    supplierCode: item?.supplierCode ?? item?.supplier_code ?? null,
    productId: item?.productId ?? item?.product_id ?? item?.id ?? null,
    product_id: item?.product_id ?? item?.productId ?? item?.id ?? null,
    quantity: Number(item?.quantity ?? item?.qty ?? 1),
    identifier,
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
  const valid = sanitizeCart(
    (Array.isArray(items) ? items : []).filter((item) => {
      const identifier = getProductIdentifier(item);
      if (!identifier) {
        console.error("[cart:blocked-invalid-item]", item);
        return false;
      }
      return true;
    }),
  );
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
