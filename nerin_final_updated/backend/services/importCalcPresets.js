const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const { dataPath } = require('../utils/dataDir');

const DEFAULTS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'import_calc_backend',
  'config',
  'defaults.yaml',
);
const STORE_PATH = dataPath('import-calc-presets.json');

let presets = [];
let initialized = false;
let lastPresetId = 0;

function clonePreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description || null,
    parameters: JSON.parse(JSON.stringify(preset.parameters || {})),
  };
}

function persist() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(presets, null, 2), 'utf8');
  } catch (error) {
    console.error('No se pudieron guardar presets de calculadora', error?.message || error);
  }
}

function loadFromStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        presets = data.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || null,
          parameters: item.parameters || {},
        }));
        lastPresetId = presets.reduce((max, preset) => Math.max(max, preset.id || 0), 0);
        return true;
      }
    }
  } catch (error) {
    console.warn('No se pudo leer el store de presets', error?.message || error);
  }
  return false;
}

function ensureInitialized() {
  if (initialized) {
    return;
  }
  initialized = true;
  if (loadFromStore()) {
    return;
  }
  try {
    const raw = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    const parsed = YAML.parse(raw) || [];
    if (Array.isArray(parsed)) {
      presets = parsed.map((item, index) => ({
        id: index + 1,
        name: item.name,
        description: item.notes || null,
        parameters: {
          di_rate: item.di_rate,
          iva_rate: item.iva_rate,
          perc_iva_rate: item.perc_iva_rate,
          perc_ganancias_rate: item.perc_ganancias_rate,
          apply_tasa_estadistica: item.apply_tasa_estadistica,
          mp_rate: item.mp_rate,
          mp_iva_rate: item.mp_iva_rate,
          rounding: item.rounding_step
            ? {
                step: item.rounding_step,
                mode: 'nearest',
                psychological_endings: item.psychological_prices || null,
              }
            : null,
        },
      }));
      lastPresetId = presets.length;
      persist();
    }
  } catch (error) {
    console.warn('No se pudieron cargar presets por defecto', error?.message || error);
    presets = [];
    lastPresetId = 0;
    persist();
  }
}

function listPresets() {
  ensureInitialized();
  return presets.map(clonePreset);
}

function getPresetByName(name) {
  ensureInitialized();
  return presets.find((preset) => preset.name === name) || null;
}

function createPreset(name, description, parameters) {
  ensureInitialized();
  lastPresetId += 1;
  const preset = {
    id: lastPresetId,
    name,
    description: description || null,
    parameters: JSON.parse(JSON.stringify(parameters || {})),
  };
  presets.push(preset);
  persist();
  return clonePreset(preset);
}

module.exports = {
  listPresets,
  getPresetByName,
  createPreset,
  ensureInitialized,
};
