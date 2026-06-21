const fs = require('fs');
const path = require('path');
const request = require('supertest');

describe('SEO endpoints', () => {
  const tmpDir = path.join(__dirname, '__tmp_seo__');
  const originalDataDir = process.env.DATA_DIR;
  let server;
  let createServer;

  beforeAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const writeJson = (file, data) => {
      fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data, null, 2), 'utf8');
    };
    writeJson('config.json', { publicUrl: 'https://nerinparts.example' });
    writeJson('products.json', {
      products: [
        {
          id: '1',
          title: 'Pantalla iPhone 12',
          slug: 'pantalla-iphone-12',
          public_slug: 'pantalla-iphone-12',
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

  afterAll(async () => {
    process.env.DATA_DIR = originalDataDir;
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    const productsSqliteRepo = require('../../backend/data/productsSqliteRepo');
    if (typeof productsSqliteRepo.closeProductsDbForTests === 'function') {
      await productsSqliteRepo.closeProductsDbForTests();
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
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

  test('sitemap.xml expone índice y sitemaps paginados sin mezclar URLs', async () => {
    const res = await request(server).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<sitemapindex');
    expect(res.text).toContain('<loc>https://nerinparts.example/sitemap-static.xml</loc>');
    expect(res.text).toContain('<loc>https://nerinparts.example/sitemap-products-1.xml</loc>');
    expect(res.text).not.toContain('<loc>https://nerinparts.example/p/pantalla-iphone-12</loc>');
  });

  test('sitemap-static.xml y sitemap-products paginado listan sus URLs', async () => {
    const staticRes = await request(server).get('/sitemap-static.xml');
    expect(staticRes.status).toBe(200);
    expect(staticRes.text).toContain('<loc>https://nerinparts.example/</loc>');
    expect(staticRes.text).toContain('<loc>https://nerinparts.example/shop.html</loc>');
    expect(staticRes.text).not.toContain('<loc>https://nerinparts.example/shop</loc>');

    const productsRes = await request(server).get('/sitemap-products-1.xml');
    expect(productsRes.status).toBe(200);
    expect(productsRes.text).toContain('<loc>https://nerinparts.example/p/pantalla-iphone-12</loc>');
  });
});
