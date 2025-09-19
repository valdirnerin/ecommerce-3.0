const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn(),
  Preference: jest.fn().mockImplementation(() => ({})),
  Payment: jest.fn().mockImplementation(() => ({ get: jest.fn() })),
}));

jest.mock('../db', () => ({
  getPool: () => null,
  init: jest.fn().mockResolvedValue(undefined),
}));

describe('Orders API payment status localization', () => {
  let server;
  let tmpDir;
  let previousDataDir;
  let previousAccessToken;

  beforeEach(() => {
    jest.resetModules();
    previousDataDir = process.env.DATA_DIR;
    previousAccessToken = process.env.MP_ACCESS_TOKEN;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerin-orders-'));
    const now = new Date().toISOString();
    const ordersPayload = {
      orders: [
        {
          id: 'ORDER-1',
          order_number: 'ORDER-1',
          external_reference: 'ORDER-1',
          payment_status: 'paid',
          estado_pago: 'paid',
          payment_status_code: 'paid',
          total: 100,
          productos: [
            { id: 'SKU-1', name: 'Display', quantity: 1, price: 100 },
          ],
          items_summary: 'Display x1',
          created_at: now,
          fecha: now,
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'orders.json'),
      JSON.stringify(ordersPayload, null, 2)
    );
    fs.writeFileSync(
      path.join(tmpDir, 'products.json'),
      JSON.stringify({ products: [] }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmpDir, 'order_items.json'),
      JSON.stringify({ order_items: [] }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmpDir, 'clients.json'),
      JSON.stringify({ clients: [] }, null, 2)
    );
    process.env.DATA_DIR = tmpDir;
    process.env.MP_ACCESS_TOKEN = 'test-token';
    // Re-require server with fresh environment/mocks
    // eslint-disable-next-line global-require
    const { createServer } = require('../server');
    server = createServer();
  });

  afterEach(() => {
    if (server && server.close) server.close();
    process.env.DATA_DIR = previousDataDir;
    if (previousAccessToken === undefined) {
      delete process.env.MP_ACCESS_TOKEN;
    } else {
      process.env.MP_ACCESS_TOKEN = previousAccessToken;
    }
    jest.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /api/orders returns spanish payment_status and normalized code', async () => {
    const res = await request(server).get('/api/orders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    const order = res.body.items[0];
    expect(order.payment_status).toBe('pagado');
    expect(order.payment_status_code).toBe('approved');
    expect(res.body.summary).toMatchObject({ total: 1, paid: 1 });
  });

  test('GET /api/orders/:id normalizes legacy "paid" values', async () => {
    const res = await request(server).get('/api/orders/ORDER-1');
    expect(res.status).toBe(200);
    expect(res.body.order.payment_status).toBe('pagado');
    expect(res.body.order.payment_status_code).toBe('approved');
  });
});
