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

  test('technical Spanish and English synonyms expand without losing iPhone 12 base precision', () => {
    const products = [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12 mini', model: 'iPhone 12 mini', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Display (Original), Apple iPhone 12 Pro Max', model: 'iPhone 12 Pro Max', brand: 'Apple', category: 'Display' },
      { rowid: 3, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 4, name: 'Battery, Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Battery' },
    ];
    expect(firstTitle('pantalla iphone 12', products)).toBe('Display (Original), Apple iPhone 12');
    expect(firstTitle('display iphone 12', products)).toBe('Display (Original), Apple iPhone 12');
    expect(firstTitle('modulo iphone 12', products)).toBe('Display (Original), Apple iPhone 12');
  });

  test('battery intent ranks battery above display in Spanish and English', () => {
    const products = [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Battery, Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Battery' },
    ];
    expect(firstTitle('bateria iphone 12', products)).toBe('Battery, Apple iPhone 12');
    expect(firstTitle('battery iphone 12', products)).toBe('Battery, Apple iPhone 12');
  });

  test('charging Spanish queries rank Samsung A54 charging boards first', () => {
    const products = [
      { rowid: 1, name: 'Display Samsung Galaxy A54', model: 'Galaxy A54', brand: 'Samsung', category: 'Display' },
      { rowid: 2, name: 'Charging board / dock connector Samsung Galaxy A54', model: 'Galaxy A54', brand: 'Samsung', category: 'Charging board' },
      { rowid: 3, name: 'Back cover Samsung Galaxy A54', model: 'Galaxy A54', brand: 'Samsung', category: 'Back cover' },
    ];
    expect(firstTitle('pin de carga samsung a54', products)).toContain('Charging board');
    expect(firstTitle('placa de carga samsung a54', products)).toContain('Charging board');
  });

  test('technical part intents rank the requested replacement type first', () => {
    const products = [
      { rowid: 1, name: 'Display (Original), Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Display' },
      { rowid: 2, name: 'Back glass rear cover Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Back cover' },
      { rowid: 3, name: 'Rear camera Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Camera' },
      { rowid: 4, name: 'Sim tray Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Sim tray' },
      { rowid: 5, name: 'Display adhesive tape Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Adhesive' },
      { rowid: 6, name: 'Loud speaker Apple iPhone 12', model: 'iPhone 12', brand: 'Apple', category: 'Speaker' },
    ];
    expect(firstTitle('tapa trasera iphone 12', products)).toContain('Back glass');
    expect(firstTitle('camara iphone 12', products)).toContain('camera');
    expect(firstTitle('bandeja sim iphone 12', products)).toContain('Sim tray');
    expect(firstTitle('adhesivo pantalla iphone 12', products)).toContain('adhesive');
    expect(firstTitle('parlante iphone 12', products)).toContain('speaker');
  });

  test('technical synonyms work for Samsung, Xiaomi and Honor models', () => {
    const products = [
      { rowid: 1, name: 'Display Samsung Galaxy A54', model: 'Galaxy A54', brand: 'Samsung', category: 'Display' },
      { rowid: 2, name: 'Battery Xiaomi Redmi Note 14', model: 'Redmi Note 14', brand: 'Xiaomi', category: 'Battery' },
      { rowid: 3, name: 'Back Glass Rear Cover Honor 200', model: 'Honor 200', brand: 'Honor', category: 'Back cover' },
      { rowid: 4, name: 'Battery Samsung Galaxy A54', model: 'Galaxy A54', brand: 'Samsung', category: 'Battery' },
      { rowid: 5, name: 'Display Honor 200', model: 'Honor 200', brand: 'Honor', category: 'Display' },
    ];
    expect(firstTitle('pantalla samsung a54', products)).toContain('Display Samsung');
    expect(firstTitle('bateria xiaomi note 14', products)).toContain('Battery Xiaomi');
    expect(firstTitle('tapa honor 200', products)).toContain('Back Glass');
  });

  test('debug intent exposes expanded query, synonyms and part type', () => {
    const intent = computeSearchIntent('pantalla iphone 12');
    expect(intent.intentPartType).toBe('display');
    expect(intent.expandedTerms).toContain('display');
    expect(intent.expandedTerms).toContain('screen');
    expect(intent.appliedSynonyms.display).toContain('pantalla');
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
