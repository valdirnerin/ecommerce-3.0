const fs = require('fs');
const os = require('os');
const path = require('path');

function writeFixtureCatalog(dir) {
  const products = [
    {
      id: 'prod-1',
      sku: 'SKU-1',
      code: 'CODE-1',
      slug: 'display-iphone-12',
      public_slug: 'display-iphone-12',
      name: 'Display iPhone 12',
      title: 'Display iPhone 12',
      brand: 'Apple',
      model: 'iPhone 12',
      category: 'Display',
      stock: 10,
      price_minorista: 1000,
      image: '/assets/product1.png',
      visibility: 'public',
      enabled: true,
      is_public: true,
    },
    {
      id: 'prod-2',
      sku: 'SKU-2',
      code: 'CODE-2',
      slug: 'battery-iphone-12',
      public_slug: 'battery-iphone-12',
      name: 'Battery iPhone 12',
      brand: 'Apple',
      model: 'iPhone 12',
      category: 'Battery',
      stock: 6,
      price_minorista: 800,
      image: '/assets/product2.png',
      visibility: 'public',
      enabled: true,
      is_public: true,
    },
    {
      id: 'prod-3',
      sku: 'SKU-3',
      code: 'CODE-3',
      slug: 'speaker-iphone-12',
      public_slug: 'speaker-iphone-12',
      name: 'Speaker iPhone 12',
      brand: 'Apple',
      model: 'iPhone 12',
      category: 'Speaker',
      stock: 4,
      price_minorista: 500,
      image: '/assets/product3.png',
      visibility: 'public',
      enabled: true,
      is_public: true,
    },
  ];
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify({ products }, null, 2));
}

async function setup() {
  jest.resetModules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerin-inventory-'));
  process.env.DATA_DIR = dir;
  writeFixtureCatalog(dir);
  const productsSqliteRepo = require('../data/productsSqliteRepo');
  const ordersRepo = require('../data/ordersRepo');
  const catalogInventoryRepo = require('../data/catalogInventoryRepo');
  await productsSqliteRepo.ensureProductsDbOnce();
  return { dir, productsSqliteRepo, ordersRepo, catalogInventoryRepo };
}

async function createPendingOrder(ordersRepo, overrides = {}) {
  const order = {
    id: overrides.id || 'ORDER-1',
    external_reference: overrides.id || 'ORDER-1',
    payment_method: overrides.payment_method || 'mercado_pago',
    payment_status: 'pendiente',
    payment_status_code: 'pending',
    status: 'pending',
    inventoryApplied: false,
    inventory_applied: false,
    items: overrides.items || [{ product_id: 'prod-1', sku: 'SKU-1', qty: 2, price: 1000 }],
    total: 2000,
    customer_email: 'cliente@example.com',
  };
  return ordersRepo.create(order);
}

describe('catalogInventoryRepo', () => {
  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  test('Mercado Pago pending no descuenta stock', async () => {
    const { productsSqliteRepo, ordersRepo } = await setup();
    await createPendingOrder(ordersRepo, { id: 'MP-PENDING' });
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-1');
    expect(found.product.stock).toBe(10);
  });

  test('approved descuenta stock una sola vez aunque el webhook se duplique', async () => {
    const { productsSqliteRepo, ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, { id: 'MP-APPROVED' });
    const first = await catalogInventoryRepo.applyOrderInventory(order);
    const duplicate = await catalogInventoryRepo.applyOrderInventory(order);
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-1');
    const movements = await catalogInventoryRepo.readMovements({ orderId: 'MP-APPROVED' });
    const updatedOrder = await ordersRepo.getById('MP-APPROVED');
    expect(first.applied).toBe(true);
    expect(duplicate.alreadyApplied).toBe(true);
    expect(found.product.stock).toBe(8);
    expect(movements.filter((m) => m.reason === 'order-approved')).toHaveLength(1);
    expect(updatedOrder.inventory_applied).toBe(true);
  });

  test('refunded/cancelled revierte stock una sola vez si antes se habia descontado', async () => {
    const { productsSqliteRepo, ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, { id: 'MP-REFUND' });
    await catalogInventoryRepo.applyOrderInventory(order);
    const firstRevert = await catalogInventoryRepo.revertOrderInventory(order);
    const duplicateRevert = await catalogInventoryRepo.revertOrderInventory(order);
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-1');
    const movements = await catalogInventoryRepo.readMovements({ orderId: 'MP-REFUND' });
    expect(firstRevert.reverted).toBe(true);
    expect(duplicateRevert.alreadyReverted).toBe(true);
    expect(found.product.stock).toBe(10);
    expect(movements.filter((m) => m.reason === 'order-revert')).toHaveLength(1);
  });

  test('transferencia y efectivo pendientes no descuentan venta final', async () => {
    const { productsSqliteRepo, ordersRepo } = await setup();
    await createPendingOrder(ordersRepo, { id: 'TRANSFER-PENDING', payment_method: 'transferencia' });
    await createPendingOrder(ordersRepo, { id: 'CASH-PENDING', payment_method: 'efectivo' });
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-1');
    expect(found.product.stock).toBe(10);
  });

  test('producto identificado por sku, product_id e id descuenta correctamente', async () => {
    const { productsSqliteRepo, ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, {
      id: 'MIXED-IDENTIFIERS',
      items: [
        { product_id: 'prod-1', qty: 1, price: 1000 },
        { sku: 'SKU-2', qty: 2, price: 800 },
        { id: 'prod-3', qty: 1, price: 500 },
      ],
    });
    await catalogInventoryRepo.applyOrderInventory(order);
    expect((await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('prod-1')).product.stock).toBe(9);
    expect((await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-2')).product.stock).toBe(4);
    expect((await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('prod-3')).product.stock).toBe(3);
  });

  test('si product_id viejo no existe, usa sku valido de la misma linea', async () => {
    const { productsSqliteRepo, ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, {
      id: 'SKU-FALLBACK',
      items: [{ product_id: 'old-product-id', sku: 'SKU-1', qty: 2, price: 1000 }],
    });
    await catalogInventoryRepo.applyOrderInventory(order);
    expect((await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('SKU-1')).product.stock).toBe(8);
  });

  test('despues de descontar, el stock visible cambia en catalogo publico y producto individual', async () => {
    const { productsSqliteRepo, ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, { id: 'VISIBLE-STOCK' });
    await catalogInventoryRepo.applyOrderInventory(order);
    const listing = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 10 });
    const detail = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier('display-iphone-12');
    const listedProduct = listing.items.find((item) => item.sku === 'SKU-1');
    expect(listedProduct.stock).toBe(8);
    expect(detail.product.stock).toBe(8);
  });

  test('debug de inventario muestra items, producto, stock y movimientos', async () => {
    const { ordersRepo, catalogInventoryRepo } = await setup();
    const order = await createPendingOrder(ordersRepo, { id: 'DEBUG-ORDER' });
    await catalogInventoryRepo.applyOrderInventory(order);
    const debug = await catalogInventoryRepo.debugOrderInventory('DEBUG-ORDER');
    expect(debug.orderId).toBe('DEBUG-ORDER');
    expect(debug.source).toBe('sqlite');
    expect(debug.inventory_applied).toBe(true);
    expect(debug.items).toHaveLength(1);
    expect(debug.products[0]).toMatchObject({ found: true, stock: 8, source: 'sqlite' });
    expect(debug.movements).toHaveLength(1);
    expect(debug.errors).toHaveLength(0);
  });
});
