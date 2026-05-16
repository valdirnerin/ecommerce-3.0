const { detectProductType } = require('./productTaxonomy');

const GOOGLE_CATEGORY = 'Electrónica > Comunicaciones > Telefonía > Accesorios para móviles';
const VALID_AVAILABILITY = new Set(['in_stock', 'preorder']);

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

function isValidFeedUrl(v) {
  if (!v || typeof v !== 'string') return false;
  return /^https?:\/\//i.test(v);
}

function getSkipTemplate() {
  return {
    notPublic: 0, privateOrHidden: 0, disabled: 0, deleted: 0, archived: 0, draft: 0, vipOnly: 0, wholesaleOnly: 0,
    missingId: 0, missingTitle: 0, missingDescription: 0, missingLink: 0, missingImage: 0, invalidImageUrl: 0,
    missingPrice: 0, invalidPrice: 0, missingAvailability: 0, invalidAvailability: 0, taxonomyBlocked: 0, soft404Risk: 0,
  };
}

function pushSample(bucket, entry, max = 10) {
  if (bucket.length < max) bucket.push(entry);
}

function buildMerchantFeedAudit(rows, { limit = 500, offset = 0, preorderDays = 30, baseUrl = 'https://nerinparts.com.ar' } = {}) {
  const skipped = getSkipTemplate();
  const samplesEligible = [];
  const samplesSkipped = [];
  const productTypeBreakdown = {};
  const availabilityBreakdown = {};
  const sanitizedLimit = Math.max(1, Number(limit) || 500);
  const sanitizedOffset = Math.max(0, Number(offset) || 0);

  let publicProductsCount = 0;
  let eligibleCount = 0;
  let emittedCount = 0;

  for (const row of rows) {
    let raw = {};
    try { raw = JSON.parse(row.raw_json || '{}'); } catch {}

    if (!(Number(row.is_public) === 1 || toBool(raw.is_public) || toBool(raw.publicable))) {
      skipped.notPublic += 1;
      pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'notPublic' });
      continue;
    }
    publicProductsCount += 1;

    const flags = [row.status, row.visibility, raw.status, raw.visibility].filter(Boolean).join(' ').toLowerCase();
    if (toBool(raw.private) || toBool(raw.hidden) || /private|hidden/.test(flags)) { skipped.privateOrHidden += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'privateOrHidden' }); continue; }
    if (Number(row.enabled) === 0 || toBool(raw.disabled) || /disabled/.test(flags)) { skipped.disabled += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'disabled' }); continue; }
    if (Number(row.deleted) === 1 || toBool(raw.deleted) || /deleted/.test(flags)) { skipped.deleted += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'deleted' }); continue; }
    if (Number(row.archived) === 1 || toBool(raw.archived) || /archived/.test(flags)) { skipped.archived += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'archived' }); continue; }
    if (toBool(raw.draft) || /draft/.test(flags)) { skipped.draft += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'draft' }); continue; }
    if (Number(row.vip_only) === 1 || toBool(raw.vip_only) || /vip/.test(flags)) { skipped.vipOnly += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'vipOnly' }); continue; }
    if (Number(row.wholesale_only) === 1 || toBool(raw.wholesale_only) || /wholesale/.test(flags)) { skipped.wholesaleOnly += 1; pushSample(samplesSkipped, { id: row.id || row.sku || null, reason: 'wholesaleOnly' }); continue; }

    const identifier = String(row.sku || row.id || row.mpn || row.part_number || raw.sku || raw.id || raw.mpn || raw.part_number || '').trim();
    if (!identifier) { skipped.missingId += 1; pushSample(samplesSkipped, { reason: 'missingId' }); continue; }

    const title = buildMerchantTitle(row, raw);
    if (!title) { skipped.missingTitle += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingTitle' }); continue; }

    const description = cleanText(row.description || raw.description || `${title} disponible en NERIN Parts.`, 5000);
    if (!description) { skipped.missingDescription += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingDescription' }); continue; }

    const slug = String(row.public_slug || row.slug || raw.public_slug || raw.slug || '').trim();
    const link = slug ? `${baseUrl}/p/${encodeURIComponent(slug)}` : '';
    if (!link) { skipped.missingLink += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingLink' }); continue; }

    const imageCandidates = [row.image, raw.image, ...(Array.isArray(raw.images) ? raw.images : [])].filter(Boolean);
    if (!imageCandidates.length) { skipped.missingImage += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingImage' }); continue; }
    const imageLink = String(imageCandidates[0]);
    if (!isValidFeedUrl(imageLink)) { skipped.invalidImageUrl += 1; pushSample(samplesSkipped, { id: identifier, reason: 'invalidImageUrl' }); continue; }

    const priceNum = Number(row.precio_final ?? row.price_minorista ?? row.precio_minorista ?? row.price ?? raw.precio_final ?? raw.price_minorista ?? raw.price);
    if ((row.price == null && raw.price == null && row.precio_final == null && raw.precio_final == null)) { skipped.missingPrice += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingPrice' }); continue; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { skipped.invalidPrice += 1; pushSample(samplesSkipped, { id: identifier, reason: 'invalidPrice' }); continue; }

    const av = computeAvailability(row, raw, preorderDays);
    if (!av.availability) { skipped.missingAvailability += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingAvailability' }); continue; }
    if (!VALID_AVAILABILITY.has(av.availability)) { skipped.invalidAvailability += 1; pushSample(samplesSkipped, { id: identifier, reason: 'invalidAvailability' }); continue; }

    const lowerTitle = title.toLowerCase();
    let productTypeDetected = detectProductType({ ...raw, ...row, title, name: title, category: row.category || raw.category || '' });
    if (/adhesive\s*tape\s*display/.test(lowerTitle)) productTypeDetected = 'Adhesivo para pantalla';
    if (/charging\s*board|charge\s*port|dock\s*connector/.test(lowerTitle)) productTypeDetected = 'Placa / pin de carga';
    if (/\bbattery\b/.test(lowerTitle)) productTypeDetected = 'Batería';
    const productType = mapProductTypeToFeed(productTypeDetected);
    if (!productType || productType.toLowerCase() === 'pantallas' && /resin\s*pc/i.test(title)) {
      skipped.taxonomyBlocked += 1;
      pushSample(samplesSkipped, { id: identifier, reason: 'taxonomyBlocked' });
      continue;
    }

    eligibleCount += 1;
    if (eligibleCount <= sanitizedOffset || emittedCount >= sanitizedLimit) continue;

    emittedCount += 1;
    productTypeBreakdown[productType] = (productTypeBreakdown[productType] || 0) + 1;
    availabilityBreakdown[av.availability] = (availabilityBreakdown[av.availability] || 0) + 1;
    pushSample(samplesEligible, { id: identifier, title, productType, availability: av.availability, availability_date: av.availabilityDate || null, price: `${priceNum.toFixed(2)} ARS`, link, image_link: imageLink });
  }

  return {
    totalCatalogProducts: rows.length,
    publicProductsCount,
    scannedRows: rows.length,
    eligibleCount,
    emittedCount,
    limit: sanitizedLimit,
    offset: sanitizedOffset,
    skipped,
    productTypeBreakdown,
    availabilityBreakdown,
    samplesEligible,
    samplesSkipped,
  };
}

module.exports = { GOOGLE_CATEGORY, mapProductTypeToFeed, buildMerchantTitle, computeAvailability, isEligibleState, cleanText, detectProductType, buildMerchantFeedAudit };
