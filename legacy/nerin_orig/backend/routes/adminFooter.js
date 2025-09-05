const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/storage');

const FOOTER_FILE = path.join(DATA_DIR, 'footer.json');
const VERSION = 1;

const DEFAULT = {
  version: VERSION,
  identity: {
    brand_name: 'NERIN PARTS',
    logo_variant: 'light',
    tagline: '',
  },
  navigation: [[], [], []],
  contact: {
    whatsapp_number: '',
    email: '',
    address: '',
    opening_hours: '',
  },
  cta: {
    enabled: false,
    prompt: '',
    button_text: '',
    cta_link: '',
  },
  legal: {
    company_name: '',
    cuit: '',
    terms: '',
    privacy: '',
  },
  appearance: {
    theme: 'light',
    accent: '',
  },
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function isValidUrl(u) {
  try {
    new URL(u, 'http://localhost');
    return true;
  } catch {
    return false;
  }
}

const phoneRe = /^\+[1-9]\d{1,14}$/;

function sanitizeLinks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((l) => l && typeof l.text === 'string' && typeof l.url === 'string')
    .map((l) => ({
      text: l.text.trim().slice(0, 50),
      url: l.url.trim().slice(0, 300),
    }))
    .filter((l) => l.text && l.url && isValidUrl(l.url));
}

function normalize(body) {
  const nav = Array.isArray(body.navigation) ? body.navigation.slice(0, 3) : [];
  while (nav.length < 3) nav.push([]);
  return {
    version: VERSION,
    identity: {
      brand_name: String(body?.identity?.brand_name || DEFAULT.identity.brand_name).trim(),
      logo_variant: ['light', 'dark'].includes(body?.identity?.logo_variant)
        ? body.identity.logo_variant
        : 'light',
      tagline: String(body?.identity?.tagline || '').trim(),
    },
    navigation: nav.map((col) => sanitizeLinks(col)),
    contact: {
      whatsapp_number: phoneRe.test(body?.contact?.whatsapp_number || '')
        ? body.contact.whatsapp_number
        : '',
      email: String(body?.contact?.email || '').trim(),
      address: String(body?.contact?.address || '').trim(),
      opening_hours: String(body?.contact?.opening_hours || '').trim(),
    },
    cta: {
      enabled: !!body?.cta?.enabled,
      prompt: String(body?.cta?.prompt || '').trim(),
      button_text: String(body?.cta?.button_text || '').trim(),
      cta_link: isValidUrl(body?.cta?.cta_link || '')
        ? body.cta.cta_link.trim()
        : '',
    },
    legal: {
      company_name: String(body?.legal?.company_name || '').trim(),
      cuit: String(body?.legal?.cuit || '').trim(),
      terms: isValidUrl(body?.legal?.terms || '') ? body.legal.terms.trim() : '',
      privacy: isValidUrl(body?.legal?.privacy || '') ? body.legal.privacy.trim() : '',
    },
    appearance: {
      theme: ['light', 'dark'].includes(body?.appearance?.theme)
        ? body.appearance.theme
        : 'light',
      accent: String(body?.appearance?.accent || '').trim(),
    },
  };
}

function migrateLegacy(obj) {
  if (obj.version === VERSION) return obj;
  const migrated = JSON.parse(JSON.stringify(DEFAULT));
  if (obj.brand) migrated.identity.brand_name = obj.brand;
  if (obj.slogan) migrated.identity.tagline = obj.slogan;

  if (Array.isArray(obj.columns)) {
    migrated.navigation = obj.columns.map((c) =>
      sanitizeLinks((c.links || []).map((l) => ({ text: l.label || l.text, url: l.href || l.url })))
    );
    while (migrated.navigation.length < 3) migrated.navigation.push([]);
  } else if (Array.isArray(obj.links)) {
    migrated.navigation[0] = sanitizeLinks(
      obj.links.map((l) => ({ text: l.label || l.text, url: l.href || l.url }))
    );
  }

  if (obj.contact) {
    migrated.contact.whatsapp_number = obj.contact.whatsapp || obj.contact.phone || '';
    migrated.contact.email = obj.contact.email || '';
    migrated.contact.address = obj.contact.address || obj.contact.location || '';
  }

  if (obj.cta) {
    migrated.cta.enabled = obj.cta.enabled || false;
    migrated.cta.prompt = obj.cta.text || obj.cta.prompt || '';
    migrated.cta.button_text = obj.cta.buttonLabel || obj.cta.button_text || '';
    migrated.cta.cta_link = obj.cta.href || obj.cta.cta_link || '';
  }

  if (obj.legal) {
    if (typeof obj.legal === 'string') {
      migrated.legal.company_name = migrated.identity.brand_name;
    } else {
      migrated.legal.company_name = obj.legal.company_name || '';
      migrated.legal.cuit = obj.legal.cuit || '';
      migrated.legal.terms = obj.legal.terms || '';
      migrated.legal.privacy = obj.legal.privacy || '';
    }
  }

  if (obj.theme) {
    migrated.appearance.theme = obj.theme.mode || 'light';
    migrated.appearance.accent = obj.theme.accentFrom || obj.theme.accent || '';
  }

  migrated.version = VERSION;
  console.log('Migrated footer config to v1');
  try {
    fs.writeFileSync(FOOTER_FILE, JSON.stringify(migrated, null, 2), {
      mode: 0o640,
    });
  } catch (e) {
    console.error('Failed to write migrated footer config', e);
  }
  return migrated;
}

function readFooter() {
  try {
    const raw = fs.readFileSync(FOOTER_FILE, 'utf8');
    const data = JSON.parse(raw);
    return migrateLegacy(data);
  } catch {
    return { ...DEFAULT };
  }
}

async function writeFooter(data) {
  await fs.promises.writeFile(FOOTER_FILE, JSON.stringify(data, null, 2), {
    mode: 0o640,
  });
}

function getFooter(_req, res) {
  const data = readFooter();
  sendJson(res, 200, data);
}

function postFooter(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const data = normalize(JSON.parse(body || '{}'));
      await writeFooter(data);
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 400, { error: 'Datos inválidos' });
    }
  });
}

module.exports = { getFooter, postFooter };

