const path = require('path');

jest.mock('../db', () => ({ getPool: () => null }));

jest.mock('fs', () => {
  const path = require('path');
  const files = {};
  return {
    __files: files,
    readFileSync: jest.fn((p) => files[path.normalize(p)] || '{}'),
    writeFileSync: jest.fn((p, d) => {
      files[path.normalize(p)] = d;
    }),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    stat: jest.fn((p, cb) => cb(null, { isDirectory: () => false })),
  };
});

jest.mock('../services/mercadoPago', () => ({
  resolveFromWebhook: jest.fn(),
}));

const fs = require('fs');
const { resolveFromWebhook } = require('../services/mercadoPago');
const { processNotification } = require('../routes/mercadoPago');

const productsPath = path.join(__dirname, '../../data/products.json');
const ordersPath = path.join(__dirname, '../../data/orders.json');
const orderItemsPath = path.join(__dirname, '../../data/order_items.json');

beforeEach(() => {
  const files = fs.__files;
  for (const k of Object.keys(files)) delete files[k];
  fs.readFileSync.mockClear();
  fs.writeFileSync.mockClear();
  files[productsPath] = JSON.stringify({
    products: [
      { id: 'p1', sku: 'SKU1', stock: 10, price: 100 },
      { id: 'p2', sku: 'SKU2', stock: 5, price: 50 },
    ],
  });
  files[ordersPath] = JSON.stringify({
    orders: [
      { id: 'ORD1', status: 'pending', total: 0, inventory_applied: false },
      { id: 'ORD2', status: 'pending', total: 0, inventory_applied: false },
    ],
  });
  files[orderItemsPath] = JSON.stringify({ order_items: [] });
});

test('persists items and applies inventory', async () => {
  resolveFromWebhook.mockResolvedValue({
    externalRef: 'ORD1',
    preferenceId: 'pref1',
    status: 'approved',
    email: 'test@test.com',
    items: [
      { sku: 'SKU1', price: 100, qty: 2 },
      { sku: 'SKU2', price: 50, qty: 1 },
    ],
    source: 'metadata',
  });

  await processNotification({
    body: { data: { id: 'pay1' } },
    query: { topic: 'payment', id: 'pay1' },
  });

  const orderItems = JSON.parse(fs.__files[orderItemsPath]).order_items;
  expect(orderItems).toHaveLength(2);
  const orders = JSON.parse(fs.__files[ordersPath]).orders;
  const order = orders.find((o) => o.id === 'ORD1');
  expect(order.total).toBe(250);
  expect(order.inventory_applied).toBe(true);
  const products = JSON.parse(fs.__files[productsPath]).products;
  expect(products.find((p) => p.id === 'p1').stock).toBe(8);
  expect(products.find((p) => p.id === 'p2').stock).toBe(4);

  await processNotification({
    body: { data: { id: 'pay1' } },
    query: { topic: 'payment', id: 'pay1' },
  });

  const orderItems2 = JSON.parse(fs.__files[orderItemsPath]).order_items;
  expect(orderItems2).toHaveLength(2);
  const products2 = JSON.parse(fs.__files[productsPath]).products;
  expect(products2.find((p) => p.id === 'p1').stock).toBe(8);
});

test('fallback merchant order items', async () => {
  resolveFromWebhook.mockResolvedValue({
    externalRef: 'ORD2',
    preferenceId: 'pref2',
    status: 'approved',
    email: 'a@b.com',
    items: [{ sku: 'SKU1', price: 100, qty: 1 }],
    source: 'mo',
  });

  await processNotification({
    body: {},
    query: { topic: 'merchant_order', id: 'mo1' },
  });

  const orderItems = JSON.parse(fs.__files[orderItemsPath]).order_items.filter(
    (it) => it.order_id === 'ORD2'
  );
  expect(orderItems).toHaveLength(1);
});
