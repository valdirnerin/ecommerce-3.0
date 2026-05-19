const DAY_MS = 24 * 60 * 60 * 1000;
const ARG_FEED_OFFSET = "-0300";
const ARG_SCHEMA_OFFSET = "-03:00";
const MAX_AVAILABILITY_DAYS = 365;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeAvailability(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["in_stock", "instock", "available", "disponible"].includes(normalized)) return "in_stock";
  if (["preorder", "pre_order", "a_pedido", "pedido", "remote", "remoto"].includes(normalized)) return "preorder";
  if (["backorder", "back_order", "allow_backorder"].includes(normalized)) return "backorder";
  if (["out_of_stock", "outofstock", "sin_stock", "agotado"].includes(normalized)) return "out_of_stock";
  return "";
}

function getUtcDateOnly(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUtc(date, days) {
  return new Date(getUtcDateOnly(date).getTime() + Math.max(0, Number(days) || 0) * DAY_MS);
}

function parseAvailabilityDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return date;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return getUtcDateOnly(parsed);
}

function clampAvailabilityDate(date, now = new Date()) {
  const today = getUtcDateOnly(now);
  const min = addDaysUtc(today, 1);
  const max = addDaysUtc(today, MAX_AVAILABILITY_DAYS);
  if (!date || Number.isNaN(date.getTime()) || date <= today) return min;
  if (date > max) return max;
  return getUtcDateOnly(date);
}

function resolveAvailabilityDate(product = {}, leadDays = 30, now = new Date()) {
  const explicit = [
    product.availability_date,
    product.availabilityDate,
    product.preorder_date,
    product.preorderDate,
    product.available_at,
    product.availableAt,
  ].map(parseAvailabilityDate).find(Boolean);
  if (explicit) return clampAvailabilityDate(explicit, now);
  return clampAvailabilityDate(addDaysUtc(now, leadDays || 30), now);
}

function dateParts(date) {
  const d = getUtcDateOnly(date);
  return {
    y: String(d.getUTCFullYear()).padStart(4, "0"),
    m: String(d.getUTCMonth() + 1).padStart(2, "0"),
    d: String(d.getUTCDate()).padStart(2, "0"),
  };
}

function formatMerchantAvailabilityDate(value) {
  const parsed = value instanceof Date ? value : parseAvailabilityDate(value);
  if (!parsed) return "";
  const p = dateParts(parsed);
  return `${p.y}-${p.m}-${p.d}T00:00${ARG_FEED_OFFSET}`;
}

function formatSchemaAvailabilityStarts(value) {
  const parsed = value instanceof Date ? value : parseAvailabilityDate(value);
  if (!parsed) return "";
  const p = dateParts(parsed);
  return `${p.y}-${p.m}-${p.d}T00:00:00${ARG_SCHEMA_OFFSET}`;
}

function formatDisplayAvailabilityDate(value) {
  const parsed = value instanceof Date ? value : parseAvailabilityDate(value);
  if (!parsed) return "";
  const p = dateParts(parsed);
  return `${p.d}/${p.m}/${p.y}`;
}

function getPublicPriceValue(product = {}) {
  const value = [
    product.precio_final,
    product.price_minorista,
    product.precio_minorista,
    product.price,
    product.price_mayorista,
    product.precio_mayorista,
  ].find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0);
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function resolveProductAvailability(product = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const stockLocal = toFiniteNumber(product.stock ?? product.available_stock ?? product.inventory ?? product.stock_total, 0);
  const hasLocalStock = stockLocal > 0;
  const textSignals = [product.name, product.title, product.description, product.category, product.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const explicitAvailability = normalizeAvailability(product.availability || product.disponibilidad || product.estado_stock);
  const explicitMode = String(product.stock_mode || product.fulfillment_mode || product.stockMode || product.fulfillmentMode || "").trim().toLowerCase();
  const remoteStock = toFiniteNumber(product.remote_stock ?? product.stock_remote ?? product.available_remote, 0);
  const minLead = toFiniteNumber(product.remote_lead_min_days || product.remote_lead_days || product.lead_min_days, 0);
  const maxLead = toFiniteNumber(product.remote_lead_max_days || product.remote_lead_days || product.lead_max_days, 0);
  const hasRemoteSignal = /stock remoto|a pedido|bajo pedido|encargo|preorder|backorder/.test(textSignals);
  const forcedRemote = ["preorder", "backorder"].includes(explicitAvailability);
  const isRemote = forcedRemote || explicitMode === "remote" || explicitMode === "remoto" || remoteStock > 0 || minLead > 0 || maxLead > 0 || hasRemoteSignal;
  const priceValue = getPublicPriceValue(product);
  const hasRemoteStock = isRemote && (remoteStock > 0 || minLead > 0 || maxLead > 0 || hasRemoteSignal || forcedRemote || priceValue > 0);

  if (hasLocalStock && !forcedRemote) return {
    stockLocal, hasLocalStock, isRemote, hasRemoteStock, isSellable: true,
    availabilityLabel: "En stock", visibleAvailabilityText: "En stock",
    availabilityBadge: "in_stock", merchantAvailability: "in_stock", feedAvailability: "in_stock",
    deliveryLabel: "Entrega rapida", checkoutAllowed: true,
    seoAvailability: "https://schema.org/InStock", schemaAvailability: "https://schema.org/InStock",
    availabilityDate: "", availabilityDateFeed: "", availabilityStarts: "", availabilityDateDisplay: "",
    leadMinDays: minLead, leadMaxDays: maxLead,
  };

  if (hasRemoteStock || (priceValue > 0 && explicitAvailability !== "out_of_stock")) {
    const leadStart = minLead > 0 ? minLead : 20;
    const leadEnd = maxLead > 0 ? maxLead : Math.max(leadStart, 30);
    const availabilityDate = resolveAvailabilityDate(product, leadEnd, now);
    const availabilityDateDisplay = formatDisplayAvailabilityDate(availabilityDate);
    const merchantAvailability = explicitAvailability === "backorder" ? "backorder" : "preorder";
    return {
      stockLocal, hasLocalStock: false, isRemote: true, hasRemoteStock: true, isSellable: true,
      availabilityLabel: "Disponible a pedido",
      visibleAvailabilityText: `Producto a pedido. Fecha estimada de disponibilidad: ${availabilityDateDisplay}`,
      availabilityBadge: "remote_available", merchantAvailability, feedAvailability: merchantAvailability,
      deliveryLabel: `Disponible para envio estimado: ${availabilityDateDisplay}`,
      checkoutAllowed: true, seoAvailability: "https://schema.org/PreOrder", schemaAvailability: "https://schema.org/PreOrder",
      availabilityDate, availabilityDateFeed: formatMerchantAvailabilityDate(availabilityDate),
      availabilityStarts: formatSchemaAvailabilityStarts(availabilityDate), availabilityDateDisplay,
      leadMinDays: leadStart, leadMaxDays: leadEnd,
    };
  }

  return {
    stockLocal, hasLocalStock: false, isRemote: false, hasRemoteStock: false, isSellable: false,
    availabilityLabel: "Sin stock", visibleAvailabilityText: "Sin stock",
    availabilityBadge: "out_of_stock", merchantAvailability: "out_of_stock", feedAvailability: "out_of_stock",
    deliveryLabel: "Consulta disponibilidad", checkoutAllowed: false,
    seoAvailability: "https://schema.org/OutOfStock", schemaAvailability: "https://schema.org/OutOfStock",
    availabilityDate: "", availabilityDateFeed: "", availabilityStarts: "", availabilityDateDisplay: "",
    leadMinDays: 0, leadMaxDays: 0,
  };
}
