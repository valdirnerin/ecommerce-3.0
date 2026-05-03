const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('../emailValidator');
jest.mock('afip.ts', () => ({ Afip: class {} }), { virtual: true });
jest.mock('resend', () => ({ Resend: class { constructor(){ this.emails={ send: jest.fn() }; } } }), { virtual: true });
jest.mock('multer', () => {
  const m = () => ({ single: jest.fn() });
  m.diskStorage = () => ({});
  return m;
}, { virtual: true });

describe('footer api persistence', () => {
  let tmpDir;
  let originalDataDir;
  let createServer;
  let server;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'footer-test-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    jest.resetModules();
    ({ createServer } = require('../server'));
    server = createServer();
  });

  afterEach((done) => {
    if (server?.listening) {
      server.close(() => {
        if (originalDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = originalDataDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        done();
      });
      return;
    }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    done();
  });

  test('GET /api/footer returns default when footer.json does not exist', async () => {
    const res = await request(server).get('/api/footer');
    expect(res.status).toBe(200);
    expect(res.body.brand).toBe('NERIN PARTS');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('POST /api/footer stores file in DATA_DIR and GET returns it', async () => {
    const payload = {
      brand: 'Grupo NERIN',
      legalDetails: { cuit: '30-99999999-9', iibb: '901-111111-1' },
      dataFiscal: { mode: 'placeholder', placeholder: 'Fiscal OK' },
      columns: [{ title: 'Empresa', links: [{ label: 'Contacto', href: '/contact.html' }] }],
    };

    const post = await request(server)
      .post('/api/footer')
      .set('Authorization', `Bearer ${Buffer.from('admin@nerin.com:any').toString('base64')}`)
      .send(payload);

    expect(post.status).toBe(200);
    expect(post.body.brand).toBe('Grupo NERIN');

    const savedPath = path.join(tmpDir, 'footer.json');
    expect(fs.existsSync(savedPath)).toBe(true);

    const get = await request(server).get('/api/footer');
    expect(get.status).toBe(200);
    expect(get.body.brand).toBe('Grupo NERIN');
    expect(get.body.legalDetails.cuit).toBe('30-99999999-9');
    expect(get.body.dataFiscal.placeholder).toBe('Fiscal OK');
  });

  test('POST /api/footer returns 500 on write failure (read-only fs simulation)', async () => {
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('EROFS'));
    const payload = { brand: 'No Save' };

    const post = await request(server)
      .post('/api/footer')
      .set('Authorization', `Bearer ${Buffer.from('admin@nerin.com:any').toString('base64')}`)
      .send(payload);

    expect(post.status).toBe(500);
    expect(post.body.error).toContain('No se pudo guardar footer.json');
    writeSpy.mockRestore();
  });
});
