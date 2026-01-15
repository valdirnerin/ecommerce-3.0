const fs = require("fs");
const path = require("path");
const request = require("supertest");

const tmpDir = path.join(__dirname, "__tmp_validate_analytics__");
const originalDataDir = process.env.DATA_DIR;

function writeJson(file, data) {
  fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data, null, 2), "utf8");
}

async function run() {
  fs.mkdirSync(tmpDir, { recursive: true });
  writeJson("products.json", {
    products: [
      { id: "1", sku: "GH82-12345", name: "Pantalla Samsung A52", category: "Display" },
      { id: "2", sku: "GH82-67890", name: "Batería Samsung S21", category: "Baterías" },
    ],
  });
  writeJson("orders.json", { orders: [] });
  writeJson("returns.json", { returns: [] });
  writeJson("order_items.json", { order_items: [] });
  writeJson("clients.json", { clients: [] });
  writeJson("wholesale_requests.json", { requests: [] });
  writeJson("invoice_uploads.json", { uploads: [] });
  writeJson("invoices.json", { invoices: [] });
  writeJson("activity.json", { sessions: [], events: [] });
  writeJson("analytics_history.json", { days: [] });
  writeJson("config.json", { publicUrl: "https://nerinparts.test" });

  process.env.DATA_DIR = tmpDir;
  delete require.cache[require.resolve("../backend/server")];
  const { createServer } = require("../backend/server");
  const server = createServer();

  try {
    const sessionId = "VAL-SESSION-1";
    const base = { sessionId, userAgent: "validate-script" };
    await request(server).post("/api/analytics/track").send({
      ...base,
      type: "view_item",
      sku: "GH82-12345",
      name: "Pantalla Samsung A52",
      price: 120000,
      currency: "ARS",
      path: "/?utm_source=ads&utm_medium=test",
    });
    await request(server).post("/api/analytics/track").send({
      ...base,
      type: "add_to_cart",
      sku: "GH82-12345",
      name: "Pantalla Samsung A52",
      price: 120000,
      currency: "ARS",
      quantity: 1,
      path: "/cart.html",
    });
    await request(server).post("/api/analytics/track").send({
      ...base,
      type: "begin_checkout",
      items: [
        {
          sku: "GH82-12345",
          name: "Pantalla Samsung A52",
          price: 120000,
          quantity: 1,
          currency: "ARS",
        },
      ],
      total: 120000,
      currency: "ARS",
      path: "/checkout.html",
    });
    await request(server).post("/api/analytics/track").send({
      ...base,
      type: "purchase",
      orderId: "ORD-VAL-1",
      items: [
        {
          sku: "GH82-12345",
          name: "Pantalla Samsung A52",
          price: 120000,
          quantity: 1,
          currency: "ARS",
        },
      ],
      total: 120000,
      currency: "ARS",
      path: "/success",
    });

    const res = await request(server).get("/api/analytics/summary?range=24h");
    if (res.status !== 200) {
      throw new Error(`Summary request failed (${res.status})`);
    }
    const summary = res.body.summary || {};
    const topProduct = summary.topProducts && summary.topProducts[0];
    if (!topProduct || topProduct.name !== "Pantalla Samsung A52") {
      throw new Error("Top products missing expected SKU");
    }
    if (!summary.funnel || summary.funnel.purchase?.count < 1) {
      throw new Error("Funnel missing purchase count");
    }
    if (!summary.conversionRate || summary.conversionRate <= 0) {
      throw new Error("Conversion rate not computed");
    }
    console.log("✅ validate-analytics OK", {
      topProduct,
      conversionRate: summary.conversionRate,
      funnel: summary.funnel,
    });
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env.DATA_DIR = originalDataDir;
  }
}

run().catch((err) => {
  console.error("validate-analytics FAILED", err);
  process.exitCode = 1;
});
