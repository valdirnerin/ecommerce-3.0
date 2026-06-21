const {
  deduplicateCatalogProducts,
  sortCatalogProducts,
} = require('../../backend/utils/catalogVisibility');

describe('catalog visibility', () => {
  test('orden recomendado: stock real, a pedido y sin stock', () => {
    const products = [
      { id: 'out', name: 'Sin stock', slug: 'out', stock: 0, availability: 'out_of_stock', price: 100, image: '/out.jpg' },
      { id: 'remote', name: 'A pedido', slug: 'remote', stock: 0, stock_mode: 'remote', price: 100, image: '/remote.jpg' },
      { id: 'real', name: 'Stock real', slug: 'real', stock: 3, price: 100, image: '/real.jpg' },
    ];
    expect(sortCatalogProducts(products).map((product) => product.id)).toEqual(['real', 'remote', 'out']);
  });

  test('elimina duplicados por MPN, SKU, slug o título normalizado', () => {
    const products = [
      { id: 'a', mpn: 'GH82-30480E', sku: 'A', slug: 'pantalla-a', name: 'Pantalla A' },
      { id: 'b', mpn: 'gh82 30480e', sku: 'B', slug: 'pantalla-b', name: 'Pantalla B' },
      { id: 'c', sku: 'A', slug: 'pantalla-c', name: 'Pantalla C' },
      { id: 'd', sku: 'D', slug: 'pantalla-a', name: 'Pantalla D' },
      { id: 'e', sku: 'E', slug: 'pantalla-e', name: 'Pántalla A' },
      { id: 'f', sku: 'F', slug: 'pantalla-f', name: 'Pantalla F' },
    ];
    expect(deduplicateCatalogProducts(products).map((product) => product.id)).toEqual(['a', 'f']);
  });
});
