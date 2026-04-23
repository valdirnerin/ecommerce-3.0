const Decimal = require("decimal.js");

const PRICING_OUTPUT_COLUMNS = [
  "costo_proveedor_original",
  "moneda_origen",
  "costo_proveedor_usd",
  "costo_proveedor_ars",
  "envio_internacional_prorrateado_usd",
  "envio_internacional_prorrateado_ars",
  "base_importacion_ars",
  "die_ars",
  "tasa_estadistica_ars",
  "iva_importacion_ars",
  "percepcion_iva_ars",
  "percepcion_ganancias_ars",
  "costo_caja_ars",
  "envio_ml_unitario_ars",
  "empaque_ars",
  "publicidad_ars",
  "costo_total_completo_ars",
  "precio_teorico_ars",
  "precio_final_ars",
  "comision_ml_ars",
  "iibb_ars",
  "ganancia_estimada_ars",
  "margen_sobre_costo_caja",
  "margen_neto_sobre_venta",
  "estado_calculo",
];

const DEFAULT_PRICING_CONFIG = {
  defaultSupplierCurrency: "EUR",
  USD_ARS: 1500,
  EUR_USD: 1.1489,
  envio_internacional_total_eur: 106.75,
  pedido_base_usd: 1000,
  die: 0,
  tasa_estadistica: 0.03,
  iva_importacion: 0.21,
  percepcion_iva: 0.2,
  percepcion_ganancias: 0.06,
  comision_ml: 0.16,
  iibb: 0.03,
  margen_neto_objetivo: 0.15,
  envio_ml_unitario_ars: 7720,
  empaque_ars: 0,
  publicidad_ars: 0,
  precio_minimo_ars: 1000,
  redondeo_ars: 100,
};

const COST_COLUMN_CANDIDATES = [
  "unitprice",
  "unit_price",
  "unit cost",
  "unitcost",
  "supplier_price",
  "supplierprice",
  "costo proveedor",
  "costoproveedor",
  "precio proveedor",
  "precioproveedor",
  "costo",
  "cost",
  "price",
  "precio",
];

const CURRENCY_COLUMN_CANDIDATES = [
  "currency",
  "moneda",
  "currency_code",
  "currencycode",
  "supplier_currency",
  "suppliercurrency",
  "moneda_origen",
];

const SKU_CANDIDATES = ["PartNumber", "SKU", "sku", "id", "PartId"];
const TITLE_CANDIDATES = ["Description", "Title", "name", "product_name"];

function toDecimal(value) {
  return new Decimal(value);
}

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildColumnLookup(row = {}) {
  const lookup = new Map();
  for (const key of Object.keys(row)) {
    lookup.set(normalizeKey(key), key);
  }
  return lookup;
}

function findColumnByCandidates(lookup, candidates = []) {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKey(candidate);
    if (lookup.has(normalizedCandidate)) {
      return lookup.get(normalizedCandidate);
    }
  }
  return null;
}

function parseMoneyLike(value) {
  const text = normalizeText(value);
  if (!text) return null;
  let sanitized = text.replace(/\s+/g, "");
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(sanitized)) {
    sanitized = sanitized.replace(/\./g, "");
  }
  if (sanitized.includes(",")) {
    sanitized = sanitized.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(sanitized)) return null;
  return Number(new Decimal(sanitized).toString());
}

function resolveCurrency(rawValue, heuristics = {}) {
  const value = normalizeText(rawValue);
  if (value) {
    const upper = value.toUpperCase();
    if (["EUR", "€"].includes(upper)) return { currency: "EUR", inferred: false };
    if (["USD", "US$", "$USD"].includes(upper)) return { currency: "USD", inferred: false };
    if (["ARS", "$", "$ARS"].includes(upper)) return { currency: "ARS", inferred: false };
    return { currency: null, inferred: false };
  }

  if (heuristics.assumeEuropeanSupplier === true) {
    return { currency: "EUR", inferred: true };
  }

  return { currency: null, inferred: false };
}

function roundUpToStep(value, step) {
  if (!Number.isFinite(value)) return null;
  const divider = new Decimal(step);
  return Number(new Decimal(value).div(divider).ceil().mul(divider).toString());
}

function nullPricingResult() {
  return PRICING_OUTPUT_COLUMNS.reduce((acc, key) => {
    acc[key] = key === "estado_calculo" ? "revisión" : null;
    return acc;
  }, {});
}

function pickFirstValue(row, keys = []) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

function selectCostColumn(row) {
  const lookup = buildColumnLookup(row);
  const found = findColumnByCandidates(lookup, COST_COLUMN_CANDIDATES);
  return found;
}

