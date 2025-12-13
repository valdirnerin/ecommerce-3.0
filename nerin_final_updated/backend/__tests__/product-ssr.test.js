const path = require('path');
const request = require('supertest');

process.env.DATA_DIR = path.join(__dirname, '..', '..', 'data');

const { createServer } = require('../server');
const productsData = require('../../data/products.json').products;
const seoConfig = require('../../data/config.json');

function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const normalized = new URL(value.trim());
    normalized.hash = '';
    return normalized.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function expectedSiteBase() {
  return (
    normalizeBaseUrl(seoConfig.publicUrl) ||
    normalizeBaseUrl(process.env.PUBLIC_URL) ||
    `http://localhost:${process.env.PORT || 3000}`
  );
}

function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function extractTagContent(html, tagName) {
  const matches = Array.from(
    html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi')),
  );
  if (!matches.length) return null;
  const content = matches
    .map((m) => (m[1] || '').trim())
    .filter(Boolean)
    .pop();
  return content || (matches[0][1] || '').trim();
}

function extractTagContents(html, tagName) {
  return Array.from(
    html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi')),
  ).map((m) => (m[1] || '').trim());
}

function extractMetaContent(html, attrName, attrValue) {
  const metaRegex = new RegExp(
    `<meta[^>]*${attrName}=["']${attrValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i',
  );
  const match = html.match(metaRegex);
  return match ? match[1].trim() : null;
}

describe('product SSR', () => {
  let server;
  beforeAll(() => {
    server = createServer();
  });
  afterAll((done) => {
    if (server.listening) server.close(done);
    else done();
  });

  test('renders SEO data for existing product', async () => {
    const product = productsData[0];
    const slug = product.slug;
    const res = await request(server).get(`/p/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const canonical = `${expectedSiteBase()}/p/${slug}`;
    const normalizedName = normalizeWhitespace((product.name || '').replace(/\u00a0/g, ' '));
    const titles = extractTagContents(res.text, 'title').filter(Boolean);
    expect(titles.length).toBe(1);
    const titleContent = titles[0];
    expect(titleContent.trim()).not.toHaveLength(0);
    const titleLower = normalizeWhitespace(titleContent).toLowerCase();
    const modelLower = normalizeWhitespace(product.model || '').toLowerCase();
    expect(titleLower).toContain('nerin');
    const mentionsProduct =
      titleLower.includes(normalizedName.toLowerCase()) ||
      (modelLower && titleLower.includes(modelLower)) ||
      titleLower.includes((product.sku || '').toLowerCase());
    expect(mentionsProduct).toBe(true);

    const descriptionMeta = extractMetaContent(res.text, 'name', 'description');
    expect(descriptionMeta).toBeTruthy();
    expect(res.text).toContain(`<link rel="canonical" href="${canonical}">`);

    const ogTitle = extractMetaContent(res.text, 'property', 'og:title');
    expect(ogTitle).toBeTruthy();
    const ogTitleLower = normalizeWhitespace(ogTitle).toLowerCase();
    expect(ogTitleLower).toContain('nerin');
    const ogMentionsProduct =
      ogTitleLower.includes(normalizedName.toLowerCase()) ||
      (modelLower && ogTitleLower.includes(modelLower)) ||
      ogTitleLower.includes((product.sku || '').toLowerCase());
    expect(ogMentionsProduct).toBe(true);

    expect(res.text).toContain(`<meta property="og:description"`);
    expect(res.text).toContain(`<meta property="og:url" content="${canonical}">`);
    expect(res.text).toMatch(
      /<meta property="og:type" content="product"\s*\/?>(?:\s|<)/,
    );
    const base = expectedSiteBase();
    const expectedImages = Array.isArray(product.images)
      ? product.images.filter(Boolean)
      : product.image
        ? [product.image]
        : [];
    expectedImages.forEach((img) => {
      const abs = new URL(img, base).href;
      expect(res.text).toContain(`<meta property="og:image" content="${abs}">`);
    });
    expect(res.text).toContain('id="product-jsonld"');
    expect(res.text).toContain('id="product-breadcrumbs"');
    expect(res.text).toContain('"@type":"Product"');
    expect(res.text).toContain('"@type":"Offer"');
  });

  test('returns 404 for unknown product', async () => {
    const res = await request(server).get('/p/not-found');
    expect(res.status).toBe(404);
    expect(res.text).toContain('<meta name="robots" content="noindex">');
  });
});

