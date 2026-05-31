const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

function parseArgs(argv = []) {
  const params = {};
  for (const arg of argv) {
    const match = String(arg || "").match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === "partType") params.partType = value;
    else if (key === "stock") params.stockStatus = value;
    else if (key === "page" || key === "pageSize") params[key] = Number(value);
    else params[key] = value;
  }
  return params;
}

async function main() {
  const params = {
    page: 1,
    pageSize: 50,
    sort: "recent",
    ...parseArgs(process.argv.slice(2)),
    debugQueryPlan: true,
  };
  const result = await productsSqliteRepo.queryAdminProducts(params);
  console.log(JSON.stringify({
    dbPath: process.env.DATABASE_PATH || "DATA_DIR/products.sqlite",
    page: result.page,
    pageSize: result.pageSize,
    totalItems: result.totalItems,
    rows: Array.isArray(result.items) ? result.items.length : 0,
    countMs: result.countMs,
    selectMs: result.selectMs,
    mapMs: result.mapMs,
    facetMs: result.facetMs,
    totalDurationMs: result.totalDurationMs,
    queryPlan: result.queryPlan,
  }, null, 2));
  await productsSqliteRepo.closeProductsDbForTests();
}

main().catch(async (error) => {
  console.error("[explain-admin-products-query] failed", error);
  try {
    await productsSqliteRepo.closeProductsDbForTests();
  } catch {}
  process.exit(1);
});
