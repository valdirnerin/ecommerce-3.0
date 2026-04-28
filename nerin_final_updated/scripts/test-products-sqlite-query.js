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

  const firstTen = publicPage1.result.items.slice(0, 10);
  for (const item of firstTen) {
    assert(item.url && item.publicSlug, "cada producto de grilla debe incluir url/publicSlug");
    const found = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(item.publicSlug);
    assert(found?.product, `detalle debe resolver para ${item.publicSlug}`);
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