describe('data dir autodetection for SSR', () => {
  let orig; beforeAll(() => { orig = process.env.DATA_DIR; delete process.env.DATA_DIR; jest.resetModules(); });
  afterAll(() => { process.env.DATA_DIR = orig; });

  test('uses utils/dataDir when DATA_DIR is not set', async () => {
    const fs = require('fs'); const path = require('path'); const request = require('supertest');
    const tmp = path.join(__dirname, '__tmp__'); fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'products.json'), JSON.stringify({ products: [{ slug: 'tmp', name:'Tmp', price: 1, stock:1 }] }), 'utf8');

    let createServer;
    jest.isolateModules(() => {
      jest.doMock('../utils/dataDir.js', () => ({ DATA_DIR: tmp, dataPath: (p) => path.join(tmp, p) }), { virtual: true });
      ({ createServer } = require('../server'));
    });
    const server = createServer();
    const res = await request(server).get('/p/tmp');
    expect(res.status).toBe(200);
    if (server.close) server.close();
  });
});

test('malformed percent-encoding in slug does not crash', async () => {
  const request = require('supertest');
  const { createServer } = require('../server');
  const server = createServer();
  const res = await request(server).get('/p/%E0'); // inválido
  expect([400, 404]).toContain(res.status);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  if (res.status === 400) {
    expect(res.text).toContain('noindex'); // meta para que no indexe
  }
  if (server.close) server.close();
});

test('JSON-LD is safely escaped inside <script>', async () => {
  const fs = require('fs');
  const path = require('path');
  const request = require('supertest');

  // Preparar data con caracteres peligrosos
  const tmp = path.join(__dirname, '__tmp_jsonld__');
  fs.mkdirSync(tmp, { recursive: true });
  const prod = {
    products: [{
      slug: 'xss-jsonld',
      name: 'Name </script><script>alert(1)</script>',
      description: 'Desc & <img onerror=alert(2)>',
      price: 10, stock: 1
    }]
  };
  fs.writeFileSync(path.join(tmp, 'products.json'), JSON.stringify(prod), 'utf8');

  // Forzar a leer desde este directorio
  const orig = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  jest.resetModules();
  let createServer;
  jest.isolateModules(() => {
    jest.doMock('../utils/dataDir.js', () => ({
      DATA_DIR: tmp,
      dataPath: (p) => path.join(tmp, p),
    }), { virtual: true });
    ({ createServer } = require('../server'));
  });
  const server = createServer();
  const res = await request(server).get('/p/xss-jsonld');

  expect(res.status).toBe(200);
  // Debe contener el bloque de JSON-LD…
  // …y el contenido debe venir escapado (sin '<' literales dentro del script)
  const marker = '<script type="application/ld+json" id="product-jsonld">';
  expect(res.text).toContain(marker);
  const scriptStart = res.text.indexOf(marker) + marker.length;
  const scriptEnd = res.text.indexOf('</script>', scriptStart);
  const jsonInScript = res.text.slice(scriptStart, scriptEnd);
  expect(jsonInScript).toContain('\\u003c');   // '<' escapado
  expect(jsonInScript).toContain('\\u003e');   // '>' escapado
  expect(jsonInScript).not.toContain('</script>');

  if (server.close) server.close();
  process.env.DATA_DIR = orig;
});

test('frontend JS assets served when requested with leading slash', async () => {
  const request = require('supertest');
  const { createServer } = require('../server');
  const server = createServer();
  const res = await request(server).get('/js/product.js');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/javascript/);
  expect(res.text).toContain('renderProduct');
  if (server.close) server.close();
});
