const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

jest.setTimeout(30000);

function writeCatalog(dir, { excludeBattery = false } = {}) {
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
      availability_date: "2026-07-19",
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
  ].filter((product) => !(excludeBattery && product.id === "iphone-12-battery"));
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify({ products }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ publicUrl: "https://nerinparts.example" }, null, 2), "utf8");
}

async function withServer(testFn, options = {}) {
  const previousDataDir = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-organic-seo-"));
  process.env.DATA_DIR = dir;
  writeCatalog(dir, options);
  jest.resetModules();
  const { createServer } = require("../server");
  const productsSqliteRepo = require("../data/productsSqliteRepo");
  await productsSqliteRepo.ensureProductsDbOnce();
  const server = createServer();
  try {
    await testFn(server);
  } finally {
    if (server.close) server.close();
    if (typeof productsSqliteRepo.closeProductsDbForTests === "function") {
      await productsSqliteRepo.closeProductsDbForTests();
    }
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
      expect(res.text).toContain("<title>Pantalla original Samsung Galaxy A15 | NERIN Parts</title>");
      expect(res.text).toContain("https://schema.org/InStock");
      expect(res.text).not.toContain("availabilityStarts");
      expect(res.text).toContain("En stock real · 5 unidades disponibles");
      expect(res.text).toContain("Agregar al carrito / Comprar ahora");
      expect(res.text).toContain("Consultar compatibilidad por WhatsApp");
      expect(res.text).toContain("Factura A/B disponible");
      expect(res.text).toContain("data-debug-seo=\"1\"");
    });
  });

  test("producto sin stock desactiva compra y publica OutOfStock", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/display-out-of-stock");
      expect(res.status).toBe(200);
      expect(res.text).toContain("https://schema.org/OutOfStock");
      expect(res.text).toContain("Sin stock — compra desactivada");
      expect(res.text).toContain('data-ssr-product-cta="1" disabled');
    });
  });

  test("producto preorder conserva availabilityStarts y fecha visible", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/p/display-iphone-13-pedido");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Disponible a pedido");
      expect(res.text).toContain('<time datetime="2026-07-19T00:00:00-03:00">19/07/2026</time>');
      expect(res.text).toContain('"availabilityStarts":"2026-07-19T00:00:00-03:00"');
      expect(res.text).not.toContain("stock real en CABA. Factura");
    });
  });

  test("sitemap incluye paginas SEO validas y no genera paginas vacias", async () => {
    await withServer(async (server) => {
      const res = await request(server).get("/sitemap-static.xml");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<loc>https://nerinparts.example/stock-real</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/pantallas-en-stock</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/baterias-en-stock</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/repuestos-samsung</loc>");
      expect(res.text).toContain("<loc>https://nerinparts.example/repuestos-iphone</loc>");
      expect(res.text).not.toContain("sin-productos");
    });
  });

  test("/baterias-en-stock vacia responde 200 noindex y deja de estar linkeada", async () => {
    await withServer(async (server) => {
      const landing = await request(server).get("/baterias-en-stock");
      expect(landing.status).toBe(200);
      expect(landing.text).toContain('name="robots" content="noindex,follow"');
      expect(landing.text).toContain('rel="canonical" href="https://nerinparts.example/baterias-en-stock"');

      const home = await request(server).get("/");
      expect(home.status).toBe(200);
      expect(home.text).not.toContain('href="/baterias-en-stock"');

      const sitemap = await request(server).get("/sitemap-static.xml");
      expect(sitemap.text).not.toContain("/baterias-en-stock</loc>");
    }, { excludeBattery: true });
  });

  test("feeds Merchant separan stock real y productos a pedido", async () => {
    await withServer(async (server) => {
      const main = await request(server).get("/merchant-feed.tsv?limit=20");
      expect(main.status).toBe(200);
      expect(main.text).toContain("SAM-A15-DISPLAY");
      expect(main.text).toContain("IPH12-BAT");
      expect(main.text).not.toContain("PEDIDO-SEO");
      expect(main.text).not.toContain("OUT-SEO");
      expect(main.text).not.toMatch(/\t(preorder|backorder|out_of_stock)\t/);

      const preorder = await request(server).get("/merchant-feed-preorder.tsv?limit=20");
      expect(preorder.status).toBe(200);
      expect(preorder.text).toContain("PEDIDO-SEO");
      expect(preorder.text).toContain("2026-07-19T00:00:00-03:00");
      expect(preorder.text).not.toContain("SAM-A15-DISPLAY");
      expect(preorder.text).not.toContain("OUT-SEO");
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
