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

  const initialDetail = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(identifier);
  assert(initialDetail?.product, 'No se pudo obtener detalle inicial');
  const original = initialDetail.product;

  const patched = {
    visibility: 'public',
    status: 'active',
    stock: 77,
    seo_title: 'SEO Sync Test',
    title: 'Titulo Sync Test'
  };

  const updated = await productsSqliteRepo.updateProductByIdentifier(identifier, patched);
  assert(updated, 'updateProductByIdentifier no devolvió producto');

  const debug = await productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier(identifier);
  assert(debug?.product, 'No se pudo obtener detalle luego de update');
  const product = debug.product;

  assert(productsSqliteRepo.isProductPublic(product) === true, 'is_public debe recalcularse a true');
  assert(Number(product.stock) === 77, 'stock público debe reflejar update');
  assert((product.seo_title || product.seoTitle || '').includes('SEO Sync Test'), 'seo title debe reflejar update');
  assert((product.title || '').includes('Titulo Sync Test'), 'title debe reflejar update');

  const publicSearch = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, search: identifier });
  const found = (publicSearch.items || []).find((item) =>
    [item.id, item.sku, item.code, item.publicSlug].map((v) => String(v || '')).includes(String(identifier)),
  );
  assert(found, 'producto actualizado debe aparecer en /api/products');
  assert(Number(found.stock) === 77, 'query pública debe reflejar stock actualizado');

  await productsSqliteRepo.updateProductByIdentifier(identifier, {
    visibility: original.visibility,
    status: original.status,
    stock: original.stock,
    seo_title: original.seo_title || original.seoTitle || '',
    title: original.title || original.name || '',
  });

  console.log('[test-products-admin-update-sync] ok identifier=%s', identifier);
}

main().catch((error) => {
  console.error('[test-products-admin-update-sync] fail', error);
  process.exit(1);
});