function selectCurrencyColumn(row) {
  const lookup = buildColumnLookup(row);
  return findColumnByCandidates(lookup, CURRENCY_COLUMN_CANDIDATES);
}

function computePricingForRow(row, config = DEFAULT_PRICING_CONFIG, options = {}) {
  const result = nullPricingResult();
  const warnings = [];
  const merged = { ...DEFAULT_PRICING_CONFIG, ...(config || {}) };

  const costColumn = options.costColumn || selectCostColumn(row);
  const currencyColumn = options.currencyColumn || selectCurrencyColumn(row);

  if (!costColumn) {
    warnings.push("No se encontró columna de costo proveedor");
    return { pricing: result, warnings, mapping: { costColumn: null, currencyColumn } };
  }

  const supplierCost = parseMoneyLike(row[costColumn]);
  if (!Number.isFinite(supplierCost) || supplierCost <= 0) {
    warnings.push(`Costo proveedor inválido en columna ${costColumn}`);
    return { pricing: result, warnings, mapping: { costColumn, currencyColumn } };
  }

  const currencyResolved = resolveCurrency(
    currencyColumn ? row[currencyColumn] : null,
    options.currencyHeuristics,
  );

  if (!currencyResolved.currency) {
    warnings.push("No se pudo deducir la moneda de origen con seguridad");
    return { pricing: result, warnings, mapping: { costColumn, currencyColumn } };
  }

  if (currencyResolved.inferred) {
    warnings.push(`Moneda inferida como ${currencyResolved.currency}`);
  }

  const usdArs = toDecimal(merged.USD_ARS);
  const eurUsd = toDecimal(merged.EUR_USD);

  let supplierUsd;
  if (currencyResolved.currency === "EUR") {
    supplierUsd = toDecimal(supplierCost).mul(eurUsd);
  } else if (currencyResolved.currency === "USD") {
    supplierUsd = toDecimal(supplierCost);
  } else {
    supplierUsd = toDecimal(supplierCost).div(usdArs);
  }

  const supplierArs = supplierUsd.mul(usdArs);
  const envioTotalUsd = toDecimal(merged.envio_internacional_total_eur).mul(eurUsd);
  const proporcion = supplierUsd.div(toDecimal(merged.pedido_base_usd));
  const envioProrrateadoUsd = envioTotalUsd.mul(proporcion);
  const envioProrrateadoArs = envioProrrateadoUsd.mul(usdArs);

  const baseImportacion = supplierArs.add(envioProrrateadoArs);
  const die = baseImportacion.mul(toDecimal(merged.die));
  const tasaEstadistica = baseImportacion.mul(toDecimal(merged.tasa_estadistica));
  const ivaImportacion = baseImportacion.mul(toDecimal(merged.iva_importacion));
  const percepcionIva = baseImportacion.mul(toDecimal(merged.percepcion_iva));
  const percepcionGanancias = baseImportacion.mul(toDecimal(merged.percepcion_ganancias));

  const costoCaja = supplierArs
    .add(envioProrrateadoArs)
    .add(die)
    .add(tasaEstadistica)
    .add(ivaImportacion)
    .add(percepcionIva)
    .add(percepcionGanancias);

  const costoTotalCompleto = costoCaja
    .add(toDecimal(merged.envio_ml_unitario_ars))
    .add(toDecimal(merged.empaque_ars))
    .add(toDecimal(merged.publicidad_ars));

  const divisor = toDecimal(1)
    .sub(toDecimal(merged.comision_ml))
    .sub(toDecimal(merged.iibb))
    .sub(toDecimal(merged.margen_neto_objetivo));

  if (divisor.lte(0)) {
    warnings.push("Configuración inválida: divisor <= 0");
    return { pricing: result, warnings, mapping: { costColumn, currencyColumn } };
  }

  const precioTeorico = costoTotalCompleto.div(divisor);
  const precioConMinimo = Decimal.max(precioTeorico, toDecimal(merged.precio_minimo_ars));
  const precioFinal = toDecimal(roundUpToStep(Number(precioConMinimo.toString()), merged.redondeo_ars));

  const comisionMl = precioFinal.mul(toDecimal(merged.comision_ml));
  const iibb = precioFinal.mul(toDecimal(merged.iibb));
  const gananciaEstimada = precioFinal.sub(comisionMl).sub(iibb).sub(costoTotalCompleto);

  const margenSobreCostoCaja = costoCaja.gt(0) ? gananciaEstimada.div(costoCaja) : null;
  const margenNetoSobreVenta = precioFinal.gt(0) ? gananciaEstimada.div(precioFinal) : null;

  const isInvalidCost = !costoTotalCompleto.gt(0);
  const underCost = precioFinal.lt(costoTotalCompleto);

  const estadoCalculo = isInvalidCost || underCost || !margenSobreCostoCaja ? "revisión" : "ok";

  result.costo_proveedor_original = supplierCost;
  result.moneda_origen = currencyResolved.currency;
  result.costo_proveedor_usd = Number(supplierUsd.toString());
  result.costo_proveedor_ars = Number(supplierArs.toString());
  result.envio_internacional_prorrateado_usd = Number(envioProrrateadoUsd.toString());
  result.envio_internacional_prorrateado_ars = Number(envioProrrateadoArs.toString());
  result.base_importacion_ars = Number(baseImportacion.toString());
  result.die_ars = Number(die.toString());
  result.tasa_estadistica_ars = Number(tasaEstadistica.toString());
  result.iva_importacion_ars = Number(ivaImportacion.toString());
  result.percepcion_iva_ars = Number(percepcionIva.toString());
  result.percepcion_ganancias_ars = Number(percepcionGanancias.toString());
  result.costo_caja_ars = Number(costoCaja.toString());
  result.envio_ml_unitario_ars = merged.envio_ml_unitario_ars;
  result.empaque_ars = merged.empaque_ars;
  result.publicidad_ars = merged.publicidad_ars;
  result.costo_total_completo_ars = Number(costoTotalCompleto.toString());
  result.precio_teorico_ars = Number(precioTeorico.toString());
  result.precio_final_ars = Number(precioFinal.toString());
  result.comision_ml_ars = Number(comisionMl.toString());
  result.iibb_ars = Number(iibb.toString());
  result.ganancia_estimada_ars = Number(gananciaEstimada.toString());
  result.margen_sobre_costo_caja = margenSobreCostoCaja
    ? Number(margenSobreCostoCaja.toString())
    : null;
  result.margen_neto_sobre_venta = margenNetoSobreVenta
    ? Number(margenNetoSobreVenta.toString())
    : null;
  result.estado_calculo = estadoCalculo;

  if (underCost) warnings.push("El precio final quedó por debajo del costo total completo");

  return {
    pricing: result,
    warnings,
    mapping: {
      costColumn,
      currencyColumn,
      inferredCurrency: currencyResolved.inferred,
    },
  };
}

