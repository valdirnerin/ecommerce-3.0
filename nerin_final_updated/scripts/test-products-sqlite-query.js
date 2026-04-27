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

async function main() {
  await productsSqliteRepo.ensureProductsDb();

  const publicPage1 = await timed("public page=1", () =>
    productsSqliteRepo.queryProducts({ page: 1, pageSize: 24 }),
  );
  assert(publicPage1.result.source === "sqlite", "public page 1 source must be sqlite");
  assert(publicPage1.result.totalItems > 0, "public totalItems must be > 0");

  const publicPage2 = await timed("public page=2", () =>
    productsSqliteRepo.queryProducts({ page: 2, pageSize: 24 }),
  );
  assert(publicPage2.result.page === 2, "public page 2 must return page=2");

  const firstPublic = publicPage1.result.items[0] || null;
  const searchTerm = String(firstPublic?.brand || firstPublic?.name || "").split(" ")[0].trim();
  if (searchTerm) {
    const searched = await timed(`public search=${searchTerm}`, () =>
      productsSqliteRepo.queryProducts({ page: 1, pageSize: 24, search: searchTerm }),
    );
    assert(Array.isArray(searched.result.items), "public search must return items array");
  }

  const adminPage1 = await timed("admin page=1", () =>
    productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 100 }),
  );
  assert(adminPage1.result.source === "sqlite", "admin page source must be sqlite");

  const adminSearchTerm =
    String(adminPage1.result.items[0]?.sku || adminPage1.result.items[0]?.name || "")
      .split(" ")[0]
      .trim();
  if (adminSearchTerm) {
    const adminSearch = await timed(`admin search=${adminSearchTerm}`, () =>
      productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 100, search: adminSearchTerm }),
    );
    assert(adminSearch.result.totalItems >= 1, "admin search should find at least one result");
  }

  const slugCandidate = adminPage1.result.items.find((item) => item?.slug);
  if (slugCandidate?.slug) {
    const bySlug = await timed(`getBySlug=${slugCandidate.slug}`, () =>
      productsSqliteRepo.getProductBySlug(slugCandidate.slug),
    );
    assert(bySlug.result != null, "getProductBySlug should return product for known slug");
  }

  console.log("[test-products-sqlite-query] ok");
}

main().catch((error) => {
  console.error("[test-products-sqlite-query] failed", error?.message || error);
  process.exit(1);
});
