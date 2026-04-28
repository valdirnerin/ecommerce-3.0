const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

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

  console.log("[test-products-sqlite-query] ok", {
    productCount: health.result.productCount,
    publicProductCount: health.result.publicProductCount,
    firstPublicSlug: firstPublic.publicSlug,
    firstPublicUrl: firstPublic.url,
  });
}

main().catch((error) => {
  console.error("[test-products-sqlite-query] failed", error?.message || error);
  process.exit(1);
});
