const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '../data/shipping.json');

function getTable() {
  try {
    const content = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { costos: [] };
  }
}

function getShippingCost(provincia) {
  const table = getTable();
  const match = table.costos.find(c => c.provincia.toLowerCase() === String(provincia || '').toLowerCase());
  if (match) return match.costo;
  const other = table.costos.find(c => c.provincia === 'Otras');
  return other ? other.costo : 0;
}

module.exports = { getShippingCost };
