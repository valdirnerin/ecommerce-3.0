const productsSqliteRepo = require('../backend/data/productsSqliteRepo');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await productsSqliteRepo.ensureProductsDb();
  const adminPage = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 250 });
  const sample = adminPage.items.find((p) => p && (p.id || p.sku || p.code || p.publicSlug));
  assert(sample, 'No se encontró producto de prueba');
  const identifier = sample.id || sample.sku || sample.code || sample.publicSlug;
  const searchTerm = sample.sku || sample.code || sample.partNumber || sample.mpn || sample.ean || sample.gtin || sample.supplierCode || sample.publicSlug || identifier;

  const initialDetail = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(identifier);
  assert(initialDetail?.product, 'No se pudo obtener detalle inicial');
  const original = initialDetail.product;

  const randomStock = 50 + Math.floor(Math.random() * 50);
  const seoTitleValue = `SEO Sync Test ${Date.now()}`;
  const titleValue = `Titulo Sync Test ${Date.now()}`;

  try {
    const updatedPrivate = await productsSqliteRepo.updateProductByIdentifier(identifier, {
    visibility: 'private',
    status: 'private',
    });
    assert(updatedPrivate, 'No se pudo pasar producto a private');

    const privateDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
    assert(privateDebug?.found === true, 'debug-publication private debe encontrar producto');
    assert(privateDebug.computed?.isPublic === false, 'computed.isPublic debe ser false al poner private');
    assert(Number(privateDebug.sqlite?.is_public) === 0, 'sqlite.is_public debe ser 0 al poner private');
    const privateSearch = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, search: searchTerm });
    const privateFound = (privateSearch.items || []).find((item) =>
      [item.id, item.sku, item.code, item.publicSlug].map((v) => String(v || '')).includes(String(identifier)),
    );
    assert(!privateFound, 'producto private no debe aparecer en query pública');

    const updatedPublic = await productsSqliteRepo.updateProductByIdentifier(identifier, {
    visibility: 'public',
    status: '',
    stock: randomStock,
    seo_title: seoTitleValue,
    title: titleValue,
  });
    assert(updatedPublic, 'No se pudo pasar producto a public');

    const publicDebug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
    assert(publicDebug?.found === true, 'debug-publication public debe encontrar producto');
    assert(publicDebug.computed?.isPublic === true, 'computed.isPublic debe ser true al poner public');
    assert(Number(publicDebug.sqlite?.is_public) === 1, 'sqlite.is_public debe ser 1 al poner public');
    assert(publicDebug.wouldAppearInPublicQuery === true, 'debe aparecer en query pública');

    const publicSearch = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, search: searchTerm });
    const found = (publicSearch.items || []).find((item) =>
      [item.id, item.sku, item.code, item.publicSlug].map((v) => String(v || '')).includes(String(identifier)),
    );
    assert(found, 'producto actualizado debe aparecer en /api/products');
    assert(Number(found.stock) === randomStock, 'query pública debe reflejar stock actualizado');
    assert((found.title || '').includes(titleValue), 'query pública debe reflejar title actualizado');

    const adminSearch = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 20, search: searchTerm });
    const adminFound = (adminSearch.items || [])[0];
    assert(adminFound, 'admin query debe devolver producto actualizado');
    assert(Number(adminFound.stock) === randomStock, 'admin query debe reflejar stock actualizado');

    await productsSqliteRepo.repairPublicFlags();
    const afterRepair = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
    assert(afterRepair?.computed?.isPublic === true, 'no debe perder estado public luego de repair');
    assert((afterRepair.raw?.title || '').includes(titleValue), 'no debe perder title luego de repair');
  } finally {
    await productsSqliteRepo.updateProductByIdentifier(identifier, {
      visibility: original.visibility,
      status: original.status,
      stock: original.stock,
      seo_title: original.seo_title || original.seoTitle || '',
      title: original.title || original.name || '',
    });
  }

  console.log('[test-products-admin-update-sync] ok identifier=%s', identifier);
}

main().catch((error) => {
  console.error('[test-products-admin-update-sync] fail', error);
  process.exit(1);
});
