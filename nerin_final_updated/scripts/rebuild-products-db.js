const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

async function main() {
  const startedAt = Date.now();
  await productsSqliteRepo.rebuildProductsDbFromJson();
  const manifest = await productsSqliteRepo.getManifestFromDb();
  console.log("[rebuild-products-db] ok", {
    durationMs: Date.now() - startedAt,
    productCount: manifest?.productCount ?? null,
    sqlitePath: manifest?.sqlitePath || productsSqliteRepo.SQLITE_PATH,
  });
}

main().catch((error) => {
  console.error("[rebuild-products-db] failed", error?.message || error);
  process.exit(1);
});
