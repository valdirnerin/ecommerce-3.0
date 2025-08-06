const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

jest.mock('../db', () => ({
  query: jest.fn().mockResolvedValue({}),
}));

jest.mock('mercadopago', () => {
  return {
    MercadoPagoConfig: jest.fn().mockImplementation(() => ({})),
    Payment: jest.fn().mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        body: {
          status: 'approved',
          external_reference: 'pref123',
          order: { id: 1 },
        },
      }),
    })),
    MerchantOrder: jest.fn().mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({ body: { preference_id: 'pref123' } }),
    })),
  };
});

describe('Mercado Pago Webhook', () => {
  let app;
  beforeAll(() => {
    process.env.MP_ACCESS_TOKEN = 'test';
    process.env.WEBHOOK_SECRET = 'secret';
    process.env.NODE_ENV = 'test';
    const router = require('../routes/mercadoPago');
    app = express();
    app.use(
      express.json({
        verify: (req, res, buf) => {
          req.rawBody = buf;
        },
      })
    );
    app.use('/api/webhooks/mp', router);
  });

  test('returns 200 for valid webhook', async () => {
    const body = { data: { id: 123 } };
    const raw = JSON.stringify(body);
    const signature = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');

    await request(app)
      .post('/api/webhooks/mp')
      .set('Content-Type', 'application/json')
      .set('x-signature', signature)
      .send(body)
      .expect(200);
  });
});
