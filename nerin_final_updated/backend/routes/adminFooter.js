const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/storage');

const FOOTER_FILE = path.join(DATA_DIR, 'footer.json');
const DEFAULT_FOOTER = {
  links: [
    { label: 'Inicio', href: '/' },
    { label: 'Productos', href: '/shop.html' },
    { label: 'Contacto', href: '/contact.html' },
    { label: 'Seguir mi pedido', href: '/seguimiento.html' },
  ],
  social: [
    { label: 'Instagram', href: 'https://instagram.com/nerinparts' },
    { label: 'LinkedIn', href: 'https://linkedin.com/company/nerinparts' },
  ],
  legal: '© 2025 NERIN PARTS — CUIT XX-XXXXXXXX-X — Exento/Convenio',
  contact: {
    phone: '+54 9 11 0000-0000',
    email: 'ventas@nerinparts.com.ar',
    location: 'CABA',
  },
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readFooter() {
  try {
    const txt = fs.readFileSync(FOOTER_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return { ...DEFAULT_FOOTER };
  }
}

function isValidUrl(href) {
  try {
    new URL(href, 'http://localhost');
    return true;
  } catch {
    return false;
  }
}

function sanitizeLinks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((l) => l && typeof l.label === 'string' && typeof l.href === 'string')
    .map((l) => ({
      label: l.label.trim().slice(0, 50),
      href: l.href.trim().slice(0, 300),
    }))
    .filter((l) => l.label && l.href && isValidUrl(l.href));
}

function normalize(body) {
  return {
    links: sanitizeLinks(body.links),
    social: sanitizeLinks(body.social),
    legal: typeof body.legal === 'string'
      ? body.legal.trim().slice(0, 500)
      : DEFAULT_FOOTER.legal,
    contact: {
      phone: typeof body?.contact?.phone === 'string'
        ? body.contact.phone.trim().slice(0, 50)
        : '',
      email: typeof body?.contact?.email === 'string'
        ? body.contact.email.trim().slice(0, 100)
        : '',
      location: typeof body?.contact?.location === 'string'
        ? body.contact.location.trim().slice(0, 100)
        : '',
    },
  };
}

function getFooter(_req, res) {
  const data = readFooter();
  sendJson(res, 200, data);
}

function postFooter(req, res) {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const data = normalize(JSON.parse(body || '{}'));
      await fs.promises.writeFile(
        FOOTER_FILE,
        JSON.stringify(data, null, 2),
        { mode: 0o640 }
      );
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 400, { error: 'Datos inválidos' });
    }
  });
}

module.exports = { getFooter, postFooter };
