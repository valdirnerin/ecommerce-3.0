const fs = require('fs');
const { dataPath } = require('../utils/dataDir');

const STORE_PATH = dataPath('import-calculator-store.json');

let state = {
  lastCalculationId: 0,
  calculations: [],
  notifications: [],
};
let initialized = false;

function load() {
  if (initialized) {
    return;
  }
  initialized = true;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        state = {
          lastCalculationId: Number(data.lastCalculationId) || 0,
          calculations: Array.isArray(data.calculations) ? data.calculations : [],
          notifications: Array.isArray(data.notifications) ? data.notifications : [],
        };
      }
    }
  } catch (error) {
    console.warn('No se pudo leer el store de cálculos', error?.message || error);
  }
}

function persist() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('No se pudo guardar el store de cálculos', error?.message || error);
  }
}

function createCalculation(record) {
  load();
  state.lastCalculationId += 1;
  const now = new Date().toISOString();
  const calculation = {
    id: state.lastCalculationId,
    created_at: now,
    parameters: record.parameters,
    results: record.results,
    order_reference: record.order_reference || null,
    preset_name: record.preset_name || null,
    mp_fee_applied: record.mp_fee_applied || null,
    mp_fee_details: record.mp_fee_details || {},
  };
  state.calculations.push(calculation);
  persist();
  return { ...calculation };
}

function updateCalculation(calculation) {
  load();
  const index = state.calculations.findIndex((item) => item.id === calculation.id);
  if (index >= 0) {
    state.calculations[index] = {
      ...state.calculations[index],
      ...calculation,
      mp_fee_details: calculation.mp_fee_details || state.calculations[index].mp_fee_details || {},
    };
    persist();
    return { ...state.calculations[index] };
  }
  return null;
}

function getCalculation(id) {
  load();
  const found = state.calculations.find((calc) => calc.id === id);
  return found ? { ...found } : null;
}

function findLatestCalculationByOrderReference(orderReference) {
  load();
  const filtered = state.calculations
    .filter((calc) => calc.order_reference && calc.order_reference === orderReference)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  return filtered.length ? { ...filtered[0] } : null;
}

function upsertNotification(notification) {
  load();
  const existingIndex = state.notifications.findIndex(
    (item) => item.payment_id === notification.payment_id,
  );
  const stored = {
    payment_id: notification.payment_id,
    order_reference: notification.order_reference || null,
    amount: Number(notification.amount),
    currency: notification.currency,
    fee_total: Number(notification.fee_total),
    fee_breakdown: notification.fee_breakdown || {},
    raw_payload: notification.raw_payload || {},
    received_at: notification.received_at || new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    state.notifications[existingIndex] = stored;
  } else {
    state.notifications.push(stored);
  }
  persist();
  return { ...stored };
}

module.exports = {
  load,
  createCalculation,
  updateCalculation,
  getCalculation,
  findLatestCalculationByOrderReference,
  upsertNotification,
};
