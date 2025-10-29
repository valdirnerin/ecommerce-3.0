const Decimal = require('decimal.js');

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

function normalizeDecimalInput(value) {
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Decimal(value);
  }
  if (typeof value === 'string') {
    let cleaned = value.trim();
    if (!cleaned) {
      throw new Error('Empty string cannot be converted to Decimal');
    }
    if (cleaned.includes('%')) {
      throw new Error('Percent values are not supported');
    }
    for (const symbol of ['$', 'USD', 'ARS']) {
      cleaned = cleaned.replace(new RegExp(symbol, 'gi'), '');
    }
    cleaned = cleaned.replace(/\s+/g, '');
    if (cleaned.includes(',') && cleaned.includes('.')) {
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        cleaned = cleaned.replace(/\./g, '');
        cleaned = cleaned.replace(/,/g, '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes(',')) {
      cleaned = cleaned.replace(/\./g, '');
      cleaned = cleaned.replace(/,/g, '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
    return new Decimal(cleaned);
  }
  if (value === null || value === undefined) {
    throw new Error('Decimal value is required');
  }
  try {
    return new Decimal(value);
  } catch (error) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
}

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'si', 'sí'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function quantize(value, digits = 2, roundingMode = Decimal.ROUND_HALF_UP) {
  return new Decimal(value).toDecimalPlaces(digits, roundingMode);
}

function quantizeArs(value) {
  return quantize(value, 2);
}

function quantizeUsd(value) {
  return quantize(value, 4);
}

function quantizeMargin(value) {
  return quantize(value, 4);
}

function ensureCurrency(value) {
  if (!value) {
    return 'USD';
  }
  const normalized = String(value).trim().toUpperCase();
  if (!['USD', 'ARS'].includes(normalized)) {
    throw new Error(`Unsupported currency ${value}`);
  }
  return normalized;
}

function ensureMoneyInput(raw, field) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${field} is required`);
  }
  return {
    amount: quantizeUsd(normalizeDecimalInput(raw.amount ?? raw.value ?? 0)),
    currency: ensureCurrency(raw.currency),
  };
}

function ensureAdditionalTax(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid additional tax payload');
  }
  const base = String(raw.base || '').trim();
  if (!['CIF', 'BaseIVA', 'ARS'].includes(base)) {
    throw new Error('Invalid additional tax base');
  }
  const normalized = { name: String(raw.name || 'Impuesto').trim() || 'Impuesto', base };
  if (base === 'ARS') {
    if (raw.amount_ars === undefined || raw.amount_ars === null) {
      throw new Error('amount_ars is required when base is ARS');
    }
    normalized.amount_ars = quantizeArs(normalizeDecimalInput(raw.amount_ars));
  } else {
    if (raw.rate === undefined || raw.rate === null) {
      throw new Error('rate is required when base is CIF or BaseIVA');
    }
    normalized.rate = quantizeMargin(normalizeDecimalInput(raw.rate));
  }
  return normalized;
}

function ensureRoundingRule(raw) {
  if (!raw) {
    return null;
  }
  if (typeof raw !== 'object') {
    throw new Error('Invalid rounding rule');
  }
  const step = quantizeArs(normalizeDecimalInput(raw.step ?? 0));
  const mode = (raw.mode || 'nearest').toString().toLowerCase();
  if (!['nearest', 'up', 'down'].includes(mode)) {
    throw new Error('Invalid rounding mode');
  }
  const psychological_endings = Array.isArray(raw.psychological_endings)
    ? raw.psychological_endings
        .map((ending) => {
          try {
            return normalizeDecimalInput(ending).toString();
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : null;
  return {
    step,
    mode,
    psychological_endings,
  };
}

function ensureQuantity(value) {
  if (value === undefined || value === null || value === '') {
    return 1;
  }
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error('quantity must be greater or equal to 1');
  }
  return quantity;
}

function normalizeParameters(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parameters payload is required');
  }
  const costsRaw = raw.costs || {};
  const costs = {
    fob: ensureMoneyInput(costsRaw.fob, 'costs.fob'),
    freight: ensureMoneyInput(costsRaw.freight, 'costs.freight'),
    insurance: ensureMoneyInput(costsRaw.insurance, 'costs.insurance'),
  };

  const tc_aduana = quantizeUsd(normalizeDecimalInput(raw.tc_aduana ?? 0));
  const di_rate = quantizeMargin(normalizeDecimalInput(raw.di_rate ?? 0));
  if (di_rate.lt(0) || di_rate.gt(1)) {
    throw new Error('di_rate must be between 0 and 1');
  }
  const apply_tasa_estadistica = toBoolean(raw.apply_tasa_estadistica, true);
  const iva_rate = quantizeMargin(normalizeDecimalInput(raw.iva_rate ?? 0));
  const perc_iva_rate = quantizeMargin(normalizeDecimalInput(raw.perc_iva_rate ?? 0));
  const perc_ganancias_rate = quantizeMargin(normalizeDecimalInput(raw.perc_ganancias_rate ?? 0));
  const gastos_locales_ars = quantizeArs(normalizeDecimalInput(raw.gastos_locales_ars ?? 0));
  const costos_salida_ars = quantizeArs(normalizeDecimalInput(raw.costos_salida_ars ?? 0));
  const mp_rate = quantizeMargin(normalizeDecimalInput(raw.mp_rate ?? 0));
  if (mp_rate.gte(1)) {
    throw new Error('mp_rate must be lower than 1');
  }
  const mp_iva_rate = quantizeMargin(normalizeDecimalInput(raw.mp_iva_rate ?? 0));
  const target = String(raw.target || '').trim().toLowerCase();
  if (!['margen', 'precio'].includes(target)) {
    throw new Error("target must be either 'margen' or 'precio'");
  }
  const quantity = ensureQuantity(raw.quantity);
  const rounding = ensureRoundingRule(raw.rounding);
  const order_reference = raw.order_reference ? String(raw.order_reference).trim() : null;
  const tc_aduana_source = raw.tc_aduana_source ? String(raw.tc_aduana_source).trim() || null : null;
  const tc_aduana_source_key = raw.tc_aduana_source_key
    ? String(raw.tc_aduana_source_key).trim() || null
    : null;

  let margen_objetivo = null;
  let precio_neto_input_ars = null;
  if (target === 'margen') {
    if (raw.margen_objetivo === undefined || raw.margen_objetivo === null) {
      throw new Error('margen_objetivo is required when target is margen');
    }
    margen_objetivo = quantizeMargin(normalizeDecimalInput(raw.margen_objetivo));
    if (margen_objetivo.gte(1)) {
      throw new Error('margen_objetivo must be lower than 1');
    }
  } else {
    if (raw.precio_neto_input_ars === undefined || raw.precio_neto_input_ars === null) {
      throw new Error("precio_neto_input_ars is required when target is 'precio'");
    }
    precio_neto_input_ars = quantizeArs(normalizeDecimalInput(raw.precio_neto_input_ars));
  }

  const additional_taxes = Array.isArray(raw.additional_taxes)
    ? raw.additional_taxes.map(ensureAdditionalTax)
    : [];

  return {
    costs,
    tc_aduana,
    di_rate,
    apply_tasa_estadistica,
    iva_rate,
    perc_iva_rate,
    perc_ganancias_rate,
    gastos_locales_ars,
    costos_salida_ars,
    mp_rate,
    mp_iva_rate,
    target,
    margen_objetivo,
    precio_neto_input_ars,
    quantity,
    rounding,
    additional_taxes,
    order_reference,
    tc_aduana_source,
    tc_aduana_source_key,
  };
}

function convertCostToUsd(amount, currency, exchangeRate) {
  if (currency === 'USD') {
    return quantizeUsd(amount);
  }
  return quantizeUsd(new Decimal(amount).div(exchangeRate));
}

function calculateAdditionalTaxes(params, cif_usd, di_usd, tasa_est_usd) {
  const details = [];
  let taxesTotalArs = new Decimal(0);
  let taxesTotalUsd = new Decimal(0);

  const cifBased = [];
  const baseIvaBased = [];

  for (const tax of params.additional_taxes) {
    if (tax.base === 'CIF') {
      const amountUsd = quantizeUsd(cif_usd.mul(tax.rate));
      cifBased.push({ tax, amountUsd });
    } else if (tax.base === 'BaseIVA') {
      baseIvaBased.push(tax);
    } else {
      const amountArs = quantizeArs(tax.amount_ars);
      const amountUsd = quantizeUsd(amountArs.div(params.tc_aduana));
      details.push({
        name: tax.name,
        amount_ars: amountArs,
        amount_usd: amountUsd,
      });
      taxesTotalArs = taxesTotalArs.add(amountArs);
    }
  }

  let subtotalBaseIva = cif_usd.add(di_usd).add(tasa_est_usd);
  for (const { amountUsd, tax } of cifBased) {
    details.push({
      name: tax.name,
      amount_usd: amountUsd,
      amount_ars: quantizeArs(amountUsd.mul(params.tc_aduana)),
    });
    taxesTotalUsd = taxesTotalUsd.add(amountUsd);
    subtotalBaseIva = subtotalBaseIva.add(amountUsd);
  }

  for (const tax of baseIvaBased) {
    const amountUsd = quantizeUsd(subtotalBaseIva.mul(tax.rate));
    details.push({
      name: tax.name,
      amount_usd: amountUsd,
      amount_ars: quantizeArs(amountUsd.mul(params.tc_aduana)),
    });
    taxesTotalUsd = taxesTotalUsd.add(amountUsd);
    subtotalBaseIva = subtotalBaseIva.add(amountUsd);
  }

  return { details, taxesTotalUsd, taxesTotalArs };
}

function roundPrice(value, roundingRule) {
  if (!roundingRule) {
    return quantizeArs(value);
  }
  const step = roundingRule.step;
  if (!step || step.lte(0)) {
    return quantizeArs(value);
  }
  const divided = new Decimal(value).div(step);
  let rounded;
  if (roundingRule.mode === 'nearest') {
    rounded = divided.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  } else if (roundingRule.mode === 'up') {
    rounded = divided.toDecimalPlaces(0, Decimal.ROUND_CEIL);
  } else {
    rounded = divided.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  }
  let candidate = quantizeArs(rounded.mul(step));

  const endings = roundingRule.psychological_endings || [];
  for (const ending of endings) {
    try {
      const endingDecimal = normalizeDecimalInput(ending);
      const endingFraction = quantizeArs(endingDecimal.mod(1));
      const baseFloor = candidate.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
      let candidateWithEnding = baseFloor.add(endingFraction);
      if (candidateWithEnding.lte(0)) {
        continue;
      }
      if (roundingRule.mode === 'up' && candidateWithEnding.lt(candidate)) {
        continue;
      }
      if (roundingRule.mode === 'down' && candidateWithEnding.gt(candidate)) {
        continue;
      }
      candidate = quantizeArs(candidateWithEnding);
      break;
    } catch {
      continue;
    }
  }

  return quantizeArs(candidate);
}

function calculateImportCost(params, { mpFeeOverride = null } = {}) {
  const exchangeRate = params.tc_aduana;
  const cifComponents = {
    FOB: convertCostToUsd(params.costs.fob.amount, params.costs.fob.currency, exchangeRate),
    Freight: convertCostToUsd(
      params.costs.freight.amount,
      params.costs.freight.currency,
      exchangeRate,
    ),
    Insurance: convertCostToUsd(
      params.costs.insurance.amount,
      params.costs.insurance.currency,
      exchangeRate,
    ),
  };

  const cif_usd = quantizeUsd(Object.values(cifComponents).reduce((acc, val) => acc.add(val), new Decimal(0)));
  const di_usd = quantizeUsd(cif_usd.mul(params.di_rate));
  const tasa_est_usd = params.apply_tasa_estadistica
    ? quantizeUsd(cif_usd.mul(new Decimal('0.03')))
    : quantizeUsd(new Decimal(0));

  const { details: additionalTaxesDetails, taxesTotalUsd, taxesTotalArs: taxesArsFixed } =
    calculateAdditionalTaxes(params, cif_usd, di_usd, tasa_est_usd);

  const base_iva_usd = cif_usd.add(di_usd).add(tasa_est_usd).add(taxesTotalUsd);
  const iva_usd = quantizeUsd(base_iva_usd.mul(params.iva_rate));
  const perc_iva_usd = quantizeUsd(base_iva_usd.mul(params.perc_iva_rate));

  const tributos_ars_base = quantizeArs(
    base_iva_usd.add(iva_usd).add(perc_iva_usd).add(di_usd).add(tasa_est_usd).mul(exchangeRate),
  );
  const perc_ganancias_ars = quantizeArs(tributos_ars_base.mul(params.perc_ganancias_rate));

  const breakdown = {
    CIF_USD: cif_usd,
    DI_USD: di_usd,
    Tasa_Estadistica_USD: tasa_est_usd,
    Base_IVA_USD: base_iva_usd,
    IVA_USD: iva_usd,
    Percepcion_IVA_USD: perc_iva_usd,
    Percepcion_Ganancias_ARS: perc_ganancias_ars,
    Gastos_Locales_ARS: quantizeArs(params.gastos_locales_ars),
    Costos_Salida_ARS: quantizeArs(params.costos_salida_ars),
  };

  for (const [key, value] of Object.entries(cifComponents)) {
    breakdown[`${key}_USD`] = quantizeUsd(value);
  }

  const cif_ars = quantizeArs(cif_usd.mul(exchangeRate));
  const di_ars = quantizeArs(di_usd.mul(exchangeRate));
  const tasa_est_ars = quantizeArs(tasa_est_usd.mul(exchangeRate));
  const iva_ars = quantizeArs(iva_usd.mul(exchangeRate));
  const perc_iva_ars = quantizeArs(perc_iva_usd.mul(exchangeRate));
  let additional_taxes_ars = taxesArsFixed.add(quantizeArs(taxesTotalUsd.mul(exchangeRate)));

  const costo_puesto_ars = quantizeArs(
    cif_ars
      .add(di_ars)
      .add(tasa_est_ars)
      .add(iva_ars)
      .add(perc_iva_ars)
      .add(perc_ganancias_ars)
      .add(additional_taxes_ars)
      .add(params.gastos_locales_ars),
  );

  let precio_neto = new Decimal(0);
  let comision_mp = new Decimal(0);
  let iva_comision = new Decimal(0);
  let mp_fee_total = new Decimal(0);

  if (params.target === 'margen') {
    const denominator = new Decimal(1)
      .sub(params.mp_rate.mul(new Decimal(1).add(params.mp_iva_rate)))
      .sub(params.margen_objetivo);
    if (denominator.lte(0)) {
      throw new Error('The provided parameters produce a negative or zero denominator');
    }
    precio_neto = quantizeArs(costo_puesto_ars.add(params.costos_salida_ars).div(denominator));
    comision_mp = quantizeArs(precio_neto.mul(params.mp_rate));
    iva_comision = quantizeArs(comision_mp.mul(params.mp_iva_rate));
    mp_fee_total = comision_mp.add(iva_comision);
  } else {
    precio_neto = quantizeArs(params.precio_neto_input_ars);
    if (mpFeeOverride !== null && mpFeeOverride !== undefined) {
      mp_fee_total = quantizeArs(normalizeDecimalInput(mpFeeOverride));
      if (params.mp_iva_rate.gt(0)) {
        const divisor = new Decimal(1).add(params.mp_iva_rate);
        comision_mp = quantizeArs(mp_fee_total.div(divisor));
        iva_comision = quantizeArs(mp_fee_total.sub(comision_mp));
      } else {
        comision_mp = mp_fee_total;
        iva_comision = new Decimal(0);
      }
    } else {
      comision_mp = quantizeArs(precio_neto.mul(params.mp_rate));
      iva_comision = quantizeArs(comision_mp.mul(params.mp_iva_rate));
      mp_fee_total = comision_mp.add(iva_comision);
    }
  }

  let utilidad = quantizeArs(precio_neto.sub(costo_puesto_ars).sub(params.costos_salida_ars).sub(mp_fee_total));
  let margen = precio_neto.eq(0) ? new Decimal(0) : quantizeMargin(utilidad.div(precio_neto));

  precio_neto = roundPrice(precio_neto, params.rounding);

  if (params.target === 'margen' || params.rounding) {
    if (mpFeeOverride !== null && mpFeeOverride !== undefined && params.target === 'precio') {
      mp_fee_total = quantizeArs(normalizeDecimalInput(mpFeeOverride));
      if (params.mp_iva_rate.gt(0)) {
        const divisor = new Decimal(1).add(params.mp_iva_rate);
        comision_mp = quantizeArs(mp_fee_total.div(divisor));
        iva_comision = quantizeArs(mp_fee_total.sub(comision_mp));
      } else {
        comision_mp = mp_fee_total;
        iva_comision = new Decimal(0);
      }
    } else {
      comision_mp = quantizeArs(precio_neto.mul(params.mp_rate));
      iva_comision = quantizeArs(comision_mp.mul(params.mp_iva_rate));
      mp_fee_total = comision_mp.add(iva_comision);
    }
    utilidad = quantizeArs(precio_neto.sub(costo_puesto_ars).sub(params.costos_salida_ars).sub(mp_fee_total));
    margen = precio_neto.eq(0) ? new Decimal(0) : quantizeMargin(utilidad.div(precio_neto));
  }

  const precio_final = quantizeArs(precio_neto.mul(new Decimal(1).add(params.iva_rate)));

  const totals = {
    costo_puesto_total: quantizeArs(costo_puesto_ars.mul(params.quantity)),
    precio_neto_total: quantizeArs(precio_neto.mul(params.quantity)),
    precio_final_total: quantizeArs(precio_final.mul(params.quantity)),
    utilidad_total: quantizeArs(utilidad.mul(params.quantity)),
  };

  const quantityDecimal = new Decimal(params.quantity);
  const unitary = {
    costo_puesto_unitario: quantizeArs(costo_puesto_ars.div(quantityDecimal)),
    precio_neto_unitario: quantizeArs(precio_neto),
    precio_final_unitario: quantizeArs(precio_final),
    utilidad_unitaria: quantizeArs(utilidad.div(quantityDecimal)),
  };

  breakdown.CIF_ARS = cif_ars;
  breakdown.DI_ARS = di_ars;
  breakdown.Tasa_Estadistica_ARS = tasa_est_ars;
  breakdown.IVA_ARS = iva_ars;
  breakdown.Percepcion_IVA_ARS = perc_iva_ars;
  breakdown.Additional_Taxes_ARS = quantizeArs(additional_taxes_ars);
  breakdown.Comision_MP_ARS = comision_mp;
  breakdown.IVA_Comision_MP_ARS = iva_comision;
  breakdown.MP_Fee_Total_ARS = mp_fee_total;
  breakdown.Utilidad_ARS = utilidad;
  breakdown.Margen = margen;

  return {
    breakdown,
    additional_taxes: additionalTaxesDetails.map((tax) => ({
      name: tax.name,
      amount_usd: quantizeUsd(tax.amount_usd || 0),
      amount_ars: quantizeArs(tax.amount_ars || 0),
    })),
    costo_puesto_ars,
    precio_neto_ars: precio_neto,
    precio_final_ars: precio_final,
    utilidad,
    margen,
    comision_mp,
    iva_comision_mp: iva_comision,
    mp_fee_total,
    quantity: params.quantity,
    totals,
    unitary,
  };
}

function decimalToString(decimal) {
  if (decimal instanceof Decimal) {
    return decimal.toFixed(decimal.decimalPlaces());
  }
  if (typeof decimal === 'number') {
    return decimal.toString();
  }
  return String(decimal);
}

function serializeDecimal(decimal, digits = null) {
  if (!(decimal instanceof Decimal)) {
    return decimal;
  }
  if (digits === null) {
    return decimal.toFixed(decimal.decimalPlaces());
  }
  return decimal.toFixed(digits);
}

function serializeParameters(params) {
  const serializeMoney = (money) => ({
    amount: serializeDecimal(money.amount, 4),
    currency: money.currency,
  });

  return {
    costs: {
      fob: serializeMoney(params.costs.fob),
      freight: serializeMoney(params.costs.freight),
      insurance: serializeMoney(params.costs.insurance),
    },
    tc_aduana: serializeDecimal(params.tc_aduana, 4),
    di_rate: serializeDecimal(params.di_rate, 4),
    apply_tasa_estadistica: params.apply_tasa_estadistica,
    iva_rate: serializeDecimal(params.iva_rate, 4),
    perc_iva_rate: serializeDecimal(params.perc_iva_rate, 4),
    perc_ganancias_rate: serializeDecimal(params.perc_ganancias_rate, 4),
    gastos_locales_ars: serializeDecimal(params.gastos_locales_ars, 2),
    costos_salida_ars: serializeDecimal(params.costos_salida_ars, 2),
    mp_rate: serializeDecimal(params.mp_rate, 4),
    mp_iva_rate: serializeDecimal(params.mp_iva_rate, 4),
    target: params.target,
    margen_objetivo: params.margen_objetivo ? serializeDecimal(params.margen_objetivo, 4) : null,
    precio_neto_input_ars: params.precio_neto_input_ars
      ? serializeDecimal(params.precio_neto_input_ars, 2)
      : null,
    quantity: params.quantity,
    rounding: params.rounding
      ? {
          step: serializeDecimal(params.rounding.step, 2),
          mode: params.rounding.mode,
          psychological_endings: params.rounding.psychological_endings,
        }
      : null,
    additional_taxes: params.additional_taxes.map((tax) => ({
      name: tax.name,
      base: tax.base,
      rate: tax.rate ? serializeDecimal(tax.rate, 4) : null,
      amount_ars: tax.amount_ars ? serializeDecimal(tax.amount_ars, 2) : null,
    })),
    order_reference: params.order_reference,
    tc_aduana_source: params.tc_aduana_source || null,
    tc_aduana_source_key: params.tc_aduana_source_key || null,
  };
}

function serializeBreakdown(breakdown) {
  const result = {};
  for (const [key, value] of Object.entries(breakdown)) {
    if (value instanceof Decimal) {
      const digits = key.toUpperCase().includes('_USD') ? 4 : 2;
      if (key.toLowerCase().includes('margen')) {
        result[key] = value.toFixed(4);
      } else {
        result[key] = value.toFixed(digits);
      }
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

function serializeTotals(totals) {
  const result = {};
  for (const [key, value] of Object.entries(totals)) {
    result[key] = value instanceof Decimal ? value.toFixed(2) : String(value);
  }
  return result;
}

function serializeAdditionalTaxes(taxes) {
  return taxes.map((tax) => ({
    name: tax.name,
    amount_usd: tax.amount_usd instanceof Decimal ? tax.amount_usd.toFixed(4) : '0.0000',
    amount_ars: tax.amount_ars instanceof Decimal ? tax.amount_ars.toFixed(2) : '0.00',
  }));
}

function serializeCalculationResult(result) {
  return {
    precio_neto_ars: result.precio_neto_ars.toFixed(2),
    precio_final_ars: result.precio_final_ars.toFixed(2),
    utilidad_ars: result.utilidad.toFixed(2),
    margen: result.margen.toFixed(4),
    costo_puesto_ars: result.costo_puesto_ars.toFixed(2),
    breakdown: serializeBreakdown(result.breakdown),
    additional_taxes: serializeAdditionalTaxes(result.additional_taxes),
    totals: serializeTotals(result.totals),
    unitary: serializeTotals(result.unitary),
  };
}

module.exports = {
  normalizeParameters,
  calculateImportCost,
  serializeCalculationResult,
  serializeParameters,
  normalizeDecimalInput,
  quantizeArs,
  quantizeUsd,
};
