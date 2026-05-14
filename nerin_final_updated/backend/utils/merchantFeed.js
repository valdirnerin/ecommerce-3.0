const { detectProductType } = require('./productTaxonomy');

const GOOGLE_CATEGORY = 'Electrónica > Comunicaciones > Telefonía > Accesorios para móviles';

function cleanText(value, max = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

function toBool(v) { return v === true || v === 1 || String(v).toLowerCase() === 'true'; }

function mapProductTypeToFeed(label) {
  switch (label) {
    case 'Pantalla / display': return 'Pantallas';
    case 'Batería': return 'Baterias';
    case 'Adhesivo / pegamento': return 'Repuestos celulares > Adhesivos';
    case 'Adhesivo para pantalla': return 'Repuestos celulares > Adhesivos para pantalla';
    case 'Placa / pin de carga': return 'Repuestos celulares > Pines de carga';
    case 'Flex / cable interno': return 'Repuestos celulares > Flex';
    case 'Herramienta / accesorio técnico':
    case 'Herramienta / accesorio tecnico': return 'Herramientas para reparación';
    case 'Protector de pantalla': return 'Protectores de pantalla';
    case 'Tapa trasera / carcasa': return 'Tapas traseras y carcasas';
    case 'Cámara':
    case 'Lente de cámara': return 'Cámaras y lentes';
    case 'Bandeja / lector SIM': return 'Bandejas SIM';
    case 'Componente electrónico': return 'Componentes electrónicos';
    default: return 'Repuestos celulares > Otros';
  }
}

function buildMerchantTitle(row, raw) {
  return cleanText(row.name || row.title || raw.name || raw.title || raw.description || '');
}

function computeAvailability(row, raw, preorderDays = 30) {
  const stockLocal = Number(row.stock ?? raw.stock ?? 0);
  const sellableRemote = Number(raw.remote_stock ?? raw.stock_remote ?? raw.available_remote ?? 0) > 0 || toBool(raw.allow_backorder) || toBool(raw.sellable_on_demand) || String(raw.availability || '').toLowerCase() === 'preorder';
  if (stockLocal > 0) return { availability: 'in_stock', availabilityDate: '' };
  if (!sellableRemote) return { availability: null, availabilityDate: '' };
  const existingDate = String(raw.availability_date || raw.preorder_date || '').trim();
  if (existingDate) return { availability: 'preorder', availabilityDate: existingDate };
  const d = new Date(Date.now() + Number(preorderDays) * 86400000).toISOString().slice(0, 10);
  return { availability: 'preorder', availabilityDate: d };
}

function isEligibleState(row, raw) {
  const flags = [row.status, row.visibility, raw.status, raw.visibility].filter(Boolean).join(' ').toLowerCase();
  if (Number(row.deleted) === 1 || Number(row.archived) === 1 || Number(row.enabled) === 0 || Number(row.vip_only) === 1 || Number(row.wholesale_only) === 1) return false;
  if (toBool(raw.hidden) || toBool(raw.private) || toBool(raw.draft) || toBool(raw.deleted) || toBool(raw.archived) || toBool(raw.disabled) || /deleted|archived|disabled|hidden|private|draft|vip|wholesale/.test(flags)) return false;
  return Number(row.is_public) === 1 || toBool(raw.is_public) || toBool(raw.publicable);
}

module.exports = { GOOGLE_CATEGORY, mapProductTypeToFeed, buildMerchantTitle, computeAvailability, isEligibleState, cleanText, detectProductType };
