const fs = require('fs');
const path = require('path');
const request = require('supertest');

describe('SEO endpoints', () => {
  const tmpDir = path.join(__dirname, '__tmp_seo__');
  const originalDataDir = process.env.DATA_DIR;
  let server;
  let createServer;

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const writeJson = (file, data) => {
      fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data, null, 2), 'utf8');
    };
    writeJson('config.json', { publicUrl: 'https://nerinparts.example' });
    writeJson('products.json', {
      products: [
        {
          id: '1',
          slug: 'pantalla-iphone-12',
          visibility: 'public',
          vip_only: false,
          updated_at: '2024-01-10T00:00:00.000Z',
        },
      ],
    });
    writeJson('orders.json', { orders: [] });
    writeJson('order_items.json', { order_items: [] });
    writeJson('clients.json', { clients: [] });
    writeJson('returns.json', { returns: [] });
    writeJson('invoice_uploads.json', { uploads: [] });

    process.env.DATA_DIR = tmpDir;
    jest.resetModules();
    ({ createServer } = require('../../backend/server'));
    server = createServer();
  });

  afterAll((done) => {
    process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  test('robots.txt expone sitemap absoluto y reglas básicas', async () => {
    const res = await request(server).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('User-agent: *');
    expect(res.text).toContain('Sitemap: https://nerinparts.example/sitemap.xml');
    expect(res.text).toContain('Disallow: /admin');
  });

  test('sitemap.xml lista páginas principales y productos públicos', async () => {
    const res = await request(server).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<loc>https://nerinparts.example/</loc>');
    expect(res.text).toContain('<loc>https://nerinparts.example/shop.html</loc>');
    expect(res.text).toContain('<loc>https://nerinparts.example/p/pantalla-iphone-12</loc>');
  });
});
