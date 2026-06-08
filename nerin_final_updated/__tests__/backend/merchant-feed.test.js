const { buildMerchantFeedAudit, buildMerchantFeedEntries, safeMerchantText } = require('../../backend/utils/merchantFeed');
const { resolveProductAvailability } = require('../../backend/utils/productAvailability');

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
    expect(audit.samplesEligible[0].availability_date).toBeNull();
  });

  test('stock local > 0 entra al feed como in_stock', () => {
    const { entries } = buildMerchantFeedEntries([baseRow({ id: 'local', sku: 'LOCAL', stock: 4, availability: 'in_stock' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'LOCAL', availability: 'in_stock', availability_date: '' });
  });

  test('stock 0 + remote_stock > 0 no entra', () => {
    const audit = buildMerchantFeedAudit([baseRow({ id: 'remote', stock: 0, remote_stock: 8, raw_json: JSON.stringify({ remote_stock: 8 }) })]);
    expect(audit.emittedCount).toBe(0);
    expect(audit.skipped.remoteOrPreorderExcluded).toBe(1);
  });

  test('preorder backorder y out_of_stock no entran', () => {
    const rows = [
      baseRow({ id: 'preorder', stock: 0, availability: 'preorder' }),
      baseRow({ id: 'backorder', stock: 0, availability: 'backorder' }),
      baseRow({ id: 'out', stock: 0, availability: 'out_of_stock' }),
    ];
    const { entries, audit } = buildMerchantFeedEntries(rows);
    expect(entries).toHaveLength(0);
    expect(audit.skipped.remoteOrPreorderExcluded).toBe(2);
    expect(audit.skipped.outOfStockExcluded).toBe(1);
  });

  test('producto publico sin imagen precio o slug no entra', () => {
    const rows = [
      baseRow({ id: 'no-image', image: null }),
      baseRow({ id: 'no-price', price: null }),
      baseRow({ id: 'no-slug', slug: '', public_slug: '' }),
    ];
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.emittedCount).toBe(0);
    expect(audit.skipped.missingImage).toBe(1);
    expect(audit.skipped.missingPrice).toBe(1);
    expect(audit.skipped.missingLink).toBe(1);
  });

  test('auditoria marca error si cualquier entry no es in_stock', () => {
    const entries = [
      { id: 'ok', availability: 'in_stock' },
      { id: 'bad-pre', availability: 'preorder' },
      { id: 'bad-back', availability: 'backorder' },
      { id: 'bad-out', availability: 'out_of_stock' },
    ];
    const invalid = entries.filter((entry) => entry.availability !== 'in_stock');
    expect(invalid.map((entry) => entry.availability)).toEqual(['preorder', 'backorder', 'out_of_stock']);
  });

  test('stock 0 vendible a pedido no entra al feed Merchant', () => {
    const audit = buildMerchantFeedAudit([baseRow({ stock: 0 })]);
    expect(audit.emittedCount).toBe(0);
    expect(audit.skipped.outOfStockExcluded).toBe(1);
  });

  test('preorder comparte fecha entre feed, texto visible y JSON-LD', () => {
    const availability = resolveProductAvailability(baseRow({ stock: 0, availability: 'preorder', availability_date: '2026-06-16' }), { now: new Date('2026-05-19T12:00:00Z') });
    expect(availability.merchantAvailability).toBe('preorder');
    expect(availability.availabilityDateFeed).toBe('2026-06-16T00:00-0300');
    expect(availability.availabilityStarts).toBe('2026-06-16T00:00:00-03:00');
    expect(availability.visibleAvailabilityText).toContain('16/06/2026');
    expect(availability.seoAvailability).toBe('https://schema.org/PreOrder');
  });

  test('availability_date vencido o mayor a un anio se normaliza a ventana valida', () => {
    const older = resolveProductAvailability(baseRow({ stock: 0, availability: 'preorder', availability_date: '2026-01-01' }), { now: new Date('2026-05-19T12:00:00Z') });
    const tooFar = resolveProductAvailability(baseRow({ stock: 0, availability: 'preorder', availability_date: '2028-01-01' }), { now: new Date('2026-05-19T12:00:00Z') });
    expect(older.availabilityDateFeed).toBe('2026-05-20T00:00-0300');
    expect(tooFar.availabilityDateFeed).toBe('2027-05-19T00:00-0300');
  });
  test('contadores reales pueden ser mayores al lote escaneado', () => {
    const rows = [baseRow({ id: 'a' }), baseRow({ id: 'b', is_public: 0 })];
    const audit = buildMerchantFeedAudit(rows, { totalCatalogProducts: 52000, publicProductsCount: 12000, limit: 5, offset: 3 });
    expect(audit.totalCatalogProducts).toBe(52000);
    expect(audit.publicProductsCount).toBe(12000);
    expect(audit.scannedRows).toBe(2);
    expect(audit.limit).toBe(5);
    expect(audit.offset).toBe(3);
  });

  test('producto público stock 0 con imagen externa válida no cae en missingAvailability', () => {
    const audit = buildMerchantFeedAudit([
      baseRow({ id: 'pre-ext', stock: 0, image: 'https://images.2service.nl/v7/Images/Part/1/img.jpg' }),
    ]);
    expect(audit.skipped.missingAvailability).toBe(0);
    expect(audit.emittedCount).toBe(0);
    expect(audit.skipped.outOfStockExcluded).toBe(1);
  });


  test('debug limpia mojibake en breakdown y samples', () => {
    const rows = [
      baseRow({ id: 'dbg-1', name: 'CÃ¡mara MÃ³dulo', raw_json: JSON.stringify({ category: 'Componentes electrÃ³nicos' }) }),
      baseRow({ id: 'dbg-2', is_public: 0 }),
    ];
    const audit = buildMerchantFeedAudit(rows);
    expect(Object.keys(audit.productTypeBreakdown).join(' ')).not.toMatch(/MÃ|electrÃ/);
    expect(audit.samplesEligible[0].title).not.toContain('MÃ³dulo');
    expect(audit.samplesEligible[0].productType).not.toContain('electrÃ³nicos');
  });

  test('safeMerchantText corrige mojibake típico', () => {
    expect(safeMerchantText('MÃ³dulo Pantalla')).toBe('Módulo Pantalla');
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


  test('buildMerchantFeedAudit audita filas válidas sin error genérico', () => {
    const rows = [baseRow({ id: 'ok-1' }), baseRow({ id: 'ok-2', stock: 0, raw_json: JSON.stringify({ allow_backorder: true }) })];
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.ok).toBeUndefined();
    expect(audit.eligibleCount).toBeGreaterThan(0);
    expect(audit.emittedCount).toBe(1);
  });

  test('buildMerchantFeedAudit tolera raw_json null, vacío e inválido', () => {
    const rows = [
      baseRow({ id: 'n1', raw_json: null }),
      baseRow({ id: 'n2', raw_json: '' }),
      baseRow({ id: 'n3', raw_json: '{invalid-json' }),
    ];
    expect(() => buildMerchantFeedAudit(rows)).not.toThrow();
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.scannedRows).toBe(3);
  });

  test('buildMerchantFeedAudit tolera campos opcionales ausentes', () => {
    const rows = [
      baseRow({ id: 'opt-1', brand: null, mpn: null, part_number: null, description: null }, {}),
    ];
    expect(() => buildMerchantFeedAudit(rows)).not.toThrow();
  });
  test('debug devuelve skipped reasons y samples', () => {
    const audit = buildMerchantFeedAudit([baseRow(), baseRow({ id: 'x', is_public: 0 })]);
    expect(audit).toHaveProperty('skipped');
    expect(Array.isArray(audit.samplesEligible)).toBe(true);
    expect(Array.isArray(audit.samplesSkipped)).toBe(true);
  });

  test('acepta URL externa de proveedor con query params', () => {
    const image = 'https://images.2service.nl/v7/Images/Part/1337/1336958/C1GH82-36387A.jpg?p=p1000x1000&ci_eqs=x&ci_seal=y';
    const audit = buildMerchantFeedAudit([baseRow({ id: 'gh82', stock: 1, image })]);
    expect(audit.emittedCount).toBe(1);
    expect(audit.samplesEligible[0].image_link).toBe(image);
  });

  test('normaliza URL externa con caracteres especiales', () => {
    const rawImage = 'https://images.2service.nl/v7/Images/Part/1337/1336958/]C1GH82-36387A.jpg?p=p1000x1000&ci_eqs=x&ci_seal=y';
    const audit = buildMerchantFeedAudit([baseRow({ id: 'gh82b', image: rawImage })]);
    expect(audit.emittedCount).toBe(1);
    expect(audit.samplesEligible[0].image_link).toContain('https://images.2service.nl/');
  });

  test('convierte ruta relativa propia a dominio público', () => {
    const audit = buildMerchantFeedAudit([baseRow({ id: 'rel-1', image: '/assets/uploads/products/x.webp' })]);
    expect(audit.emittedCount).toBe(1);
    expect(audit.samplesEligible[0].image_link).toBe('https://nerinparts.com.ar/assets/uploads/products/x.webp');
  });

  test('rechaza data:image, blob y placeholder vacío', () => {
    const rows = [
      baseRow({ id: 'bad-data', image: 'data:image/png;base64,aaaa' }),
      baseRow({ id: 'bad-blob', image: 'blob:https://nerinparts.com.ar/something' }),
      baseRow({ id: 'bad-empty', image: '   ' }),
    ];
    const audit = buildMerchantFeedAudit(rows);
    expect(audit.skipped.invalidImageUrl).toBe(3);
    expect(audit.samplesSkipped.some((item) => item.id === 'bad-data' && item.reason.includes('dataImage'))).toBe(true);
    expect(audit.samplesSkipped.some((item) => item.id === 'bad-blob' && item.reason.includes('blobUrl'))).toBe(true);
    expect(audit.samplesSkipped.some((item) => item.id === 'bad-empty' && item.reason.includes('empty'))).toBe(true);
  });

  test('producto público con imagen externa válida y stock/preorder válido aparece en samplesEligible', () => {
    const audit = buildMerchantFeedAudit([
      baseRow({ id: 'ok-ext', image: 'https://images.2service.nl/v7/Images/Part/1/img.jpg', stock: 0, raw_json: JSON.stringify({ allow_backorder: true }) }),
    ]);
    expect(audit.emittedCount).toBe(0);
    expect(audit.samplesSkipped[0].reason).toBe('outOfStockExcluded');
  });
});


