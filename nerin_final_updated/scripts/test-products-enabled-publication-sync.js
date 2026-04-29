const assert = require('assert');
const productsSqliteRepo = require('../backend/data/productsSqliteRepo');

(async () => {
  await productsSqliteRepo.ensureProductsDb();
  const identifier = 'GH82-36387A';
  let debug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
  let targetIdentifier = identifier;

  if (!debug?.found) {
    const admin = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 1 });
    assert(admin.items.length > 0, 'sin productos para test');
    targetIdentifier = admin.items[0].id || admin.items[0].sku;
    await productsSqliteRepo.updateProductByIdentifier(targetIdentifier, {
      sku: identifier,
      name: 'Display Samsung S25 Ultra',
      visibility: 'public',
      enabled: false,
      status: 'active',
    });
    targetIdentifier = identifier;
  }

  const initialPublic = await productsSqliteRepo.getCatalogHealth();
  await productsSqliteRepo.updateProductByIdentifier(targetIdentifier, { visibility: 'public', status: 'active' });
  await productsSqliteRepo.updateProductByIdentifier(targetIdentifier, {
    enabled: false,
    status: 'active',
  });
  const privateDebug = await productsSqliteRepo.debugPublicationByIdentifier(targetIdentifier);
  assert.equal(privateDebug.computed.isPublic, false);
  assert.equal(privateDebug.computed.reason, 'enabled_false');

  await productsSqliteRepo.updateProductByIdentifier(targetIdentifier, { visibility: 'public' });
  const publicDebug = await productsSqliteRepo.debugPublicationByIdentifier(targetIdentifier);
  assert.equal(publicDebug.computed.isPublic, true);
  assert.equal(publicDebug.computed.reason, 'public');

  const searchableDebug = await productsSqliteRepo.debugPublicationByIdentifier(targetIdentifier);
  assert.equal(searchableDebug.wouldAppearInPublicQuery, true, 'no aparece en query pública');

  const afterPublic = await productsSqliteRepo.getCatalogHealth();
  assert(Number(afterPublic.publicProductCount) >= Number(initialPublic.publicProductCount), 'publicProductCount no subió o se mantuvo');

  await productsSqliteRepo.updateProductByIdentifier(targetIdentifier, { visibility: 'private' });
  const finalDebug = await productsSqliteRepo.debugPublicationByIdentifier(targetIdentifier);
  assert.equal(finalDebug.computed.isPublic, false);

  console.log('OK test-products-enabled-publication-sync');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
