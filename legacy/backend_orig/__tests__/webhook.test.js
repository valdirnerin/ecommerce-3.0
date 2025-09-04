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
        status: 'approved',
        external_reference: 'pref123',
        order: { id: 1 },
      }),
    })),
    MerchantOrder: jest.fn().mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        preference_id: 'pref123',
        payments: [{ id: 987 }],
      }),
    })),
  };
});

const { Payment, MerchantOrder } = require('mercadopago');
const router = require('../routes/mercadoPago');

describe('Mercado Pago Webhook', () => {
  let app;
  beforeAll(() => {
    process.env.MP_ACCESS_TOKEN = 'test';
    process.env.WEBHOOK_SECRET = 'secret';
    process.env.NODE_ENV = 'test';
    app = express();
    app.use(express.urlencoded({ extended: false }));
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
    const body = { id: 999, data: { id: 123 } };
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

    const paymentInstance = Payment.mock.results[0].value;
    expect(paymentInstance.get).toHaveBeenCalledWith({ id: 123 });
  });

  test('uses payment_id over event or data id', async () => {
    const paymentInstance = Payment.mock.results[0].value;
    paymentInstance.get.mockClear();
    const body = { id: 999, data: { id: 123 }, payment_id: 456 };
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

    expect(paymentInstance.get).toHaveBeenCalledWith({ id: 456 });
  });

  test('mapStatus maps cancelled-type statuses to cancelled', () => {
    expect(router.mapStatus('cancelled')).toBe('cancelled');
    expect(router.mapStatus('refunded')).toBe('cancelled');
    expect(router.mapStatus('charged_back')).toBe('cancelled');
  });

  test('handles merchant_order webhook with resource only', async () => {
    const merchantInstance = MerchantOrder.mock.results[0].value;
    merchantInstance.get.mockClear();
    const paymentInstance = Payment.mock.results[0].value;
    paymentInstance.get.mockClear();

    await request(app)
      .post('/api/webhooks/mp?topic=merchant_order')
      .type('form')
      .send({ resource: 'https://api.mercadolibre.com/merchant_orders/777' })
      .expect(200);

    // allow async processing to complete
    await new Promise((resolve) => setImmediate(resolve));

    expect(merchantInstance.get).toHaveBeenCalledWith({ id: '777' });
    expect(paymentInstance.get).toHaveBeenCalledWith({ id: 987 });
  });
});
