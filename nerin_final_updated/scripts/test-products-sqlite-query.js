const productsSqliteRepo = require("../backend/data/productsSqliteRepo");
const fs = require("fs");
const { dataPath } = require("../backend/utils/dataDir");
const sqlite3 = require("sqlite3");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function timed(label, fn) {
  const startedAt = Date.now();
  const result = await fn();
  const durationMs = Date.now() - startedAt;
  console.log(`[test-products-sqlite-query] ${label} durationMs=${durationMs}`);
  return { result, durationMs };
}

function hasImportedSignal(product = {}) {
  const text = JSON.stringify(product).toLowerCase();
  return (
    text.includes("supplier") ||
    text.includes("import") ||
    text.includes("csv") ||
    text.includes("excel") ||
    Boolean(product?.metadata?.supplierImport)
  );
}

async function main() {
  await productsSqliteRepo.ensureProductsDb();
  const initialManifest = await productsSqliteRepo.getManifestFromDb();
  assert(
    Number(initialManifest?.mappingVersion || 0) === productsSqliteRepo.CATALOG_MAPPING_VERSION,
    "mappingVersion del manifest debe coincidir con CATALOG_MAPPING_VERSION",
  );

  const staleManifest = {
    ...(initialManifest || {}),
    mappingVersion: Math.max(0, Number(productsSqliteRepo.CATALOG_MAPPING_VERSION) - 1),
  };
  fs.writeFileSync(dataPath("products.manifest.json"), JSON.stringify(staleManifest, null, 2), "utf8");
  await timed("ensure db with stale mappingVersion", () => productsSqliteRepo.ensureProductsDb());
  const repairedManifest = await productsSqliteRepo.getManifestFromDb();
  assert(
    Number(repairedManifest?.mappingVersion || 0) === productsSqliteRepo.CATALOG_MAPPING_VERSION,
    "mappingVersion viejo debe forzar rebuild y actualizar manifest",
  );

  const mappedUppercase = productsSqliteRepo.mapProductRow({
    SKU: "GH82-TEST-01",
    Code: "GH82-TEST-01",
    Name: "Galaxy S25 Ultra Batería",
    Price: "12345",
  });
  assert(mappedUppercase.sku === "GH82-TEST-01", "mapper debe leer SKU uppercase");
  assert(mappedUppercase.code === "GH82-TEST-01", "mapper debe leer Code uppercase");
  assert(mappedUppercase.name === "Galaxy S25 Ultra Batería", "mapper debe leer Name uppercase");
  assert(Number(mappedUppercase.price) === 12345, "mapper debe leer Price uppercase");

  const publicByDefault = productsSqliteRepo.isProductPublic({
    SKU: "GH82-DEFAULT",
    Name: "Producto visible por default",
  });
  assert(publicByDefault === true, "productos sin visibility/status deben ser públicos por defecto");

  const health = await timed("catalog health", () => productsSqliteRepo.getCatalogHealth());
  assert(health.result.source === "sqlite", "health source must be sqlite");
  assert(health.result.productCount > 0, "health productCount must be > 0");

  const publicPage1 = await timed("public page=1", () =>
    productsSqliteRepo.queryProducts({ page: 1, pageSize: 24 }),
  );
  assert(publicPage1.result.source === "sqlite", "public page 1 source must be sqlite");
  assert(publicPage1.result.totalItems > 0, "public totalItems must be > 0");
  assert(publicPage1.result.publicProductCount === undefined, "query payload must not include publicProductCount");
  assert(
    health.result.publicProductCount > 125 || health.result.publicProductCount === health.result.productCount,
    "publicProductCount should be > 125 cuando existan más productos válidos",
  );

  const firstPublic = publicPage1.result.items[0] || null;
  assert(firstPublic && firstPublic.publicSlug, "first public product must include publicSlug");
  assert(firstPublic && firstPublic.url, "first public product must include url");

  const byPublicSlug = await timed(`detail by publicSlug=${firstPublic.publicSlug}`, () =>
    productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(firstPublic.publicSlug),
  );
  assert(byPublicSlug.result.product != null, "detail by publicSlug should return product");

  const noSlugProduct = publicPage1.result.items.find((item) => !item.slug && item.publicSlug);
  if (noSlugProduct) {
    const byNoSlug = await timed(`detail product without original slug ${noSlugProduct.publicSlug}`, () =>
      productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(noSlugProduct.publicSlug),
    );
    assert(byNoSlug.result.product != null, "product without original slug must resolve detail");
  }

  const weakContent = publicPage1.result.items.find(
    (item) => (!item.description || item.description.trim().length < 5) || !item.image,
  );
  if (weakContent) {
    const normalized = productsSqliteRepo.normalizeProductForPublic(weakContent);
    assert(normalized.description && normalized.description.length > 10, "fallback description must exist");
    assert(Array.isArray(normalized.images), "normalized images must be an array");
  }

  const adminPage1 = await timed("admin page=1", () =>
    productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 200 }),
  );
  assert(adminPage1.result.source === "sqlite", "admin page source must be sqlite");
  assert(adminPage1.result.totalItems >= publicPage1.result.totalItems, "admin should contain >= public items");

  const importedCandidate =
    adminPage1.result.items.find((item) => hasImportedSignal(item)) ||
    publicPage1.result.items.find((item) => hasImportedSignal(item));
  if (importedCandidate) {
    const importedIdentifier =
      importedCandidate.publicSlug ||
      importedCandidate.slug ||
      importedCandidate.sku ||
      importedCandidate.code ||
      importedCandidate.id;
    const importedDetail = await timed(`detail imported ${importedIdentifier}`, () =>
      productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(importedIdentifier),
    );
    assert(importedDetail.result.product != null, "imported CSV/Excel candidate should resolve detail");
  }

  const productWithRealPrice = adminPage1.result.items.find((item) => {
    const values = [
      item.price_minorista,
      item.price,
      item.precio_minorista,
      item.precio_final,
      item.price_mayorista,
    ];
    return values.some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  });
  assert(productWithRealPrice, "debe existir al menos un producto con precio real > 0");
  const adminPrice = Number(
    productWithRealPrice.price_minorista ??
      productWithRealPrice.price ??
      productWithRealPrice.precio_minorista ??
      productWithRealPrice.precio_final,
  );
  assert(Number.isFinite(adminPrice) && adminPrice > 0, "queryAdminProducts debe devolver precio real > 0");

  const publicById = await timed("public query by id for priced product", () =>
    productsSqliteRepo.queryProducts({
      page: 1,
      pageSize: 1,
      search:
        productWithRealPrice.id ||
        productWithRealPrice.sku ||
        productWithRealPrice.code ||
        productWithRealPrice.publicSlug,
    }),
  );
  const publicPriced = publicById.result.items[0] || null;
  assert(publicPriced, "queryProducts debe devolver el producto con precio");
  const publicPrice = Number(
    publicPriced.price_minorista ??
      publicPriced.price ??
      publicPriced.precio_minorista ??
      publicPriced.precio_final,
  );
  assert(Number.isFinite(publicPrice) && publicPrice > 0, "queryProducts debe devolver precio público correcto");

  const withMinorMayor = adminPage1.result.items.find(
    (item) =>
      Number.isFinite(Number(item.price_minorista)) || Number.isFinite(Number(item.price_mayorista)),
  );
  assert(withMinorMayor, "queryAdminProducts debe incluir price_minorista/price_mayorista cuando existan");

  const visibilityDefaultPublicAudit = await timed("publicity audit", () =>
    productsSqliteRepo.getCatalogPublicityAudit(),
  );
  assert(
    visibilityDefaultPublicAudit.result.productCount >= visibilityDefaultPublicAudit.result.publicProductCount,
    "publicity-audit debe reportar conteos coherentes",
  );
  assert(
    health.result.publicProductCount > 125 || health.result.publicProductCount === health.result.productCount,
    "publicProductCount no debe quedar artificialmente en 125",
  );

  const fieldAudit = await timed("field audit", () => productsSqliteRepo.getCatalogFieldAudit({ sampleSize: 300 }));
  assert(fieldAudit.result.productCount >= fieldAudit.result.publicProductCount, "field-audit: conteos coherentes");
  assert(Array.isArray(fieldAudit.result.topKeys) && fieldAudit.result.topKeys.length > 0, "field-audit debe detectar topKeys");

  const searchGh82 = await timed("debug search GH82", () => productsSqliteRepo.debugCatalogSearch({ search: "GH82" }));
  const hasGh82InRaw = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dataPath("products.sqlite"), (error) => {
      if (error) reject(error);
    });
    db.get(
      "SELECT COUNT(*) AS total FROM products WHERE LOWER(COALESCE(raw_json, '')) LIKE '%gh82%'",
      [],
      (error, row) => {
        db.close(() => {});
        if (error) reject(error);
        else resolve(Number(row?.total || 0) > 0);
      },
    );
  });
  if (hasGh82InRaw) {
    assert(searchGh82.result.totalMatches > 0, "search GH82 debe encontrar productos si existe en raw_json");
  }

  const searchS25 = await timed("debug search S25 ultra", () =>
    productsSqliteRepo.debugCatalogSearch({ search: "S25 ultra" }),
  );
  assert(searchS25.result.totalMatches >= 0, "debug search S25 ultra debe responder");

  const nullPriceMap = productsSqliteRepo.mapProductRow({
    sku: "NO-PRICE-001",
    name: "Producto sin precio",
  });
  assert(nullPriceMap.price === null, "precio faltante debe mapearse a null, no 0");

  const firstTwenty = publicPage1.result.items.slice(0, 20);
  for (const item of firstTwenty) {
    assert(item.url && item.publicSlug, "cada producto de grilla debe incluir url/publicSlug");
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(item.publicSlug);
    assert(found?.product, `detalle debe resolver para ${item.publicSlug}`);
  }

  console.log("[test-products-sqlite-query] ok", {
    productCount: health.result.productCount,
    publicProductCount: health.result.publicProductCount,
    debugSearchGH82: searchGh82.result.totalMatches,
    debugSearchS25Ultra: searchS25.result.totalMatches,
    firstPublicSlug: firstPublic.publicSlug,
    firstPublicUrl: firstPublic.url,
  });
}

main().catch((error) => {
  console.error("[test-products-sqlite-query] failed", error?.message || error);
  process.exit(1);
});
