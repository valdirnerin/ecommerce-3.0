const {
  normalizeProductRow,
  calculateProductPricing,
  buildPricingAudit,
} = require('../../backend/services/supplierPricing');

describe('supplierPricing conservative configurable module', () => {
  test('producto EUR normal calcula precio final y breakdown', () => {
    const product = normalizeProductRow({
      Nombre: 'Pantalla iPhone',
      UnitPrice: '10',
      Stock: 5,
      Image: 'https://cdn/img.jpg',
      Categoria: 'Pantallas',
    });

    const result = calculateProductPricing(product);
    expect(result.ok).toBe(true);
    expect(result.price_final_sugerido).toBeGreaterThan(1000);
    expect(result.breakdown.supplier_currency).toBe('EUR');
    expect(result.breakdown.final_price_ars_rounded % 100).toBe(0);
  });

  test('producto con costo bajo respeta precio mínimo y redondeo', () => {
    const product = normalizeProductRow({ UnitPrice: 0.01, Stock: 1, Image: 'x' });
    const result = calculateProductPricing(product);
    expect(result.ok).toBe(true);
    expect(result.price_final_sugerido).toBeGreaterThanOrEqual(1000);
    expect(result.price_final_sugerido % 100).toBe(0);
  });

  test('producto con costo alto calcula mayor precio final', () => {
    const low = calculateProductPricing(normalizeProductRow({ UnitPrice: 5, Stock: 1, Image: 'x' }));
    const high = calculateProductPricing(normalizeProductRow({ UnitPrice: 100, Stock: 1, Image: 'x' }));
    expect(high.price_final_sugerido).toBeGreaterThan(low.price_final_sugerido);
  });

  test('producto sin UnitPrice devuelve error', () => {
    const product = normalizeProductRow({ Nombre: 'Sin precio', Stock: 4, Image: 'x' });
    const result = calculateProductPricing(product);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('unit_price_missing');
  });

  test('cambio de margen impacta precio final', () => {
    const product = normalizeProductRow({ UnitPrice: 10, Stock: 3, Image: 'x' });
    const base = calculateProductPricing(product);
    const lowerMargin = calculateProductPricing(product, { net_margin: 0.12 });
    expect(lowerMargin.price_final_sugerido).toBeLessThan(base.price_final_sugerido);
  });

  test('cambio de envío ML impacta precio final', () => {
    const product = normalizeProductRow({ UnitPrice: 10, Stock: 3, Image: 'x' });
    const base = calculateProductPricing(product);
    const moreShipping = calculateProductPricing(product, { ml_shipping_cost_ars: 15000 });
    expect(moreShipping.price_final_sugerido).toBeGreaterThan(base.price_final_sugerido);
  });

  test('cambio de tipo de cambio impacta precio final', () => {
    const product = normalizeProductRow({ UnitPrice: 10, Stock: 3, Image: 'x' });
    const base = calculateProductPricing(product);
    const higherFx = calculateProductPricing(product, { usd_ars: 1700 });
    expect(higherFx.price_final_sugerido).toBeGreaterThan(base.price_final_sugerido);
  });

  test('buildPricingAudit devuelve estructura auditable', () => {
    const product = normalizeProductRow({ Nombre: 'Modulo', UnitPrice: 10, Stock: 0, Image: '' });
    const pricing = calculateProductPricing(product);
    const audit = buildPricingAudit(product, pricing);
    expect(audit.product.title).toBe('Modulo');
    expect(audit.pricing).toBeDefined();
    expect(audit.parameters_used).toBeDefined();
    expect(typeof audit.calculated_at).toBe('string');
  });
});
