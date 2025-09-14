const path = require('path');
const request = require('supertest');

process.env.DATA_DIR = path.join(__dirname, '..', '..', 'data');

const { createServer } = require('../server');
const productsData = require('../../data/products.json').products;

function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

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
    const canonical = `http://localhost:${process.env.PORT || 3000}/p/${slug}`;
    const nameEsc = esc(product.name);
    expect(res.text).toContain(`<title>${nameEsc}</title>`);
    expect(res.text).toContain('<meta name="description"');
    expect(res.text).toContain(`<link rel="canonical" href="${canonical}">`);
    expect(res.text).toContain(`<meta property="og:title" content="${nameEsc}">`);
    expect(res.text).toContain(`<meta property="og:description"`);
    expect(res.text).toContain(`<meta property="og:url" content="${canonical}">`);
    expect(res.text).toContain('<meta property="og:type" content="product">');
    if (product.image) {
      const abs = new URL(product.image, `http://localhost:${process.env.PORT || 3000}`).href;
      expect(res.text).toContain(`<meta property="og:image" content="${abs}">`);
    }
    expect(res.text).toContain('<script type="application/ld+json">');
    expect(res.text).toContain('"@type":"Product"');
    expect(res.text).toContain('"@type":"Offer"');
  });

  test('returns 404 for unknown product', async () => {
    const res = await request(server).get('/p/not-found');
    expect(res.status).toBe(404);
    expect(res.text).toContain('<meta name="robots" content="noindex">');
  });
});
