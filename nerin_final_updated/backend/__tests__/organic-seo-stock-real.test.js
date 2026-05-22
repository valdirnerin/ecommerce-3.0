const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

function writeCatalog(dir) {
  const products = [
    {
      id: "sam-a15-display",
      sku: "SAM-A15-DISPLAY",
      slug: "pantalla-samsung-galaxy-a15",
      public_slug: "pantalla-samsung-galaxy-a15",
      name: "Pantalla Samsung Galaxy A15 Original",
      description: "Display para Samsung Galaxy A15.",
      brand: "Samsung",
      model: "Galaxy A15",
      category: "Display",
      stock: 5,
      availability: "in_stock",
      price_minorista: 71500,
      image: "/assets/product1.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
    {
      id: "iphone-12-battery",
      sku: "IPH12-BAT",
      slug: "bateria-iphone-12",
      public_slug: "bateria-iphone-12",
      name: "Bateria Apple iPhone 12",
      description: "Battery para iPhone 12.",
      brand: "Apple",
      model: "iPhone 12",
      category: "Battery",
      stock: 4,
      availability: "in_stock",
      price_minorista: 35000,
      image: "/assets/product2.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
    {
      id: "pedido",
      sku: "PEDIDO-SEO",
      slug: "display-iphone-13-pedido",
      public_slug: "display-iphone-13-pedido",
      name: "Display Apple iPhone 13 A Pedido",
      description: "Display bajo pedido para iPhone 13.",
      brand: "Apple",
      model: "iPhone 13",
      category: "Display",
      stock: 0,
      stock_mode: "remote",
      availability: "backorder",
      remote_lead_min_days: 20,
      remote_lead_max_days: 30,
      availability_date: "2026-06-19",
      price_minorista: 1200,
      image: "/assets/product3.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
    {
      id: "out",
      sku: "OUT-SEO",
      slug: "display-out-of-stock",
      public_slug: "display-out-of-stock",
      name: "Pantalla Sin Stock",
      description: "Display sin stock.",
      brand: "Samsung",
      model: "Galaxy A16",
      category: "Display",
      stock: 0,
      availability: "out_of_stock",
      price_minorista: 2000,
      image: "/assets/product4.png",
      visibility: "public",
      enabled: true,
      is_public: true,
    },
  ];
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify({ products }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ publicUrl: "https://nerinparts.example" }, null, 2), "utf8");
}

async function withServer(testFn) {
  const previousDataDir = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-organic-seo-"));
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

describe("organic stock-real SEO", () => {
  test("/stock-real solo muestra productos con stock real", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/stock-real");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Repuestos para celulares en stock real");
      expect(res.text).toContain("Pantalla Samsung Galaxy A15 Original");
      expect(res.text).toContain("Bateria Apple iPhone 12");
      expect(res.text).not.toContain("Pantalla Sin Stock");
      expect(res.text).not.toContain("Display Apple iPhone 13 A Pedido");
    });
  });

  test("/pantallas-en-stock solo muestra pantallas en stock", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/pantallas-en-stock");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Pantallas para celulares en stock");
      expect(res.text).toContain("Pantalla Samsung Galaxy A15 Original");
      expect(res.text).not.toContain("Bateria Apple iPhone 12");
      expect(res.text).not.toContain("Pantalla Sin Stock");
    });
  });

  test("producto in_stock tiene JSON-LD InStock y titulo organico", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/pantalla-samsung-galaxy-a15?debugSeo=1");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>Pantalla Samsung Galaxy A15 en stock | NERIN Parts</title>");
      expect(res.text).toContain("https://schema.org/InStock");
      expect(res.text).not.toContain("availabilityStarts");
      expect(res.text).toContain("data-debug-seo=\"1\"");
    });
  });

  test("producto preorder conserva availabilityStarts y fecha visible", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/display-iphone-13-pedido");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Disponible a pedido");
      expect(res.text).toContain('<time datetime="2026-06-19T00:00:00-03:00">19/06/2026</time>');
      expect(res.text).toContain('"availabilityStarts":"2026-06-19T00:00:00-03:00"');
      expect(res.text).not.toContain("stock real en CABA. Factura");
    });
  });

  test("sitemap incluye paginas SEO validas y no genera paginas vacias", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<loc>https://nerinparts.example/stock-real</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/pantallas-en-stock</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/baterias-en-stock</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/repuestos-samsung</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/repuestos-iphone</loc>");
      expect(res.text).not.toContain("sin-productos");
    });
  });

  test("endpoint free listings priority resume bloqueos y top organico", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/api/catalog/free-listings-priority?limit=20");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.eligibleInStockProducts).toBeGreaterThanOrEqual(2);
      expect(res.body.topOrganicPriorityProducts[0].title).toContain("Samsung Galaxy A15");
    });
  });
});
