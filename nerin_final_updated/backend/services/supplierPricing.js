const Decimal = require('decimal.js');
const { DEFAULT_SUPPLIER_PRICING_CONFIG } = require('../config/supplierPricingDefaults');

const PRICE_KEYS = ['unitprice', 'price', 'precio', 'supplierprice', 'unit_price', 'costo', 'cost'];
const TITLE_KEYS = ['name', 'nombre', 'title', 'titulo', 'description', 'descripcion', 'producto'];
const CATEGORY_KEYS = ['category', 'categoria', 'rubro', 'type'];
const BRAND_KEYS = ['brand', 'marca', 'compatibility', 'compatibilidad'];
const STOCK_KEYS = ['stock', 'quantity', 'qty', 'cantidad', 'available_quantity'];
const IMAGE_KEYS = ['image', 'image_url', 'imagen', 'images', 'picture', 'thumbnail', 'foto'];
const SKU_KEYS = ['sku', 'codigo', 'code', 'id', 'itemid'];
const EAN_KEYS = ['ean', 'gtin', 'barcode', 'upc'];

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/\s+/g, '').replace(/\$/g, '').replace(/,/g, '.');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function getFirstByKeys(row, keys) {
  if (!row || typeof row !== 'object') return undefined;
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    const normalized = normalizeHeader(key);
    if (keys.some((candidate) => normalized.includes(candidate))) {
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
  }
  return undefined;
}

function normalizeSupplierPricingConfig(overrides = {}) {
  return {
    ...DEFAULT_SUPPLIER_PRICING_CONFIG,
    ...(overrides || {}),
  };
}

function normalizeProductRow(row, config = {}) {
  const cfg = normalizeSupplierPricingConfig(config);
  const warnings = [];
  const supplierUnitPriceRaw = getFirstByKeys(row, PRICE_KEYS);
  const stockRaw = getFirstByKeys(row, STOCK_KEYS);
  const imageRaw = getFirstByKeys(row, IMAGE_KEYS);
  const image = Array.isArray(imageRaw) ? imageRaw[0] : imageRaw;
  const normalized = {
    title: getFirstByKeys(row, TITLE_KEYS) || 'Producto sin título',
    category: getFirstByKeys(row, CATEGORY_KEYS) || '',
    brand_or_compatibility: getFirstByKeys(row, BRAND_KEYS) || '',
    stock: toNumber(stockRaw),
    image_url: image ? String(image).trim() : '',
    supplier_currency: String(row?.supplier_currency || cfg.supplier_currency || 'EUR').toUpperCase(),
    supplier_unit_price_original: toNumber(supplierUnitPriceRaw),
    ean_gtin: getFirstByKeys(row, EAN_KEYS) || '',
    sku: getFirstByKeys(row, SKU_KEYS) || '',
    raw: row,
  };

  if (normalized.stock === null) warnings.push('stock_missing');
  if (!normalized.image_url) warnings.push('image_missing');
  if (normalized.supplier_unit_price_original === null) warnings.push('unit_price_missing');

  return {
    ...normalized,
    warnings,
  };
}

function roundFinalPrice(value, roundingMode) {
  const decimal = new Decimal(value);
  if (roundingMode === 'ceil_100') {
    return decimal.div(100).ceil().mul(100);
  }
  return decimal.ceil();
}

function isPublishable(product) {
  const stock = Number(product?.stock);
  const hasImage = Boolean(String(product?.image_url || '').trim());
  return Number.isFinite(stock) && stock > 0 && hasImage;
}