describe('merchant feed tsv payload', () => {
  test('usa misma elegibilidad que debug', () => {
    const rows = [
      baseRow({ id: 'ok-1' }),
      baseRow({ id: 'bad-hidden', raw_json: JSON.stringify({ hidden: true }) }),
      baseRow({ id: 'bad-no-image', image: null }),
    ];
    const audit = buildMerchantFeedAudit(rows, { limit: 50, offset: 0 });
    const tsv = buildMerchantFeedEntries(rows, { limit: 50, offset: 0 });
    expect(tsv.audit.eligibleCount).toBe(audit.eligibleCount);
    expect(tsv.entries.length).toBe(audit.emittedCount);
  });


  test('description limpia artifacts de contentReference/oaicite', () => {
    const rows = [
      baseRow({
        id: 'cite-1',
        description: 'Texto limpio :contentReference[oaicite:1]{index=1} y oaicite y :contentReference[foo]',
      }),
    ];
    const { entries } = buildMerchantFeedEntries(rows);
    expect(entries[0].description).not.toContain('contentReference');
    expect(entries[0].description).not.toContain('oaicite');
  });

  test('solo in_stock entra al feed y headers esperados', () => {
    const rows = [baseRow({ id: 'stk', stock: 3 }), baseRow({ id: 'pre', stock: 0 }), baseRow({ id: 'back', stock: 0, raw_json: JSON.stringify({ availability: 'backorder' }) })];
    const { entries } = buildMerchantFeedEntries(rows);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.stk.availability).toBe('in_stock');
    expect(byId.stk.availability_date).toBe('');
    expect(byId.pre).toBeUndefined();
    expect(byId.back).toBeUndefined();
    expect(Object.keys(entries[0])).toEqual(['id','title','description','link','image_link','additional_image_link','availability','availability_date','price','condition','brand','mpn','identifier_exists','google_product_category','product_type']);
  });

  test('limpia mojibake y no duplica additional_image_link', () => {
    const rows = [
      baseRow({ id: 'moji', name: 'MÃ³dulo CÃ¡maras', image: 'https://a.com/x.jpg', raw_json: JSON.stringify({ images: ['https://a.com/x.jpg', 'https://a.com/y.jpg'] }) }),
      baseRow({ id: 'comp', name: 'Componente electrÃ³nico IC PMIC' }),
      baseRow({ id: 'cam', name: 'CÃ¡mara trasera iPhone' }),
    ];
    const { entries } = buildMerchantFeedEntries(rows);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.moji.title).toContain('Módulo');
    expect(byId.moji.title).toContain('Cámaras');
    expect(byId.moji.additional_image_link).toBe('https://a.com/y.jpg');
    expect(byId.comp.product_type).toBe('Componentes electrónicos');
    expect(byId.cam.product_type).toBe('Cámaras y lentes');
  });


  test('additional_image_link excluye principal, deduplica y descarta inválidas', () => {
    const rows = [baseRow({
      id: 'img-dedupe',
      image: 'https://img.cdn.com/a.webp',
      raw_json: JSON.stringify({
        image: 'https://img.cdn.com/a.webp',
        images: [
          'https://img.cdn.com/a.webp',
          'https://img.cdn.com/a.webp#fragment',
          'data:image/png;base64,aaaa',
          'blob:https://img.cdn.com/abc',
          '   ',
          'https://img.cdn.com/b.webp',
          'https://img.cdn.com/b.webp',
          'https://img.cdn.com/c.webp'
        ],
      }),
    })];
    const { entries } = buildMerchantFeedEntries(rows);
    expect(entries[0].additional_image_link).toBe('https://img.cdn.com/b.webp,https://img.cdn.com/c.webp');
    expect(entries[0].additional_image_link.includes(entries[0].image_link)).toBe(false);
  });

  test('additional_image_link vacío si solo existe imagen principal', () => {
    const { entries } = buildMerchantFeedEntries([baseRow({ id: 'single-img', image: 'https://img.cdn.com/main.webp' })]);
    expect(entries[0].additional_image_link).toBe('');
  });

  test('display incl battery prioriza Pantallas; battery puro queda Baterias', () => {
    const rows = [
      baseRow({ id: 'disp-batt', name: 'Display incl. battery (Original) - Black, Huawei Y5 (2017)' }),
      baseRow({ id: 'batt-main', name: 'Battery (Original), Apple iPhone 14' }),
    ];
    const { entries } = buildMerchantFeedEntries(rows);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.product_type]));
    expect(byId['disp-batt']).toBe('Pantallas');
    expect(byId['batt-main']).toBe('Baterias');
  });

});
