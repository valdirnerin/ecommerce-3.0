const fs = require('fs');
const path = require('path');
const request = require('supertest');

describe('Analíticas detalladas /api/analytics/detailed', () => {
  const tmpDir = path.join(__dirname, '__tmp_analytics__');
  const originalDataDir = process.env.DATA_DIR;
  let server;
  let createServer;

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-07-24T13:20:00Z'));
    fs.mkdirSync(tmpDir, { recursive: true });
    const writeJson = (file, data) => {
      fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data, null, 2), 'utf8');
    };
    writeJson('products.json', {
      products: [
        { id: '1', name: 'Pantalla iPhone 12', category: 'Display', price_minorista: 120000 },
        { id: '2', name: 'Batería Samsung A53', category: 'Baterías', price_minorista: 45000 },
        { id: '3', name: 'Módulo Moto G9', category: 'Display', price_minorista: 80000 },
      ],
    });
    writeJson('orders.json', {
      orders: [
        {
          id: 'ORD-1',
          date: '2025-07-23T16:15:00.000Z',
          total: 152300,
          cliente: { email: 'carlos@nerin.com' },
          productos: [
            { id: '1', price: 120000, quantity: 1 },
            { id: '2', price: 45000, quantity: 1 },
          ],
        },
      ],
    });
    writeJson('returns.json', {
      returns: [
        {
          id: 'RET-1',
          items: [
            { id: '2', quantity: 1 },
          ],
        },
      ],
    });
    writeJson('order_items.json', { order_items: [] });
    writeJson('clients.json', { clients: [] });
    writeJson('wholesale_requests.json', { requests: [] });
    writeJson('invoice_uploads.json', { uploads: [] });
    writeJson('invoices.json', { invoices: [] });
    writeJson('config.json', { publicUrl: 'https://nerinparts.test' });
    writeJson('activity.json', {
      sessions: [
        {
          id: 'SES-1001',
          userEmail: 'carlos@nerin.com',
          userName: 'Carlos López',
          startedAt: '2025-07-24T12:45:00.000Z',
          lastSeenAt: '2025-07-24T13:10:00.000Z',
          status: 'active',
          currentStep: 'checkout_payment',
          cartValue: 152300,
          location: 'CABA',
        },
        {
          id: 'SES-1002',
          userEmail: 'florencia@cliente.com',
          userName: 'Florencia Gómez',
          startedAt: '2025-07-24T12:30:00.000Z',
          lastSeenAt: '2025-07-24T12:50:00.000Z',
          status: 'active',
          currentStep: 'product_page',
          cartValue: 0,
          location: 'Rosario',
        },
        {
          id: 'SES-0995',
          userEmail: 'guest',
          userName: 'Invitado',
          startedAt: '2025-07-24T11:05:00.000Z',
          lastSeenAt: '2025-07-24T11:20:00.000Z',
          status: 'idle',
          currentStep: 'checkout_review',
          cartValue: 84750,
          location: 'La Plata',
        },
      ],
      events: [
        { type: 'page_view', timestamp: '2025-07-24T12:31:00.000Z', sessionId: 'SES-1002', path: '/' },
        { type: 'product_view', timestamp: '2025-07-24T12:32:00.000Z', sessionId: 'SES-1002', productId: '1' },
        { type: 'product_view', timestamp: '2025-07-24T12:33:00.000Z', sessionId: 'SES-1002', productId: '2' },
        { type: 'add_to_cart', timestamp: '2025-07-24T12:34:00.000Z', sessionId: 'SES-1002', productId: '2' },
        { type: 'product_view', timestamp: '2025-07-24T12:35:00.000Z', sessionId: 'SES-1002', productId: '1' },
        { type: 'checkout_start', timestamp: '2025-07-24T12:46:00.000Z', sessionId: 'SES-1001' },
        { type: 'checkout_payment', timestamp: '2025-07-24T13:05:00.000Z', sessionId: 'SES-1001' },
        { type: 'purchase', timestamp: '2025-07-23T16:15:00.000Z', sessionId: 'SES-0943', orderId: 'ORD-1' },
        { type: 'page_view', timestamp: '2025-07-23T10:10:00.000Z', sessionId: 'SES-0940', path: '/shop' },
        { type: 'product_view', timestamp: '2025-07-23T10:12:00.000Z', sessionId: 'SES-0940', productId: '1' },
        { type: 'product_view', timestamp: '2025-07-22T18:40:00.000Z', sessionId: 'SES-0901', productId: '3' },
        { type: 'page_view', timestamp: '2025-07-22T09:05:00.000Z', sessionId: 'SES-0900', path: '/' },
      ],
    });

    process.env.DATA_DIR = tmpDir;
    jest.resetModules();
    ({ createServer } = require('../../backend/server'));
    server = createServer();
  });

  afterAll((done) => {
    jest.useRealTimers();
    process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  test('devuelve métricas extendidas de tráfico y conversión', async () => {
    const res = await request(server).get('/api/analytics/detailed');
    expect(res.status).toBe(200);
    const { analytics } = res.body;
    expect(analytics.activeSessions).toBe(2);
    expect(analytics.checkoutInProgress).toBe(1);
    expect(analytics.activeCarts).toBe(2);
    expect(analytics.visitorsToday).toBe(2);
    expect(analytics.visitorsThisWeek).toBe(6);
    expect(analytics.visitTrend).toHaveLength(7);
    expect(analytics.mostViewedToday.name).toBe('Pantalla iPhone 12');
    expect(analytics.mostViewedWeek.name).toBe('Pantalla iPhone 12');
    expect(analytics.funnel.product_view).toBe(5);
    expect(Array.isArray(analytics.liveSessions)).toBe(true);
    expect(analytics.liveSessions[0]).toHaveProperty('id');
    expect(analytics.recentEvents.length).toBeGreaterThan(0);
    expect(analytics.revenueToday).toBe(0);
    expect(analytics.revenueThisWeek).toBe(152300);
    expect(analytics.ordersThisWeek).toBe(1);
    expect(analytics.conversionRate).toBeCloseTo(1 / 6, 5);
    expect(analytics.cartAbandonmentRate).toBe(0);
    expect(analytics.averageSessionDuration).toBeCloseTo(20, 5);
    expect(analytics.bounceRate).toBeCloseTo(1 / 3, 5);
    expect(analytics.trafficByHour).toHaveLength(24);
    expect(analytics.trafficByHour.find((item) => item.hour === 12).count).toBe(6);
    expect(analytics.topLandingPages[0]).toEqual({ path: '/', count: 2 });
    expect(analytics.peakTrafficHour.label).toBe('12:00');
    expect(analytics.insights.length).toBeGreaterThanOrEqual(3);
  });
});
