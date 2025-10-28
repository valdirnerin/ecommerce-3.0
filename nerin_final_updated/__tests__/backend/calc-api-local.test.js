const fs = require('fs');
const path = require('path');
const request = require('supertest');

describe('Calculadora local /calc-api', () => {
  const tmpDir = path.join(__dirname, '__tmp_calc_api__');
  const originalDataDir = process.env.DATA_DIR;
  const originalCalcApiBase = process.env.IMPORT_CALC_API_BASE;
  let server;
  let createServer;

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const writeJson = (file, data) => {
      fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data, null, 2), 'utf8');
    };
    writeJson('config.json', { publicUrl: 'https://nerinparts.example' });
    writeJson('products.json', { products: [] });
    writeJson('orders.json', { orders: [] });
    writeJson('order_items.json', { order_items: [] });
    writeJson('clients.json', { clients: [] });
    writeJson('returns.json', { returns: [] });
    writeJson('invoice_uploads.json', { uploads: [] });

    process.env.DATA_DIR = tmpDir;
    delete process.env.IMPORT_CALC_API_BASE;
    jest.resetModules();
    ({ createServer } = require('../../backend/server'));
    server = createServer();
  });

  afterAll((done) => {
    process.env.DATA_DIR = originalDataDir;
    if (originalCalcApiBase) {
      process.env.IMPORT_CALC_API_BASE = originalCalcApiBase;
    } else {
      delete process.env.IMPORT_CALC_API_BASE;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  test('GET /calc-api/presets entrega presets por defecto', async () => {
    const res = await request(server).get('/calc-api/presets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('parameters');
  });

  test('POST /calc-api/calculations calcula márgenes y guarda resultado', async () => {
    const payload = {
      parameters: {
        costs: {
          fob: { amount: '100', currency: 'USD' },
          freight: { amount: '5', currency: 'USD' },
          insurance: { amount: '1', currency: 'USD' },
        },
        tc_aduana: '980',
        di_rate: '0.08',
        apply_tasa_estadistica: true,
        iva_rate: '0.21',
        perc_iva_rate: '0.20',
        perc_ganancias_rate: '0.06',
        gastos_locales_ars: '8000',
        costos_salida_ars: '2500',
        mp_rate: '0.05',
        mp_iva_rate: '0.21',
        target: 'margen',
        margen_objetivo: '0.25',
        quantity: 1,
      },
    };

    const res = await request(server).post('/calc-api/calculations').send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('calculation_id');
    expect(res.body.results.precio_neto_ars).toBe('266168.46');
    expect(res.body.results.margen).toBe('0.2500');
    expect(res.body.results.costo_puesto_ars).toBe('181023.15');

    const { calculation_id: calculationId } = res.body;
    const getRes = await request(server).get(`/calc-api/calculations/${calculationId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.results.precio_final_ars).toBe('322063.84');
  });

  test('POST /calc-api/payments/notify actualiza el cálculo con fee real', async () => {
    const createRes = await request(server).post('/calc-api/calculations').send({
      parameters: {
        costs: {
          fob: { amount: '50', currency: 'USD' },
          freight: { amount: '3', currency: 'USD' },
          insurance: { amount: '1', currency: 'USD' },
        },
        tc_aduana: '950',
        di_rate: '0.08',
        apply_tasa_estadistica: true,
        iva_rate: '0.21',
        perc_iva_rate: '0.20',
        perc_ganancias_rate: '0.06',
        gastos_locales_ars: '5000',
        costos_salida_ars: '1200',
        mp_rate: '0.05',
        mp_iva_rate: '0.21',
        target: 'margen',
        margen_objetivo: '0.20',
        order_reference: 'TEST-123',
      },
    });
    expect(createRes.status).toBe(201);

    const notifyRes = await request(server).post('/calc-api/payments/notify').send({
      payment_id: 'pay_1',
      order_reference: 'TEST-123',
      amount: '1000',
      fee_total: '1500',
      currency: 'ARS',
      fee_breakdown: { mp: '1500' },
    });

    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.payment_id).toBe('pay_1');
    expect(notifyRes.body).toHaveProperty('calculation_id');
    expect(notifyRes.body.updated_results).toBeDefined();
    expect(notifyRes.body.updated_results.breakdown.MP_Fee_Total_ARS).toBe('1500.00');
  });

  test('GET /calc-api/calculations/:id/export?format=csv entrega archivo', async () => {
    const createRes = await request(server).post('/calc-api/calculations').send({
      parameters: {
        costs: {
          fob: { amount: '40', currency: 'USD' },
          freight: { amount: '4', currency: 'USD' },
          insurance: { amount: '0', currency: 'USD' },
        },
        tc_aduana: '900',
        di_rate: '0.10',
        apply_tasa_estadistica: false,
        iva_rate: '0.21',
        perc_iva_rate: '0.20',
        perc_ganancias_rate: '0.06',
        gastos_locales_ars: '3000',
        costos_salida_ars: '800',
        mp_rate: '0.05',
        mp_iva_rate: '0.21',
        target: 'margen',
        margen_objetivo: '0.20',
      },
    });
    expect(createRes.status).toBe(201);
    const calcId = createRes.body.calculation_id;

    const exportRes = await request(server)
      .get(`/calc-api/calculations/${calcId}/export?format=csv`)
      .buffer()
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toMatch(/text\/csv/);
    expect(exportRes.body.toString()).toContain('"Concepto","Valor"');
  });
});
