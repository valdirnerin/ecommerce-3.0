const path = require('path');
const request = require('supertest');
const dataDir = require('../utils/dataDir');

jest.mock('../emailValidator');
jest.mock('afip.ts', () => ({ Afip: class {} }), { virtual: true });
jest.mock('resend', () => ({ Resend: class { constructor(){ this.emails={ send: jest.fn() }; } } }), { virtual: true });
jest.mock('multer', () => {
  const m = () => ({ single: jest.fn() });
  m.diskStorage = () => ({}) ;
  return m;
}, { virtual: true });
jest.mock('fs', () => {
  const path = require('path');
  const files = {};
  return {
    readFileSync: jest.fn((p) => {
      p = path.normalize(p);
      return files[p] || '{}';
    }),
    writeFileSync: jest.fn((p, data) => {
      files[path.normalize(p)] = data;
    }),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    stat: jest.fn((p, cb) => cb(null, { isDirectory: () => false })),
  };
});

const verifyEmailMock = require('../emailValidator');
const fs = require('fs');

const ordersPath = path.join(dataDir, 'orders.json');
const configPath = path.join(dataDir, 'config.json');
const uploadsPath = path.join(dataDir, 'invoice_uploads.json');

describe('Ecommerce features', () => {
  let server;
  beforeAll(() => {
    // prepare fake data
    const fakeOrder = {
      id: 'ORDER123',
      cliente: { email: 'user@test.com' },
      productos: [],
      estado_pago: 'pendiente',
      estado_envio: 'pendiente',
      fecha: new Date().toISOString(),
      total: 100,
      seguimiento: 'TRK1',
      transportista: 'Correo',
    };
    fs.writeFileSync(ordersPath, JSON.stringify({ orders: [fakeOrder] }));
    fs.writeFileSync(configPath, '{}');
    fs.writeFileSync(uploadsPath, JSON.stringify({ uploads: [{ orderId: 'ORDER123', fileName: 'fact.pdf' }] }));
    process.env.MP_ACCESS_TOKEN = '';
    server = require('../server');
  });

  afterAll((done) => {
    if (server.listening) server.close(done);
    else done();
  });

  test('email validator flags undeliverable', async () => {
    process.env.EMAIL_VERIFICATION_API_KEY = 'testkey';
    const realVerify = jest.requireActual('../emailValidator');
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ deliverability: 'UNDELIVERABLE' }),
    });
    const result = await realVerify('fake@test.com');
    expect(result).toBe(false);
  });

  test('track-order requires correct email', async () => {
    verifyEmailMock.mockResolvedValue(true);
    let res = await request(server)
      .post('/api/track-order')
      .send({ email: 'wrong@test.com', id: 'ORDER123' });
    expect(res.status).toBe(404);

    res = await request(server)
      .post('/api/track-order')
      .send({ email: 'user@test.com', id: 'ORDER123' });
    expect(res.status).toBe(200);
    expect(res.body.order.seguimiento).toBe('TRK1');
    expect(res.body.order.transportista).toBe('Correo');
  });
});
