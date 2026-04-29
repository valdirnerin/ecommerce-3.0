const assert = require("assert");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

(async () => {
  await productsSqliteRepo.ensureProductsDb();
  const identifier = "GH82-36387A";

  const beforeHealth = await productsSqliteRepo.getCatalogHealth();
  let originalDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
  if (!originalDebug?.found) {
    const admin = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 1 });
    assert(admin.items.length > 0, "sin productos base para preparar test");
    const seedIdentifier = admin.items[0].id || admin.items[0].sku || admin.items[0].code;
    await productsSqliteRepo.updateProductByIdentifier(seedIdentifier, {
      sku: identifier,
      code: identifier,
      name: "Display Samsung S25 Ultra",
      visibility: "private",
      enabled: false,
      status: "active",
    });
    originalDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
  }
  assert.equal(originalDebug?.found, true, "GH82-36387A debe existir en SQLite");

  const originalRaw = originalDebug.raw || {};
  const restorePatch = {
    visibility: originalRaw.visibility ?? null,
    status: originalRaw.status ?? null,
    enabled: originalRaw.enabled,
  };

  await productsSqliteRepo.updateProductByIdentifier(identifier, {
    sku: identifier,
    name: "Display Samsung S25 Ultra",
    visibility: "public",
    enabled: true,
    status: "active",
  });
  await productsSqliteRepo.updateProductByIdentifier(identifier, { enabled: false });
  const beforePublishHealth = await productsSqliteRepo.getCatalogHealth();

  const initialDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
  assert.equal(initialDebug.computed.isPublic, false, "estado inicial debe ser no público");
  assert.equal(initialDebug.computed.reason, "enabled_false", "reason inicial esperado");

  await productsSqliteRepo.updateProductByIdentifier(identifier, { visibility: "public" });

  const afterPublishDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
  assert.equal(afterPublishDebug.sqlite.visibility, "public", "sqlite.visibility debe ser public");
  assert.equal(Number(afterPublishDebug.sqlite.enabled), 1, "sqlite.enabled debe ser 1");
  assert.equal(Number(afterPublishDebug.sqlite.is_public), 1, "sqlite.is_public debe ser 1");
  assert.equal(afterPublishDebug.computed.isPublic, true, "computed.isPublic debe ser true");
  assert.equal(afterPublishDebug.wouldAppearInPublicQuery, true, "debe aparecer en query pública");
  assert.equal(afterPublishDebug.wouldMatchSearch, true, "debe matchear search_text");

  const searchDebug = await productsSqliteRepo.debugCatalogSearch(identifier);
  assert.notEqual(searchDebug.diagnosis, "matchea_pero_is_public_0", "search no debe quedar bloqueado por is_public=0");

  const afterHealth = await productsSqliteRepo.getCatalogHealth();
  assert(
    Number(afterHealth.publicProductCount) >= Number(beforePublishHealth.publicProductCount) + 1,
    "publicProductCount debe subir +1",
  );

  await productsSqliteRepo.updateProductByIdentifier(identifier, restorePatch);
  console.log("OK test-products-enabled-publication-sync", {
    beforePublicProductCount: Number(beforeHealth.publicProductCount),
    beforePublishPublicProductCount: Number(beforePublishHealth.publicProductCount),
    afterPublicProductCount: Number(afterHealth.publicProductCount),
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
