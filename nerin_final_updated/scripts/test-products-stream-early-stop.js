const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  getProductsEmergencyPage,
  getProductBySlug,
} = require("../backend/data/productsStreamRepo");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildProduct(index) {
  return {
    id: String(index + 1),
    name: `Producto ${index + 1}`,
    slug: `producto-${index + 1}`,
    sku: `SKU-${index + 1}`,
    price_minorista: 1000 + index,
    stock: index % 20,
    visibility: "public",
  };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-products-stream-"));
  const filePath = path.join(tmpDir, "products.json");
  const productCount = 10000;
  const products = Array.from({ length: productCount }, (_, index) => buildProduct(index));
  fs.writeFileSync(filePath, JSON.stringify({ products }), "utf8");

  const page1Start = Date.now();
  const page1 = await getProductsEmergencyPage({ page: 1, pageSize: 24, filePath });
  const page1Duration = Date.now() - page1Start;
  assert(Array.isArray(page1.items) && page1.items.length === 24, "page=1 debe devolver 24 items");
  assert(page1.hasNextPage === true, "page=1 debe informar hasNextPage=true");
  assert(page1.matchedCount < productCount, "page=1 no debe escanear los 10.000 productos");

  const page2Start = Date.now();
  const page2 = await getProductsEmergencyPage({ page: 2, pageSize: 24, filePath });
  const page2Duration = Date.now() - page2Start;
  assert(Array.isArray(page2.items) && page2.items.length === 24, "page=2 debe devolver 24 items");
  assert(page2.hasNextPage === true, "page=2 debe informar hasNextPage=true");
  assert(page2.matchedCount < productCount, "page=2 no debe escanear los 10.000 productos");

  const slugNearStart = "producto-5";
  const slugNearStartStart = Date.now();
  const foundEarly = await getProductBySlug(slugNearStart, { filePath });
  const slugNearStartDuration = Date.now() - slugNearStartStart;
  assert(foundEarly && foundEarly.slug === slugNearStart, "getProductBySlug debe encontrar un slug cercano al inicio");

  const missingSlugStart = Date.now();
  const notFound = await getProductBySlug("slug-inexistente-total", { filePath });
  const missingSlugDuration = Date.now() - missingSlugStart;
  assert(notFound === null, "getProductBySlug inexistente debe devolver null");

  console.log("[test-products-stream-early-stop] ok", {
    filePath,
    productCount,
    page1: {
      durationMs: page1Duration,
      matchedCount: page1.matchedCount,
      hasNextPage: page1.hasNextPage,
    },
    page2: {
      durationMs: page2Duration,
      matchedCount: page2.matchedCount,
      hasNextPage: page2.hasNextPage,
    },
    slugNearStart: {
      durationMs: slugNearStartDuration,
      slug: foundEarly.slug,
    },
    missingSlug: {
      durationMs: missingSlugDuration,
      found: notFound,
    },
  });
}

main().catch((error) => {
  console.error("[test-products-stream-early-stop] failed", error);
  process.exit(1);
});
