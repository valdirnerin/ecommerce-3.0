const request = require('supertest');

jest.mock('../emailValidator');
jest.mock('afip.ts', () => ({ Afip: class {} }), { virtual: true });
jest.mock('resend', () => ({ Resend: class { constructor(){ this.emails={ send: jest.fn() }; } } }), { virtual: true });
jest.mock('multer', () => {
  const m = () => ({ single: jest.fn() });
  m.diskStorage = () => ({});
  return m;
}, { virtual: true });

jest.mock('fs', () => {
  const path = require('path');
  return {
    readFileSync: jest.fn(() => { throw new Error('read'); }),
    writeFileSync: jest.fn(() => { throw new Error('write'); }),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    stat: jest.fn((p, cb) => cb(null, { isDirectory: () => false })),
  };
});

const { createServer } = require('../server');
const server = createServer();

afterAll((done) => {
  if (server.listening) server.close(done);
  else done();
});

test('returns default footer when file system is read-only', async () => {
  const res = await request(server).get('/api/footer');
  expect(res.status).toBe(200);
  expect(res.body.brand).toBe('NERIN PARTS');
});