function createPricingSummaryAccumulator() {
  const state = {
    processed: 0,
    ok: 0,
    revision: 0,
    marginValues: [],
    gainRows: [],
    lowMarginRows: [],
  };

  return {
    add(row, pricing) {
      state.processed += 1;
      if (pricing.estado_calculo === "ok") state.ok += 1;
      else state.revision += 1;

      if (typeof pricing.margen_neto_sobre_venta === "number") {
        state.marginValues.push(pricing.margen_neto_sobre_venta);
      }

      const sku = String(pickFirstValue(row, SKU_CANDIDATES) || "sin_sku");
      const title = String(pickFirstValue(row, TITLE_CANDIDATES) || sku);
      const gain = Number(pricing.ganancia_estimada_ars || 0);
      const margin =
        typeof pricing.margen_sobre_costo_caja === "number"
          ? pricing.margen_sobre_costo_caja
          : Number.POSITIVE_INFINITY;

      state.gainRows.push({ sku, title, ganancia_estimada_ars: gain, estado_calculo: pricing.estado_calculo });
      state.lowMarginRows.push({ sku, title, margen_sobre_costo_caja: margin, estado_calculo: pricing.estado_calculo });
    },
    finalize() {
      const avgMargin =
        state.marginValues.length > 0
          ? state.marginValues.reduce((acc, value) => acc + value, 0) / state.marginValues.length
          : null;

      const topGanancia = [...state.gainRows]
        .sort((a, b) => b.ganancia_estimada_ars - a.ganancia_estimada_ars)
        .slice(0, 10);

      const menoresMargenes = [...state.lowMarginRows]
        .filter((item) => Number.isFinite(item.margen_sobre_costo_caja))
        .sort((a, b) => a.margen_sobre_costo_caja - b.margen_sobre_costo_caja)
        .slice(0, 10);

      return {
        processedRows: state.processed,
        okRows: state.ok,
        revisionRows: state.revision,
        averageNetMargin: avgMargin,
        top10ByEstimatedProfit: topGanancia,
        bottom10ByMargin: menoresMargenes,
      };
    },
  };
}

module.exports = {
  PRICING_OUTPUT_COLUMNS,
  DEFAULT_PRICING_CONFIG,
  computePricingForRow,
  createPricingSummaryAccumulator,
  selectCostColumn,
  selectCurrencyColumn,
};