function calculateProductPricing(product, config = {}) {
  const cfg = normalizeSupplierPricingConfig(config);
  const errors = [];
  const warnings = [...(Array.isArray(product?.warnings) ? product.warnings : [])];
  const unitPrice = toNumber(product?.supplier_unit_price_original);

  if (unitPrice === null) errors.push('unit_price_missing');
  if (unitPrice !== null && unitPrice <= 0) errors.push('unit_price_non_positive');

  if (errors.length) {
    return {
      ok: false,
      errors,
      warnings,
      price_final_sugerido: null,
      breakdown: null,
      parameters_used: cfg,
      publishable: false,
    };
  }

  const currency = String(product?.supplier_currency || cfg.supplier_currency || 'EUR').toUpperCase();
  let supplierCostUsd;
  if (currency === 'EUR') {
    supplierCostUsd = new Decimal(unitPrice).mul(cfg.eur_usd);
  } else if (currency === 'USD') {
    supplierCostUsd = new Decimal(unitPrice);
  } else {
    return {
      ok: false,
      errors: ['unsupported_supplier_currency'],
      warnings,
      price_final_sugerido: null,
      breakdown: null,
      parameters_used: cfg,
      publishable: false,
    };
  }

  const supplierCostArs = supplierCostUsd.mul(cfg.usd_ars);
  const shippingTotalUsd = new Decimal(cfg.international_shipping_total_eur).mul(cfg.eur_usd);
  const shippingTotalArs = shippingTotalUsd.mul(cfg.usd_ars);
  const shareOfOrder = supplierCostUsd.div(cfg.minimum_order_usd);
  const internationalShippingAllocatedArs = shippingTotalArs.mul(shareOfOrder);

  const cifArs = supplierCostArs.add(internationalShippingAllocatedArs);
  const baseImportArs = cifArs.mul(new Decimal(1).add(cfg.die).add(cfg.tasa_estadistica));
  const ivaImportArs = baseImportArs.mul(cfg.iva_importacion);
  const percepcionIvaArs = baseImportArs.mul(cfg.percepcion_iva);
  const percepcionGananciasArs = baseImportArs.mul(cfg.percepcion_ganancias);

  const totalLandedCostArs = baseImportArs
    .add(ivaImportArs)
    .add(percepcionIvaArs)
    .add(percepcionGananciasArs)
    .add(cfg.ml_shipping_cost_ars)
    .add(cfg.packaging_cost_ars)
    .add(cfg.ads_cost_ars);

  const denominator = new Decimal(1).sub(cfg.ml_commission).sub(cfg.iibb).sub(cfg.net_margin);
  if (denominator.lte(0)) {
    return {
      ok: false,
      errors: ['invalid_commission_iibb_margin_denominator'],
      warnings,
      price_final_sugerido: null,
      breakdown: null,
      parameters_used: cfg,
      publishable: false,
    };
  }

  const finalPriceRaw = totalLandedCostArs.div(denominator);
  const withMinimum = Decimal.max(finalPriceRaw, new Decimal(cfg.minimum_final_price_ars));
  const finalPriceRounded = roundFinalPrice(withMinimum, cfg.rounding_mode);

  if (!Number.isFinite(Number(product?.stock)) || Number(product?.stock) <= 0) {
    warnings.push('not_publishable_stock');
  }
  if (!String(product?.image_url || '').trim()) {
    warnings.push('not_publishable_image');
  }

  const breakdown = {
    supplier_currency: currency,
    supplier_unit_price_original: unitPrice,
    supplier_cost_usd: Number(supplierCostUsd.toDecimalPlaces(6)),
    supplier_cost_ars: Number(supplierCostArs.toDecimalPlaces(2)),
    international_shipping_allocated_ars: Number(internationalShippingAllocatedArs.toDecimalPlaces(2)),
    cif_ars: Number(cifArs.toDecimalPlaces(2)),
    base_import_ars: Number(baseImportArs.toDecimalPlaces(2)),
    iva_import_ars: Number(ivaImportArs.toDecimalPlaces(2)),
    percepcion_iva_ars: Number(percepcionIvaArs.toDecimalPlaces(2)),
    percepcion_ganancias_ars: Number(percepcionGananciasArs.toDecimalPlaces(2)),
    ml_shipping_cost_ars: Number(new Decimal(cfg.ml_shipping_cost_ars).toDecimalPlaces(2)),
    packaging_cost_ars: Number(new Decimal(cfg.packaging_cost_ars).toDecimalPlaces(2)),
    ads_cost_ars: Number(new Decimal(cfg.ads_cost_ars).toDecimalPlaces(2)),
    total_landed_cost_ars: Number(totalLandedCostArs.toDecimalPlaces(2)),
    ml_commission: cfg.ml_commission,
    iibb: cfg.iibb,
    net_margin: cfg.net_margin,
    final_price_ars_raw: Number(finalPriceRaw.toDecimalPlaces(2)),
    final_price_ars_rounded: Number(finalPriceRounded.toDecimalPlaces(2)),
  };

  return {
    ok: true,
    errors: [],
    warnings: Array.from(new Set(warnings)),
    price_final_sugerido: breakdown.final_price_ars_rounded,
    breakdown,
    parameters_used: cfg,
    publishable: isPublishable(product),
  };
}

function buildPricingAudit(product, pricing, config = {}) {
  return {
    product: {
      title: product?.title || '',
      category: product?.category || '',
      sku: product?.sku || '',
      stock: product?.stock,
      image_url: product?.image_url || '',
    },
    pricing,
    parameters_used: normalizeSupplierPricingConfig(config),
    calculated_at: new Date().toISOString(),
  };
}

module.exports = {
  normalizeSupplierPricingConfig,
  normalizeProductRow,
  calculateProductPricing,
  isPublishable,
  buildPricingAudit,
};
