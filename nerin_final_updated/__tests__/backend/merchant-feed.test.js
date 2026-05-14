const { detectProductType } = require('../../backend/utils/productTaxonomy');
const { mapProductTypeToFeed, buildMerchantTitle, computeAvailability } = require('../../backend/utils/merchantFeed');

describe('merchant feed taxonomy/title rules', () => {
  test('RESIN PC no debe ser pantalla', () => {
    expect(detectProductType({ name: 'RESIN PC' })).not.toBe('Pantalla / display');
  });

  test('Adhesive Tape Display no debe ser Pantallas', () => {
    const type = detectProductType({ name: 'Adhesive Tape Display, Galaxy S25; SM-S931' });
    expect(mapProductTypeToFeed(type)).toMatch(/Adhesivos/);
  });

  test('Display real GH82 debe ser Pantallas', () => {
    const type = detectProductType({ name: 'Display OLED GH82 for Samsung' });
    expect(mapProductTypeToFeed(type)).toBe('Pantallas');
  });

  test('Battery -> Baterias', () => {
    expect(mapProductTypeToFeed(detectProductType({ name: 'Battery EB-BG991ABY' }))).toBe('Baterias');
  });

  test('Charging board -> Pines de carga', () => {
    expect(mapProductTypeToFeed(detectProductType({ name: 'Charging board for A52' }))).toBe('Repuestos celulares > Pines de carga');
  });

  test('Pressing jig -> Herramientas', () => {
    expect(mapProductTypeToFeed(detectProductType({ name: 'Pressing jig tool' }))).toBe('Herramientas para reparación');
  });

  test('title limpio sin inventar', () => {
    expect(buildMerchantTitle({ name: ' RESIN   PC ' }, {})).toBe('RESIN PC');
  });

  test('preorder para stock 0 vendible', () => {
    const av = computeAvailability({ stock: 0 }, { allow_backorder: true }, 30);
    expect(av.availability).toBe('preorder');
  });
});
