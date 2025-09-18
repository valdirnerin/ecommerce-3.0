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
}));

jest.mock('../services/inventory', () => ({
  applyInventoryForOrder: jest.fn().mockResolvedValue(undefined),
}));

process.env.MP_ACCESS_TOKEN = 'test-token';

global.fetch = jest.fn();

const ordersRepo = require('../data/ordersRepo');
const { createServer } = require('../server');

describe('Mercado Pago webhook', () => {
  beforeEach(() => {
    ordersRepo.upsertByPayment.mockResolvedValue({
      id: 'ORDER-1',
      items: [{ id: 'SKU', qty: 1 }],
      inventoryApplied: true,
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
      expect.objectContaining({ payment_id: '123' })
    );
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
});
