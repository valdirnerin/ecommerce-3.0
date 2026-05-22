const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");
const {
  computeOrganicSeoPriority,
  matchesOrganicPage,
} = require("../backend/utils/organicSeo");
const { getPublicPriceValue } = require("../backend/utils/productAvailability");

function openReadonly(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function parseRow(row = {}) {
  let raw = {};
  try {
    raw = row.raw_json ? JSON.parse(row.raw_json) : {};
  } catch {
    raw = {};
  }
  const product = { ...raw };
  for (const [key, value] of Object.entries(row)) {
    if (key === "raw_json" || key === "rowid") continue;
    if (value !== undefined && value !== null && value !== "") product[key] = value;
  }
  if (row.public_slug && !product.publicSlug) product.publicSlug = row.public_slug;
  return product;
}

async function main() {
  await productsSqliteRepo.ensureProductsDbOnce();
  const db = await openReadonly(productsSqliteRepo.SQLITE_PATH);
  try {
    const rows = await all(db, `
      SELECT rowid, id, sku, code, slug, public_slug, image, name, title,
             brand, model, category, status, visibility, stock, price, price_minorista,
             precio_minorista, precio_final, part_number, mpn, raw_json, is_public
      FROM products
      WHERE is_public = 1
      ORDER BY rowid ASC
    `);
    const products = rows.map(parseRow);
    const report = {
      totalPublicProducts: products.length,
      seoPagesCreated: [],
      blockedMissingImage: [],
      blockedMissingPrice: [],
      blockedMissingSlug: [],
      doubtfulBrandProducts: [],
      productsWithoutEnoughStructuredData: [],
      topOrganicPriorityProducts: [],
      keywordRecommendations: [],
    };
    const pageKeys = [
      ["stock-real", "/stock-real"],
      ["pantallas-en-stock", "/pantallas-en-stock"],
      ["baterias-en-stock", "/baterias-en-stock"],
      ["repuestos-samsung", "/repuestos-samsung"],
      ["repuestos-iphone", "/repuestos-iphone"],
    ];
    for (const [key, path] of pageKeys) {
      const count = products.filter((product) => matchesOrganicPage(product, key)).length;
      if (count > 0) report.seoPagesCreated.push({ path, productCount: count });
    }
    const priorities = [];
    for (const product of products) {
      const seo = computeOrganicSeoPriority(product);
      const entry = {
        id: product.id || null,
        sku: product.sku || "",
        title: product.name || product.title || "",
        slug: product.publicSlug || product.public_slug || product.slug || "",
        stock: Number(product.stock || 0),
        price: getPublicPriceValue(product),
        priorityScore: seo.priorityScore,
        targetKeywords: seo.targetKeywords,
        blockers: seo.blockers,
      };
      if (seo.blockers.includes("missing_image")) report.blockedMissingImage.push(entry);
      if (seo.blockers.includes("missing_price")) report.blockedMissingPrice.push(entry);
      if (seo.blockers.includes("missing_slug")) report.blockedMissingSlug.push(entry);
      if (seo.blockers.includes("missing_brand")) report.doubtfulBrandProducts.push(entry);
      if (seo.blockers.includes("missing_image") || seo.blockers.includes("missing_price") || seo.blockers.includes("missing_slug")) {
        report.productsWithoutEnoughStructuredData.push(entry);
      }
      if (seo.isOrganicPriority) priorities.push(entry);
    }
    priorities.sort((a, b) => b.priorityScore - a.priorityScore || b.stock - a.stock);
    report.topOrganicPriorityProducts = priorities.slice(0, 20);
    report.keywordRecommendations = priorities.slice(0, 20).map((entry) => ({
      title: entry.title,
      slug: entry.slug,
      keywords: entry.targetKeywords,
    }));
    report.blockedMissingImage = report.blockedMissingImage.slice(0, 20);
    report.blockedMissingPrice = report.blockedMissingPrice.slice(0, 20);
    report.blockedMissingSlug = report.blockedMissingSlug.slice(0, 20);
    report.doubtfulBrandProducts = report.doubtfulBrandProducts.slice(0, 20);
    report.productsWithoutEnoughStructuredData = report.productsWithoutEnoughStructuredData.slice(0, 20);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[audit-organic-seo-stock-real] failed", error);
  process.exitCode = 1;
});
