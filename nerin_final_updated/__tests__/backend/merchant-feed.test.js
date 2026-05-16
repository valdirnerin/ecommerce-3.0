const { buildMerchantFeedAudit } = require('../../backend/utils/merchantFeed');

function baseRow(overrides = {}, raw = {}) {
  return {
    id: '1',
    sku: null,
    name: 'GH82 Display Samsung A52',
    description: 'Pantalla de repuesto',
    slug: 'gh82-display-a52',
    image: 'https://nerinparts.com.ar/assets/a52.jpg',
    price: 1000,
    stock: 2,
    is_public: 1,
    enabled: 1,
    deleted: 0,
    archived: 0,
    vip_only: 0,
    wholesale_only: 0,
    raw_json: JSON.stringify(raw),
    ...overrides,
  };
}

describe('merchant feed audit', () => {
  test('feed no incluye productos privados/hidden/disabled/deleted/archived/draft', () => {
    const rows = [
      baseRow({ id: 'p1', raw_json: JSON.stringify({ private: true }) }),
      baseRow({ id: 'p2', raw_json: JSON.stringify({ hidden: true }) }),
      baseRow({ id: 'p3', enabled: 0 }),
      baseRow({ id: 'p4', deleted: 1 }),
      baseRow({ id: 'p5', archived: 1 }),
      baseRow({ id: 'p6', raw_json: JSON.stringify({ draft: true }) }),
    ];
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.emittedCount).toBe(0);
    expect(audit.skipped.privateOrHidden).toBe(2);
    expect(audit.skipped.disabled).toBe(1);
    expect(audit.skipped.deleted).toBe(1);
    expect(audit.skipped.archived).toBe(1);
    expect(audit.skipped.draft).toBe(1);
  });

  test('feed no incluye productos sin precio y sin imagen', () => {
    const rows = [baseRow({ id: 'a', price: null }), baseRow({ id: 'b', image: null })];
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.skipped.missingPrice).toBe(1);
    expect(audit.skipped.missingImage).toBe(1);
  });

  test('stock > 0 => in_stock', () => {
    const audit = buildMerchantFeedAudit([baseRow({ stock: 5 })]);
    expect(audit.samplesEligible[0].availability).toBe('in_stock');
  });

  test('stock 0 vendible a pedido => preorder + availability_date', () => {
    const audit = buildMerchantFeedAudit([baseRow({ stock: 0, raw_json: JSON.stringify({ allow_backorder: true }) })]);
    expect(audit.samplesEligible[0].availability).toBe('preorder');
    expect(audit.samplesEligible[0].availability_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('taxonomía clasifica casos solicitados', () => {
    const rows = [
      baseRow({ id: 'ad', name: 'Adhesive Tape Display iPhone 12' }),
      baseRow({ id: 'gh', name: 'GH82 módulo pantalla Samsung' }),
      baseRow({ id: 'bt', name: 'Battery iPhone 11' }),
      baseRow({ id: 'cb', name: 'Charging board dock connector A20' }),
      baseRow({ id: 'rs', name: 'RESIN PC UV' }),
    ];
    const audit = buildMerchantFeedAudit(rows, { limit: 10 });
    const byId = Object.fromEntries(audit.samplesEligible.map((s) => [s.id, s.productType]));
    expect(byId.ad).toBe('Repuestos celulares > Adhesivos para pantalla');
    expect(byId.gh).toBe('Pantallas');
    expect(byId.bt).toBe('Baterias');
    expect(byId.cb).toBe('Repuestos celulares > Pines de carga');
    expect(byId.rs).not.toBe('Pantallas');
  });

  test('debug devuelve skipped reasons y samples', () => {
    const audit = buildMerchantFeedAudit([baseRow(), baseRow({ id: 'x', is_public: 0 })]);
    expect(audit).toHaveProperty('skipped');
    expect(Array.isArray(audit.samplesEligible)).toBe(true);
    expect(Array.isArray(audit.samplesSkipped)).toBe(true);
  });
});
