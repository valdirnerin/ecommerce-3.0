jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn(),
  Preference: jest.fn().mockImplementation(() => ({})),
  Payment: jest.fn().mockImplementation(() => ({ get: jest.fn() })),
}));

const request = require('supertest');
jest.mock('../db', () => ({
  getPool: () => null,
  init: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../data/ordersRepo', () => ({
  upsertByPayment: jest.fn(),
  findByPaymentIdentifiers: jest.fn(),
  getNormalizedItems: jest.fn(),
}));

jest.mock('../services/inventory', () => ({
  applyInventoryForOrder: jest.fn().mockResolvedValue(undefined),
  revertInventoryForOrder: jest.fn().mockResolvedValue(undefined),
}));

process.env.MP_ACCESS_TOKEN = 'test-token';

global.fetch = jest.fn();

const ordersRepo = require('../data/ordersRepo');
const { createServer } = require('../server');
const { processNotification } = require('../routes/mercadoPago');
const inventory = require('../services/inventory');

describe('Mercado Pago webhook', () => {
  beforeEach(() => {
    const order = {
      id: 'ORDER-1',
      items: [{ id: 'SKU', qty: 1, price: 1000 }],
      totals: { grand_total: 1000 },
      payment_status_code: 'pending',
      status: 'pending',
      inventoryApplied: false,
      inventory_applied: false,
    };
    ordersRepo.findByPaymentIdentifiers.mockResolvedValue(order);
    ordersRepo.getNormalizedItems.mockReturnValue(order.items);
    ordersRepo.upsertByPayment.mockResolvedValue({
      ...order,
      payment_status_code: 'approved',
      payment_status: 'pagado',
      status: 'paid',
      inventoryApplied: true,
      inventory_applied: true,
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        status: 'approved',
        transaction_amount: 1000,
        currency_id: 'ARS',
        external_reference: 'ORDER-1',
        preference_id: 'PREF-1',
        metadata: {},
      }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('processes query-only webhook (POST ?topic=payment&id=...)', async () => {
    const server = createServer();
    const res = await request(server).post(
      '/api/mercado-pago/webhook?topic=payment&id=123'
    );
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ordersRepo.upsertByPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: '123',
        patch: expect.objectContaining({
          payment_status_code: 'approved',
          payment_status: 'pagado',
          estado_pago: 'pagado',
        }),
      })
    );
    expect(inventory.applyInventoryForOrder).toHaveBeenCalled();
    if (server.close) server.close();
  });

  test('supports GET ?topic=payment&resource=/payments/123', async () => {
    const server = createServer();
    const res = await request(server).get(
      '/api/mercado-pago/webhook?topic=payment&resource=/payments/123'
    );
    expect(res.status).toBe(200);
    if (server.close) server.close();
  });

  test('POST body.resource=/payments/:id se procesa', async () => {
    const server = createServer();
    const res = await request(server)
      .post('/api/mercado-pago/webhook')
      .send({ resource: '/payments/123' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ordersRepo.upsertByPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: '123',
        patch: expect.objectContaining({
          payment_status_code: 'approved',
          payment_status: 'pagado',
          estado_pago: 'pagado',
        }),
      })
    );
    expect(inventory.applyInventoryForOrder).toHaveBeenCalled();

    if (server.close) server.close();
  });

  test('payment approved transitioning to refunded reverts inventory once', async () => {
    ordersRepo.findByPaymentIdentifiers.mockResolvedValue({
      id: 'ORDER-1',
      items: [{ id: 'SKU', qty: 1, price: 1000 }],
      totals: { grand_total: 1000 },
      currency: 'ARS',
      payment_status_code: 'approved',
      status: 'paid',
      inventoryApplied: true,
      inventory_applied: true,
      paid_at: '2023-01-01T00:00:00.000Z',
      paid_amount: 1000,
      paid_currency: 'ARS',
    });
    ordersRepo.getNormalizedItems.mockReturnValue([
      { id: 'SKU', qty: 1, price: 1000 },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        status: 'refunded',
        transaction_amount: 1000,
        currency_id: 'ARS',
        external_reference: 'ORDER-1',
        preference_id: 'PREF-1',
        metadata: {},
      }),
    });
    await expect(
      processNotification({
        body: { type: 'payment', action: 'payment.updated', data: { id: '123' } },
        query: {},
      })
    ).resolves.toBe('ok');

    expect(inventory.revertInventoryForOrder).toHaveBeenCalledTimes(1);
    expect(inventory.applyInventoryForOrder).not.toHaveBeenCalled();
    expect(ordersRepo.upsertByPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: '123',
        patch: expect.objectContaining({
          payment_status_code: 'refunded',
          payment_status: 'rechazado',
          estado_pago: 'rechazado',
          status: 'canceled',
          inventoryApplied: false,
          inventory_applied: false,
          inventory_applied_at: null,
        }),
      })
    );
  });

  test('payment approved transitioning to charged_back reverts inventory once', async () => {
    ordersRepo.findByPaymentIdentifiers.mockResolvedValue({
      id: 'ORDER-1',
      items: [{ id: 'SKU', qty: 1, price: 1000 }],
      totals: { grand_total: 1000 },
      currency: 'ARS',
      payment_status_code: 'approved',
      status: 'paid',
      inventoryApplied: true,
      inventory_applied: true,
      paid_at: '2023-01-01T00:00:00.000Z',
      paid_amount: 1000,
      paid_currency: 'ARS',
    });
    ordersRepo.getNormalizedItems.mockReturnValue([
      { id: 'SKU', qty: 1, price: 1000 },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        status: 'charged_back',
        transaction_amount: 1000,
        currency_id: 'ARS',
        external_reference: 'ORDER-1',
        preference_id: 'PREF-1',
        metadata: {},
      }),
    });
    await expect(
      processNotification({
        body: { type: 'payment', action: 'payment.updated', data: { id: '123' } },
        query: {},
      })
    ).resolves.toBe('ok');

    expect(inventory.revertInventoryForOrder).toHaveBeenCalledTimes(1);
    expect(inventory.applyInventoryForOrder).not.toHaveBeenCalled();
    expect(ordersRepo.upsertByPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: '123',
        patch: expect.objectContaining({
          payment_status_code: 'charged_back',
          payment_status: 'rechazado',
          estado_pago: 'rechazado',
          status: 'canceled',
          inventoryApplied: false,
          inventory_applied: false,
          inventory_applied_at: null,
        }),
      })
    );
  });

  test('refund revierte stock si la orden previa está "pagado" (ES) sin code', async () => {
    ordersRepo.findByPaymentIdentifiers.mockResolvedValue({
      id: 'ORDER-ES-1',
      productos: [{ titulo: 'Filtro', cantidad: 1, precio: 100 }],
      totals: { grand_total: 100 },
      payment_status: 'pagado',
      status: 'paid',
      inventoryApplied: true,
      inventory_applied: true,
    });
    const normalizedItems = [{ id: 'FILTRO', qty: 1, price: 100 }];
    ordersRepo.getNormalizedItems.mockReturnValue(normalizedItems);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        status: 'refunded',
        transaction_amount: 100,
        currency_id: 'ARS',
        external_reference: 'ORDER-ES-1',
        preference_id: 'PREF-1',
        metadata: {},
      }),
    });

    await expect(
      processNotification({
        body: { type: 'payment', action: 'payment.updated', data: { id: '123' } },
        query: {},
      })
    ).resolves.toBe('ok');

    expect(inventory.revertInventoryForOrder).toHaveBeenCalledTimes(1);
    expect(ordersRepo.upsertByPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: '123',
        patch: expect.objectContaining({
          payment_status_code: 'refunded',
          payment_status: 'rechazado',
          estado_pago: 'rechazado',
          inventoryApplied: false,
          inventory_applied: false,
          inventory_applied_at: null,
        }),
      })
    );
  });
});
