const request = require('supertest');
const express = require('express');
jest.mock('../db', () => ({
  query: jest.fn().mockResolvedValue({ rowCount: 1 }),
}));

describe('Mercado Pago Webhook', () => {
  let app;
  beforeAll(() => {
    process.env.MP_ACCESS_TOKEN = 'test';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'approved',
        external_reference: 'abc',
        preference_id: 'pref123',
      }),
    }));
    const router = require('../routes/mercadoPago');
    app = express();
    app.use(express.json());
    app.use('/api/webhooks/mp', router);
  });

  test('returns 200 for valid webhook', async () => {
    await request(app)
      .post('/api/webhooks/mp')
      .send({ type: 'payment', data: { id: '123' } })
      .expect(200);
  });
});
