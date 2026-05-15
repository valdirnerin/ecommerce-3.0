const {
  computeSearchIntent,
  scoreProductAgainstIntent,
  queryProducts,
  queryAdminProducts,
} = require('../../backend/data/productsSqliteRepo');

const score = (query, product) => scoreProductAgainstIntent(product, computeSearchIntent(query));

describe('product search ranking intent', () => {
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
