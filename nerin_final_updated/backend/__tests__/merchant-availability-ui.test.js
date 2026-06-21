const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

jest.setTimeout(30000);

function writeCatalog(dir) {
  const products = [
    {
      id: "stock-real",
      sku: "STOCK-REAL",
      slug: "stock-real",
      public_slug: "stock-real",
      name: "Display iPhone 12 Stock Real",
      description: "Display original para iPhone 12.",
      brand: "Apple",
      category: "Display",
      stock: 3,
      availability: "in_stock",
      price_minorista: 1000,
      image: "/assets/product1.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
    {
      id: "pedido",
      sku: "PEDIDO-1",
      slug: "pedido",
      public_slug: "pedido",
      name: "Display iPhone 12 A Pedido",
      description: "Display bajo pedido para iPhone 12.",
      brand: "Apple",
      category: "Display",
      stock: 0,
      stock_mode: "remote",
      availability: "backorder",
      remote_lead_min_days: 20,
      remote_lead_max_days: 30,
      availability_date: "2026-07-19",
      price_minorista: 1200,
      image: "/assets/product2.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
    {
      id: "sin-stock",
      sku: "SIN-STOCK",
      slug: "sin-stock",
      public_slug: "sin-stock",
      name: "Battery iPhone 12 Sin Stock",
      description: "Bateria sin stock para iPhone 12.",
      brand: "Apple",
      category: "Battery",
      stock: 0,
      availability: "out_of_stock",
      price_minorista: 900,
      image: "/assets/product3.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
  ];
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify({ products }, null, 2));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ publicUrl: "https://nerinparts.com.ar" }, null, 2));
}

async function withServer(testFn) {
  const previousDataDir = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-merchant-ui-"));
  process.env.DATA_DIR = dir;
  writeCatalog(dir);
  jest.resetModules();
  const { createServer } = require("../server");
  await require("../data/productsSqliteRepo").ensureProductsDbOnce();
  const server = createServer();
  try {
    await testFn(server);
  } finally {
    if (server.close) server.close();
    process.env.DATA_DIR = previousDataDir;
    jest.resetModules();
  }
}

describe("Merchant-safe availability UI", () => {
  test("producto in_stock no muestra fecha Merchant ni availabilityStarts", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/stock-real");
      expect(res.status).toBe(200);
      expect(res.text).toContain("En stock real");
      expect(res.text).toContain("Listo para enviar desde CABA");
      expect(res.text).not.toContain("availabilityStarts");
      expect(res.text).not.toContain("Fecha estimada de despacho:");
      expect(res.text).toContain("https://schema.org/InStock");
    });
  });

  test("producto a pedido muestra fecha exacta visible y JSON-LD availabilityStarts", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/pedido");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Disponible a pedido");
      expect(res.text).toContain("Entrega estimada: 20 a 30 dias");
      expect(res.text).toContain('<time datetime="2026-07-19T00:00:00-03:00">19/07/2026</time>');
      expect(res.text).toContain('"availabilityStarts":"2026-07-19T00:00:00-03:00"');
      expect(res.text).toContain("Primero gestionamos el ingreso del repuesto.");
      expect(res.text).not.toContain("despacho prioritario en 24 h");
    });
  });

  test("producto out_of_stock no genera availabilityStarts ni fecha visible", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/sin-stock");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Sin stock");
      expect(res.text).toContain("Consultanos disponibilidad");
      expect(res.text).toContain("https://schema.org/OutOfStock");
      expect(res.text).not.toContain("availabilityStarts");
      expect(res.text).not.toContain("Fecha estimada de despacho:");
    });
  });

  test("endpoint Andreani mock no usa credenciales ni promete cotizacion real", async () => {
    await withServer(async (server) => {
      const res = await request(server)
        .post("/api/shipping/quote")
        .send({ postalCode: "1001", productId: "stock-real" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        carrier: "Andreani",
        service: "mock",
        isMock: true,
        price: null,
        estimatedDays: null,
        message: "Cotizacion Andreani pendiente de integracion real",
      });
      expect(res.body.futureEnvVars).toContain("ANDREANI_CLIENT_SECRET");
    });
  });
});

describe("Merchant feed availability fields", () => {
  test("in_stock y out_of_stock no emiten availability_date; backorder si", () => {
    const { buildMerchantFeedEntries } = require("../utils/merchantFeed");
    const base = {
      description: "Repuesto para celulares disponible en NERIN Parts.",
      brand: "Apple",
      price_minorista: 1000,
      image: "/assets/product.png",
      visibility: "public",
      enabled: 1,
      is_public: 1,
      raw_json: "{}",
    };
    const rows = [
      { ...base, id: "stock", sku: "STOCK", slug: "stock", public_slug: "stock", name: "Producto en stock", stock: 2, availability: "in_stock" },
      { ...base, id: "pedido", sku: "PEDIDO", slug: "pedido", public_slug: "pedido", name: "Producto a pedido", stock: 0, stock_mode: "remote", availability: "backorder", availability_date: "2026-07-19", remote_lead_min_days: 20, remote_lead_max_days: 30 },
      { ...base, id: "out", sku: "OUT", slug: "out", public_slug: "out", name: "Producto sin stock", stock: 0, availability: "out_of_stock" },
    ];
    const { entries } = buildMerchantFeedEntries(rows, { limit: 10, baseUrl: "https://nerinparts.com.ar" });
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId.STOCK.availability).toBe("in_stock");
    expect(byId.STOCK.availability_date).toBe("");
    expect(byId.PEDIDO.availability).toBe("backorder");
    expect(byId.PEDIDO.availability_date).toBe("2026-07-19T00:00:00-03:00");
    expect(byId.OUT.availability).toBe("out_of_stock");
    expect(byId.OUT.availability_date).toBe("");
  });
});
