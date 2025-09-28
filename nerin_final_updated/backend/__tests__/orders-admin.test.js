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

jest.mock('../services/emailNotifications', () => ({
  sendEmail: jest.fn(),
  sendOrderPreparing: jest.fn().mockResolvedValue(undefined),
}));

describe('Orders admin endpoints', () => {
  let server;
  let tmpDir;
  let previousDataDir;
  let previousToken;
  let emailNotifications;

  beforeEach(() => {
    jest.resetModules();
    emailNotifications = require('../services/emailNotifications');
    jest.clearAllMocks();
    previousDataDir = process.env.DATA_DIR;
    previousToken = process.env.MP_ACCESS_TOKEN;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerin-orders-admin-'));

    const now = new Date().toISOString();
    const baseOrder = {
      id: 'ORDER-123',
      order_number: 'ORDER-123',
      external_reference: 'ORDER-123',
      payment_status: 'pendiente',
      estado_pago: 'pendiente',
      payment_status_code: 'pending',
      shipping_status: 'Pendiente',
      estado_envio: 'Pendiente',
      shipping_status_code: 'received',
      cliente: { email: 'cliente@example.com' },
      productos: [
        { id: 'SKU-1', name: 'Producto demo', quantity: 1, price: 1000 },
      ],
      items_summary: 'Producto demo x1',
      total: 1000,
      created_at: now,
      fecha: now,
    };

    fs.writeFileSync(
      path.join(tmpDir, 'orders.json'),
      JSON.stringify({ orders: [baseOrder] }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'products.json'),
      JSON.stringify({ products: [] }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'order_items.json'),
      JSON.stringify({ order_items: [] }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'clients.json'),
      JSON.stringify({ clients: [] }, null, 2),
      'utf8',
    );

    process.env.DATA_DIR = tmpDir;
    process.env.MP_ACCESS_TOKEN = 'test-token';

    // eslint-disable-next-line global-require
    const { createServer } = require('../server');
    server = createServer();
  });

  afterEach(() => {
    if (server && server.close) server.close();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = previousToken;
    jest.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('PATCH /api/orders/:id actualiza el estado de envío', async () => {
    const res = await request(server)
      .patch('/api/orders/ORDER-123')
      .send({ shipping_status: 'enviado' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('order');
    expect(res.body.order.shipping_status_code).toBe('shipped');
    expect(res.body.order.estado_envio).toBe('Enviado');
  });

  test('PATCH /api/orders/:id envía email cuando pasa a preparación', async () => {
    const res = await request(server)
      .patch('/api/orders/ORDER-123')
      .send({ shipping_status: 'preparing' });

    expect(res.status).toBe(200);
    expect(emailNotifications.sendOrderPreparing).toHaveBeenCalledTimes(1);
    expect(emailNotifications.sendOrderPreparing).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'cliente@example.com',
        order: expect.objectContaining({
          shipping_status: 'preparing',
        }),
      }),
    );
  });

  test('POST /api/orders/:id/invoices guarda y lista facturas', async () => {
    const dummyPdfPath = path.join(tmpDir, 'factura.pdf');
    fs.writeFileSync(
      dummyPdfPath,
      '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
      'utf8',
    );

    const uploadRes = await request(server)
      .post('/api/orders/ORDER-123/invoices')
      .attach('file', dummyPdfPath);

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body).toHaveProperty('invoice');
    expect(uploadRes.body.invoice.filename).toMatch(/^ORDER-123-/);
    expect(uploadRes.body.invoice.url).toContain('/files/invoices/');

    const listRes = await request(server).get(
      '/api/orders/ORDER-123/invoices',
    );

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.invoices)).toBe(true);
    expect(listRes.body.invoices.length).toBeGreaterThan(0);
    const active = listRes.body.invoices.find((inv) => !inv.deleted_at);
    expect(active).toBeDefined();
    expect(active.url).toContain('/files/invoices/');
  });
});
