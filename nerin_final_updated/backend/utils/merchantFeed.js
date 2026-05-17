const { detectProductType } = require('./productTaxonomy');

const GOOGLE_CATEGORY = 'Electrónica > Comunicaciones > Telefonía > Accesorios para móviles';
const VALID_AVAILABILITY = new Set(['in_stock', 'preorder']);

function safeMerchantText(value, max = 150) {
  const mojibakeFixes = [
    ['MÃ³dulo', 'Módulo'],
    ['BaterÃ­a', 'Batería'],
    ['CÃ¡mara', 'Cámara'],
    ['TelÃ©fono', 'Teléfono'],
    ['CÃ¡maras', 'Cámaras'],
    ['electrÃ³nicos', 'electrónicos'],
    ['ReparaciÃ³n', 'Reparación'],
  ];
  let text = String(value || '');
  for (const [bad, good] of mojibakeFixes) text = text.split(bad).join(good);
  text = text.replace(/:contentReference\[[^\]]*\]\{[^}]*\}/gi, ' ');
  text = text.replace(/:contentReference\[[^\]]*\]/gi, ' ');
  text = text.replace(/\boaicite\b/gi, ' ');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

function cleanText(value, max = 150) {
  return safeMerchantText(value, max);
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
  return safeMerchantText(row.name || row.title || raw.name || raw.title || raw.description || '');
}

function computeAvailability(row, raw, preorderDays = 30) {
  const stockLocal = Number(row.stock ?? raw.stock ?? 0);
  if (stockLocal > 0) return { availability: 'in_stock', availabilityDate: '' };
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

function normalizeMerchantImageUrl(value, baseUrl = 'https://nerinparts.com.ar') {
  const raw = String(value || '').trim();
  if (!raw) return { valid: false, reason: 'empty', normalized: '' };
  if (/^data:image/i.test(raw)) return { valid: false, reason: 'dataImage', normalized: '' };
  if (/^blob:/i.test(raw)) return { valid: false, reason: 'blobUrl', normalized: '' };
  if (/^javascript:/i.test(raw)) return { valid: false, reason: 'javascriptUrl', normalized: '' };
  if (/^base64[,;]/i.test(raw)) return { valid: false, reason: 'base64Placeholder', normalized: '' };

  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : `${String(baseUrl || 'https://nerinparts.com.ar').replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`;

  const attempts = [candidate, encodeURI(candidate)];
  for (const attempt of attempts) {
    try {
      const parsed = new URL(attempt);
      if (!/^https?:$/i.test(parsed.protocol)) continue;
      if (!parsed.hostname || !parsed.hostname.includes('.')) continue;
      return { valid: true, reason: null, normalized: parsed.toString() };
    } catch {
      // keep trying
    }
  }
  return { valid: false, reason: 'invalidUrl', normalized: attempts[1] || candidate };
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


function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').trim();
  }
}

function detectMerchantProductType(row, raw, title) {
  const lowerTitle = String(title || '').toLowerCase();
  let productTypeDetected = detectProductType({ ...raw, ...row, title, name: title, category: row.category || raw.category || '' });
  if (/display\s*(incl\.?|with|\+)\s*battery/.test(lowerTitle)) productTypeDetected = 'Pantalla / display';
  if (/adhesive\s*tape\s*display/.test(lowerTitle)) productTypeDetected = 'Adhesivo para pantalla';
  if (/charging\s*board|charge\s*port|dock\s*connector/.test(lowerTitle)) productTypeDetected = 'Placa / pin de carga';
  if (/\bbattery\b/.test(lowerTitle) && !/display\s*(incl\.?|with|\+)\s*battery/.test(lowerTitle)) productTypeDetected = 'Batería';
  return productTypeDetected;
}

function extractRaw(row) {
  let raw = {};
  try { raw = JSON.parse(row.raw_json || '{}'); } catch {}
  return raw;
}

