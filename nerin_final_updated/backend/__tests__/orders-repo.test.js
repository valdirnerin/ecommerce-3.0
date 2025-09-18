const fs = require('fs');
const os = require('os');
const path = require('path');

describe('ordersRepo legacy support', () => {
  let originalDataDir;

  beforeEach(() => {
    jest.resetModules();
    originalDataDir = process.env.DATA_DIR;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-repo-'));
    process.env.DATA_DIR = tmpDir;
    const localDataDir = path.join(__dirname, '..', '..', 'data');
    const sampleSrc = path.join(localDataDir, 'products.json');
    const sampleDest = path.join(tmpDir, 'products.json');
    fs.copyFileSync(sampleSrc, sampleDest);
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    jest.resetModules();
  });

  test('upsertByPayment actualiza una orden legacy con "productos"', async () => {
    const repo = require('../data/ordersRepo');
    const existing = await repo.create({
      id: 'O-1',
      productos: [{ titulo: 'Item A', cantidad: 2, precio: 100 }],
      totals: { items: 200, shipping: 0, grand_total: 200 },
    });

    expect(existing.items).toBeDefined();

    const out = await repo.upsertByPayment({
      payment_id: 'P-123',
      preference_id: 'PF-1',
      external_reference: 'O-1',
      patch: { payment_status: 'approved', status: 'paid' },
    });

    expect(out.status).toBe('paid');
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items.length).toBeGreaterThan(0);
  });
});
