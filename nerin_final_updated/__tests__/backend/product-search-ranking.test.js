const {
  computeSearchIntent,
  parseAppleModel,
  getProductAppleModelInfo,
  isAppleVariantMismatch,
  scoreProductAgainstIntent,
  rankRowsBySearchIntent,
  queryProducts,
  queryAdminProducts,
  ensureProductsDbOnce,
} = require('../../backend/data/productsSqliteRepo');

const score = (query, product) => scoreProductAgainstIntent(product, computeSearchIntent(query));
const firstTitle = (query, products) => {
  const ranked = rankRowsBySearchIntent(products, computeSearchIntent(query), { preferPositiveScores: true });
  return ranked[0]?.row?.name || ranked[0]?.row?.title || "";
};

beforeAll(async () => {
  await ensureProductsDbOnce();
}, 30000);

describe('product search ranking intent', () => {
  test('detects Apple iPhone model generation and variants', () => {
    expect(parseAppleModel('iphone 12 display')).toEqual({
      brand: 'apple',
      family: 'iphone',
      generation: '12',
      variant: 'base',
      exactModel: 'iphone 12',
    });
    expect(parseAppleModel('iphone 12 pro max display')).toMatchObject({
      generation: '12',
      variant: 'pro max',
      exactModel: 'iphone 12 pro max',
    });
    expect(getProductAppleModelInfo({ name: 'Display (Original), Apple iPhone 12 mini' }).productAppleModel).toMatchObject({
      exactModel: 'iphone 12 mini',
      variant: 'mini',
    });
    expect(isAppleVariantMismatch(parseAppleModel('iphone 12 display'), parseAppleModel('iphone 12 mini display'))).toBe(true);
  });

  test('iphone 12 display ranks base iphone 12 before mini/pro/pro max', () => {
    const title = firstTitle('iphone 12 display', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12 mini', model: 'iPhone 12 mini', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 4, name: 'Display (Original), Apple iPhone 12 Pro', model: 'iPhone 12 Pro', brand: 'Apple', category: 'Display' },
    ]);
    expect(title).toContain('Display (Original), Apple iPhone 12');
    expect(title.toLowerCase()).not.toContain('mini');
    expect(title.toLowerCase()).not.toContain('pro max');
  });

  test('iphone 12 mini display ranks mini first', () => {
    expect(firstTitle('iphone 12 mini display', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12 mini', model: 'iPhone 12 mini', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
    ])).toContain('iPhone 12 mini');
  });

  test('iphone 12 pro max display ranks pro max first', () => {
    expect(firstTitle('iphone 12 pro max display', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12 Pro', model: 'iPhone 12 Pro', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
    ])).toContain('iPhone 12 Pro Max');
  });

  test('iphone 12 pro display ranks pro first and does not treat pro max as exact pro', () => {
    expect(firstTitle('iphone 12 pro display', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12 Pro', model: 'iPhone 12 Pro', brand: 'Apple', category: 'Display' },
    ])).toContain('iPhone 12 Pro');
  });

  test('iphone 13 display does not rank iphone 12 above exact iphone 13', () => {
    expect(firstTitle('iphone 13 display', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 13', model: 'iPhone 13', brand: 'Apple', category: 'Display' },
    ])).toContain('iPhone 13');
  });

  test('iphone 12 battery ranks batteries above displays', () => {
    expect(firstTitle('iphone 12 bateria', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Bateria Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Bateria' },
    ])).toContain('Bateria');
  });

  test('iphone 12 tapa ranks rear covers above displays', () => {
    expect(firstTitle('iphone 12 tapa', [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Tapa trasera Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Tapa trasera' },
    ])).toContain('Tapa');
  });

  test('display iphone 12 keeps the same base model order as iphone 12 display', () => {
    const products = [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12 mini', model: 'iPhone 12 mini', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
    ];
    expect(firstTitle('display iphone 12', products)).toBe(firstTitle('iphone 12 display', products));
  });

  test('pantalla iphone 12 is understood as display intent', () => {
    expect(firstTitle('pantalla iphone 12', [
      { rowid: 1, name: 'Bateria Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Bateria' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
    ])).toContain('Display');
  });

  test('iphone 15 pro battery ranks 15 pro over other iphones', () => {
    const exact = score('iphone 15 pro battery', { name: 'Bateria iPhone 15 Pro', model: 'iPhone 15 Pro', brand: 'Apple' });
    const iphone17 = score('iphone 15 pro battery', { name: 'Bateria iPhone 17', model: 'iPhone 17', brand: 'Apple' });
    const iphone14 = score('iphone 15 pro battery', { name: 'Bateria iPhone 14', model: 'iPhone 14', brand: 'Apple' });
    expect(exact).toBeGreaterThan(iphone17);
    expect(exact).toBeGreaterThan(iphone14);
  });

  test('iphone 15 pro max battery ranks pro max over pro', () => {
    const proMax = score('iphone 15 pro max battery', { name: 'Battery iPhone 15 Pro Max', model: 'iPhone 15 Pro Max', brand: 'Apple' });
    const pro = score('iphone 15 pro max battery', { name: 'Battery iPhone 15 Pro', model: 'iPhone 15 Pro', brand: 'Apple' });
    expect(proMax).toBeGreaterThan(pro);
  });

  test('galaxy a56 charging board returns correct part type and model', () => {
    const chargingBoard = score('galaxy a56 charging board', { name: 'Placa de carga Galaxy A56', model: 'Galaxy A56', brand: 'Samsung' });
    const screen = score('galaxy a56 charging board', { name: 'Pantalla Galaxy A56', model: 'Galaxy A56', brand: 'Samsung' });
    expect(chargingBoard).toBeGreaterThan(screen);
  });

  test('s25 adhesive prefers adhesive over display', () => {
    const adhesive = score('s25 adhesive', { name: 'Adhesive Galaxy S25', model: 'Galaxy S25', brand: 'Samsung' });
    const display = score('s25 adhesive', { name: 'Display Galaxy S25', model: 'Galaxy S25', brand: 'Samsung' });
    expect(adhesive).toBeGreaterThan(display);
  });

  test('gh82-31231a prioritizes exact sku/mpn', () => {
    const exactSku = score('gh82-31231a', { sku: 'GH82-31231A', name: 'Battery Samsung' });
    const partial = score('gh82-31231a', { sku: 'GH82-00001A', name: 'Battery Samsung' });
    expect(exactSku).toBeGreaterThan(partial);
  });

  test('iphone 15 pro battery keeps iphone 17 and huawei below exact intent matches', () => {
    const intent = computeSearchIntent('iphone 15 pro battery');
    const ranked = rankRowsBySearchIntent([
      { rowid: 1, name: 'Bateria iPhone 17', model: 'iPhone 17', brand: 'Apple' },
      { rowid: 2, name: 'Pantalla iPhone 15 Pro', model: 'iPhone 15 Pro', brand: 'Apple' },
      { rowid: 3, name: 'Bateria iPhone 15 Pro', model: 'iPhone 15 Pro', brand: 'Apple' },
      { rowid: 4, name: 'Bateria Huawei P60', model: 'Huawei P60', brand: 'Huawei' },
      { rowid: 5, name: 'Bateria iPhone 14', model: 'iPhone 14', brand: 'Apple' },
    ], intent, { preferPositiveScores: true });
    const topTwoNames = ranked.slice(0, 2).map((entry) => entry.row.name);
    expect(topTwoNames).toContain('Bateria iPhone 15 Pro');
    expect(topTwoNames).not.toContain('Bateria iPhone 17');
    expect(topTwoNames).not.toContain('Bateria Huawei P60');
  });
});


describe('query APIs should not throw without normalized search scope errors', () => {
  const expectNoReferenceError = async (promiseFactory) => {
    try {
      await promiseFactory();
    } catch (error) {
      expect(String(error && error.message ? error.message : error)).not.toMatch(/normalizedSearch is not defined|ReferenceError/i);
    }
  };

  test('queryProducts without search does not crash with ReferenceError', async () => {
    await expectNoReferenceError(() => queryProducts({ page: 1, pageSize: 1 }));
  });

  test('queryProducts with iphone 15 pro battery does not throw ReferenceError', async () => {
    await expectNoReferenceError(() => queryProducts({ page: 1, pageSize: 1, search: 'iphone 15 pro battery' }));
  });

  test('queryAdminProducts without search does not crash with ReferenceError', async () => {
    await expectNoReferenceError(() => queryAdminProducts({ page: 1, pageSize: 1 }));
  });
});