function buildMerchantFeedEntries(rows, { limit = 500, offset = 0, preorderDays = 30, baseUrl = 'https://nerinparts.com.ar' } = {}) {
  const audit = buildMerchantFeedAudit(rows, { limit, offset, preorderDays, baseUrl });
  const entries = [];
  const sanitizedLimit = Math.max(1, Number(limit) || 500);
  const sanitizedOffset = Math.max(0, Number(offset) || 0);
  let eligibleCount = 0;
  for (const row of rows) {
    const raw = extractRaw(row);
    if (!isEligibleState(row, raw)) continue;
    const identifier = String(row.sku || row.id || row.mpn || row.part_number || raw.sku || raw.id || raw.mpn || raw.part_number || '').trim();
    if (!identifier) continue;
    const title = safeMerchantText(buildMerchantTitle(row, raw));
    if (!title) continue;
    const description = safeMerchantText(row.description || raw.description || `${title} disponible en NERIN Parts.`, 5000);
    if (!description) continue;
    const slug = String(row.public_slug || row.slug || raw.public_slug || raw.slug || '').trim();
    const link = slug ? `${baseUrl}/p/${encodeURIComponent(slug)}` : '';
    if (!link || !isValidFeedUrl(link)) continue;
    const imageCandidates = [row.image,row.image_url,raw.image,raw.image_url,...(Array.isArray(raw.images) ? raw.images : [])].filter(Boolean);
    if (!imageCandidates.length) continue;
    const primary = normalizeMerchantImageUrl(String(imageCandidates[0]), baseUrl);
    if (!primary.valid) continue;
    const image_link = primary.normalized;
    const additional = [];
    const seenImages = new Set([normalizeComparableUrl(image_link)]);
    for (const img of imageCandidates.slice(1)) {
      const n = normalizeMerchantImageUrl(String(img), baseUrl);
      if (!n.valid) continue;
      const key = normalizeComparableUrl(n.normalized);
      if (seenImages.has(key)) continue;
      seenImages.add(key);
      additional.push(n.normalized);
      if (additional.length >= 10) break;
    }
    const priceNum = Number(row.precio_final ?? row.price_minorista ?? row.precio_minorista ?? row.price ?? raw.precio_final ?? raw.price_minorista ?? raw.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
    const av = computeAvailability(row, raw, preorderDays);
    if (!VALID_AVAILABILITY.has(av.availability)) continue;
    if (av.availability === 'preorder' && !String(av.availabilityDate || '').match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    const productTypeDetected = detectMerchantProductType(row, raw, title);
    const product_type = safeMerchantText(mapProductTypeToFeed(productTypeDetected));
    if (!product_type) continue;
    eligibleCount += 1;
    if (eligibleCount <= sanitizedOffset || entries.length >= sanitizedLimit) continue;
    const brand = safeMerchantText(String(row.brand || raw.brand || '').trim(), 70);
    const mpn = safeMerchantText(String(row.mpn || row.part_number || row.sku || raw.mpn || raw.part_number || raw.sku || '').trim(), 70);
    const identifier_exists = (brand && mpn) ? 'yes' : 'no';
    entries.push({
      id: identifier, title, description, link, image_link,
      additional_image_link: additional.join(','), availability: av.availability,
      availability_date: av.availability === 'preorder' ? av.availabilityDate : '',
      price: `${priceNum.toFixed(2)} ARS`, condition: 'new', brand, mpn, identifier_exists,
      google_product_category: GOOGLE_CATEGORY, product_type,
    });
  }
  return { entries, audit };
}

function buildMerchantFeedAudit(rows, { limit = 500, offset = 0, preorderDays = 30, baseUrl = 'https://nerinparts.com.ar', totalCatalogProducts = null, publicProductsCount = null } = {}) {
  const skipped = getSkipTemplate();
  const samplesEligible = [];
  const samplesSkipped = [];
  const productTypeBreakdown = {};
  const availabilityBreakdown = {};
  const sanitizedLimit = Math.max(1, Number(limit) || 500);
  const sanitizedOffset = Math.max(0, Number(offset) || 0);

  let publicProductsInScan = 0;
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
    publicProductsInScan += 1;

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

    const description = safeMerchantText(row.description || raw.description || `${title} disponible en NERIN Parts.`, 5000);
    if (!description) { skipped.missingDescription += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingDescription' }); continue; }

    const slug = String(row.public_slug || row.slug || raw.public_slug || raw.slug || '').trim();
    const link = slug ? `${baseUrl}/p/${encodeURIComponent(slug)}` : '';
    if (!link) { skipped.missingLink += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingLink' }); continue; }

    const imageCandidates = [
      row.image,
      row.image_url,
      raw.image,
      raw.image_url,
      ...(Array.isArray(raw.images) ? raw.images : []),
    ].filter(Boolean);
    if (!imageCandidates.length) { skipped.missingImage += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingImage' }); continue; }
    const rawImage = String(imageCandidates[0]);
    const normalizedImage = normalizeMerchantImageUrl(rawImage, baseUrl);
    if (!normalizedImage.valid) {
      skipped.invalidImageUrl += 1;
      pushSample(samplesSkipped, {
        id: row.id || identifier,
        sku: row.sku || raw.sku || null,
        title,
        rawImage,
        normalizedImageAttempt: normalizedImage.normalized,
        reason: `invalidImageUrl:${normalizedImage.reason}`,
      });
      continue;
    }
    const imageLink = normalizedImage.normalized;

    const priceNum = Number(row.precio_final ?? row.price_minorista ?? row.precio_minorista ?? row.price ?? raw.precio_final ?? raw.price_minorista ?? raw.price);
    if ((row.price == null && raw.price == null && row.precio_final == null && raw.precio_final == null)) { skipped.missingPrice += 1; pushSample(samplesSkipped, { id: identifier, reason: 'missingPrice' }); continue; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { skipped.invalidPrice += 1; pushSample(samplesSkipped, { id: identifier, reason: 'invalidPrice' }); continue; }

    const av = computeAvailability(row, raw, preorderDays);
    if (!av.availability) { skipped.missingAvailability += 1; pushSample(samplesSkipped, {
      id: identifier,
      title,
      stock: Number(row.stock ?? raw.stock ?? 0),
      status: row.status ?? raw.status ?? null,
      visibility: row.visibility ?? raw.visibility ?? null,
      enabled: row.enabled ?? raw.enabled ?? null,
      stock_mode: raw.stock_mode ?? null,
      fulfillment_mode: raw.fulfillment_mode ?? null,
      rawAvailabilitySignals: {
        remote_stock: raw.remote_stock ?? raw.stock_remote ?? raw.available_remote ?? null,
        sellable_on_demand: raw.sellable_on_demand ?? null,
        allow_backorder: raw.allow_backorder ?? null,
        availability: raw.availability ?? null,
      },
      reason: 'missingAvailability',
    }); continue; }
    if (!VALID_AVAILABILITY.has(av.availability)) { skipped.invalidAvailability += 1; pushSample(samplesSkipped, { id: identifier, reason: 'invalidAvailability' }); continue; }

    const productTypeDetected = detectMerchantProductType(row, raw, title);
    const productType = mapProductTypeToFeed(productTypeDetected);
    if (!productType || productType.toLowerCase() === 'pantallas' && /resin\s*pc/i.test(title)) {
      skipped.taxonomyBlocked += 1;
      pushSample(samplesSkipped, { id: identifier, reason: 'taxonomyBlocked' });
      continue;
    }

    eligibleCount += 1;
    if (eligibleCount <= sanitizedOffset || emittedCount >= sanitizedLimit) continue;

    emittedCount += 1;
    const safeProductType = safeMerchantText(productType);
    productTypeBreakdown[safeProductType] = (productTypeBreakdown[safeProductType] || 0) + 1;
    availabilityBreakdown[av.availability] = (availabilityBreakdown[av.availability] || 0) + 1;
    pushSample(samplesEligible, { id: identifier, title: safeMerchantText(title), productType: safeProductType, availability: av.availability, availability_date: av.availabilityDate || null, price: `${priceNum.toFixed(2)} ARS`, link, image_link: imageLink, stock: Number(row.stock ?? raw.stock ?? 0) });
  }

  return {
    totalCatalogProducts: Number.isFinite(Number(totalCatalogProducts)) ? Number(totalCatalogProducts) : rows.length,
    publicProductsCount: Number.isFinite(Number(publicProductsCount)) ? Number(publicProductsCount) : publicProductsInScan,
    scannedRows: rows.length,
    eligibleCount,
    emittedCount,
    limit: sanitizedLimit,
    offset: sanitizedOffset,
    skipped,
    productTypeBreakdown,
    availabilityBreakdown,
    samplesEligible,
    samplesSkipped: samplesSkipped.map((sample) => ({
      ...sample,
      title: sample.title ? safeMerchantText(sample.title) : sample.title,
      reason: sample.reason ? safeMerchantText(sample.reason) : sample.reason,
    })),
  };
}

module.exports = { GOOGLE_CATEGORY, mapProductTypeToFeed, buildMerchantTitle, computeAvailability, isEligibleState, cleanText, safeMerchantText, detectProductType, buildMerchantFeedAudit, buildMerchantFeedEntries, normalizeMerchantImageUrl, isValidFeedUrl };
