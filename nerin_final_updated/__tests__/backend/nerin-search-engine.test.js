const { computeSearchIntent, scoreProductAgainstIntent } = require('../../backend/data/productsSqliteRepo');

const score = (q, p) => scoreProductAgainstIntent(p, computeSearchIntent(q));

describe('NERIN search relevance cases', () => {
  test('CASO 1 pantalla samsung a15', () => {
    expect(score('pantalla samsung a15', { name: 'Pantalla Samsung Galaxy A15 A156', brand: 'Samsung' }))
      .toBeGreaterThan(score('pantalla samsung a15', { name: 'Bateria Huawei P20 Lite', brand: 'Huawei' }));
  });
  test('CASO 2 a156 > a165', () => {
    expect(score('a156', { name: 'Display SM-A156 A15 5G' })).toBeGreaterThan(score('a156', { name: 'Display A165' }));
  });
  test('CASO 3 GH82 exacto', () => {
    expect(score('GH82-33638A', { sku: 'GH82-33638A', name: 'Display A15' })).toBeGreaterThan(2000);
  });
  test('CASO 4 sin guion', () => {
    expect(score('gh8233638a', { sku: 'GH82-33638A', name: 'Display A15' })).toBeGreaterThan(700);
  });
  test('CASO 6 pin de carga vs pantalla', () => {
    expect(score('pin de carga huawei p30 lite', { name: 'Charging board Huawei P30 Lite' }))
      .toBeGreaterThan(score('pin de carga huawei p30 lite', { name: 'Pantalla Huawei P30 Lite' }));
  });
  test('CASO 9 compatible for huawei', () => {
    expect(score('display compatible huawei p20 lite', { name: 'Display P20 Lite', brand: 'for huawei' }))
      .toBeGreaterThan(score('display compatible huawei p20 lite', { name: 'Display P20 Lite', brand: 'Huawei' }));
  });
  test('CASO 10 original vs for huawei', () => {
    expect(score('display original huawei p20 lite', { name: 'Display P20 Lite', brand: 'Huawei' }))
      .toBeGreaterThan(score('display original huawei p20 lite', { name: 'Display P20 Lite', brand: 'for huawei' }));
  });
  test('CASO 14 typo pantala samsumg a15', () => {
    expect(score('pantala samsumg a15', { name: 'Pantalla Samsung A15' })).toBeGreaterThan(0);
  });
});
