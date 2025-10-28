const {
  normalizeParameters,
  calculateImportCost,
  serializeCalculationResult,
  serializeParameters,
  normalizeDecimalInput,
} = require('../services/importCalculatorLocal');
const { listPresets, getPresetByName, createPreset, ensureInitialized } = require('../services/importCalcPresets');
const store = require('../data/importCalcStore');
const { buildCsvBuffer, buildXlsxBuffer, defaultFilename } = require('../services/importCalcExporter');

ensureInitialized();
store.load();

async function readJsonBody(req, parseBody) {
  await parseBody(req);
  if (!req.body || typeof req.body !== 'object') {
    throw new Error('JSON body required');
  }
  return req.body;
}

function sendJson(res, statusCode, payload, sendJsonFn) {
  sendJsonFn(res, statusCode, payload);
}

function mergeParametersWithPreset(preset, parameters) {
  if (!preset) {
    return parameters;
  }
  return { ...preset.parameters, ...parameters };
}

async function handleCalculationsPost(req, res, { parseBody, sendJson: sendJsonFn }, presetName) {
  const body = await readJsonBody(req, parseBody);
  const requestedPreset = body.preset_name || presetName;
  const rawParameters = body.parameters || {};
  const preset = requestedPreset ? getPresetByName(requestedPreset) : null;
  if (requestedPreset && !preset) {
    sendJsonFn(res, 404, { detail: 'Preset not found' });
    return;
  }
  const mergedParameters = mergeParametersWithPreset(preset, rawParameters);
  let normalized;
  try {
    normalized = normalizeParameters(mergedParameters);
  } catch (error) {
    sendJsonFn(res, 400, { detail: error.message });
    return;
  }

  let calculationResult;
  try {
    calculationResult = calculateImportCost(normalized);
  } catch (error) {
    sendJsonFn(res, 400, { detail: error.message });
    return;
  }

  const responsePayload = serializeCalculationResult(calculationResult);
  const stored = store.createCalculation({
    parameters: serializeParameters(normalized),
    results: responsePayload,
    order_reference: normalized.order_reference,
    preset_name: requestedPreset || null,
    mp_fee_applied: Number(responsePayload.breakdown?.MP_Fee_Total_ARS || 0),
  });

  sendJsonFn(res, 201, {
    calculation_id: stored.id,
    created_at: stored.created_at,
    parameters: stored.parameters,
    results: stored.results,
  });
}

function handleCalculationsGet(req, res, sendJsonFn, id) {
  const numericId = Number.parseInt(id, 10);
  const calculation = store.getCalculation(numericId);
  if (!calculation) {
    sendJsonFn(res, 404, { detail: 'Calculation not found' });
    return;
  }
  sendJsonFn(res, 200, {
    calculation_id: calculation.id,
    created_at: calculation.created_at,
    parameters: calculation.parameters,
    results: calculation.results,
  });
}

function handleCalculationExport(res, sendStatus, calculation, format) {
  const breakdown = calculation.results?.breakdown || {};
  if (format === 'csv') {
    const buffer = buildCsvBuffer(breakdown);
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=${defaultFilename('calculo', 'csv')}`,
    });
    res.end(buffer);
    return;
  }
  if (format === 'xlsx') {
    const buffer = buildXlsxBuffer(breakdown);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=${defaultFilename('calculo', 'xlsx')}`,
    });
    res.end(buffer);
    return;
  }
  sendStatus(res, 400);
}

async function handlePaymentNotification(req, res, { parseBody, sendJson: sendJsonFn }) {
  const body = await readJsonBody(req, parseBody);
  if (!body.payment_id) {
    sendJsonFn(res, 400, { detail: 'payment_id is required' });
    return;
  }
  if (!body.fee_total) {
    sendJsonFn(res, 400, { detail: 'fee_total is required' });
    return;
  }
  const notification = store.upsertNotification({
    payment_id: String(body.payment_id),
    order_reference: body.order_reference ? String(body.order_reference) : null,
    amount: Number(body.amount || 0),
    currency: body.currency || 'ARS',
    fee_total: Number(body.fee_total),
    fee_breakdown: body.fee_breakdown || {},
    raw_payload: body.raw_payload || {},
  });

  let calculation = null;
  if (notification.order_reference) {
    const latest = store.findLatestCalculationByOrderReference(notification.order_reference);
    if (latest) {
      try {
        const normalized = normalizeParameters(latest.parameters);
        normalized.target = 'precio';
        normalized.precio_neto_input_ars = normalizeDecimalInput(
          latest.results?.precio_neto_ars || '0',
        );
        const updated = calculateImportCost(normalized, {
          mpFeeOverride: notification.fee_total,
        });
        const serialized = serializeCalculationResult(updated);
        calculation = store.updateCalculation({
          id: latest.id,
          results: serialized,
          mp_fee_applied: Number(notification.fee_total),
          mp_fee_details: notification.fee_breakdown,
        });
      } catch (error) {
        console.warn('No se pudo actualizar cálculo con fee real', error?.message || error);
      }
    }
  }

  sendJsonFn(res, 200, {
    payment_id: notification.payment_id,
    order_reference: notification.order_reference,
    fee_total: notification.fee_total,
    calculation_id: calculation ? calculation.id : undefined,
    updated_results: calculation ? calculation.results : undefined,
  });
}

function matchRoute(path) {
  if (path === '/presets') {
    return { type: 'presets' };
  }
  if (path === '/calculations') {
    return { type: 'calculations' };
  }
  const calcMatch = path.match(/^\/calculations\/(\d+)$/);
  if (calcMatch) {
    return { type: 'calculation', id: calcMatch[1] };
  }
  const exportMatch = path.match(/^\/calculations\/(\d+)\/export$/);
  if (exportMatch) {
    return { type: 'export', id: exportMatch[1] };
  }
  if (path === '/payments/notify') {
    return { type: 'notify' };
  }
  return { type: 'unknown' };
}

async function handleCalcApiRequest(req, res, parsedUrl, utils) {
  const path = parsedUrl.pathname.replace(/^\/calc-api/, '') || '/';
  const route = matchRoute(path);
  if (route.type === 'presets' && req.method === 'GET') {
    const data = listPresets();
    utils.sendJson(res, 200, data);
    return;
  }
  if (route.type === 'presets' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, utils.parseBody);
      if (!body.name) {
        utils.sendJson(res, 400, { detail: 'name is required' });
        return;
      }
      const preset = createPreset(body.name, body.description, body.parameters || {});
      utils.sendJson(res, 201, preset);
    } catch (error) {
      utils.sendJson(res, 400, { detail: error.message });
    }
    return;
  }
  if (route.type === 'calculations' && req.method === 'POST') {
    await handleCalculationsPost(req, res, utils, parsedUrl.query?.preset_name || null);
    return;
  }
  if (route.type === 'calculation' && req.method === 'GET') {
    handleCalculationsGet(req, res, utils.sendJson, route.id);
    return;
  }
  if (route.type === 'export' && req.method === 'GET') {
    const calculation = store.getCalculation(Number.parseInt(route.id, 10));
    if (!calculation) {
      utils.sendStatus(res, 404);
      return;
    }
    const format = (parsedUrl.query?.format || 'csv').toString().toLowerCase();
    handleCalculationExport(res, utils.sendStatus, calculation, format);
    return;
  }
  if (route.type === 'notify' && req.method === 'POST') {
    await handlePaymentNotification(req, res, utils);
    return;
  }
  utils.sendStatus(res, 404);
}

module.exports = {
  handleCalcApiRequest,
};
