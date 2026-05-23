#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

function titleOf(item) {
  return String(item?.title || item?.name || "");
}

async function firstTitle(query, extra = {}) {
  const result = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 10, search: query, debugSearch: true, ...extra });
  assert.ok(result.source === "sqlite_search_index", `${query} debe usar product_search_index`);
  return { result, title: titleOf(result.items[0]) };
}

async function main() {
  await productsSqliteRepo.rebuildProductsDbFromJson({ force: true, reason: "catalog_intelligence_search_test" });

  const pantalla = await firstTitle("pantalla iphone 12");
  assert.match(pantalla.title, /iphone/i);
  assert.match(pantalla.title, /12/i);
  assert.equal(pantalla.result.items[0].part_type, "display");
  assert.ok(!/mini|pro max/i.test(pantalla.title), "iphone 12 base no debe arrancar con mini/pro max");

  const display = await firstTitle("display iphone 12");
  assert.equal(display.result.items[0].part_type, "display");

  const modulo = await firstTitle("modulo iphone 12");
  assert.equal(modulo.result.items[0].part_type, "display");

  const bateria = await firstTitle("bateria iphone 12");
  assert.equal(bateria.result.items[0].part_type, "battery");

  const samsungA16 = await firstTitle("display samsung a16 4g");
  assert.match(samsungA16.title, /a16/i);
  assert.equal(samsungA16.result.items[0].network_variant, "4g");

  const displayFilter = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, partType: "display" });
  assert.ok(displayFilter.items.length > 0, "filtro display debe devolver resultados");
  assert.ok(displayFilter.items.every((item) => item.part_type === "display"), "part_type=display solo devuelve displays");

  const stockFilter = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, stockStatus: "in_stock" });
  assert.ok(stockFilter.items.length > 0, "filtro stock real debe devolver resultados");
  assert.ok(stockFilter.items.every((item) => item.is_stock_real === true), "stock_status=in_stock solo devuelve stock real");

  const samsungFilter = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, deviceBrand: "Samsung" });
  assert.ok(samsungFilter.items.length > 0, "filtro Samsung debe devolver resultados");
  assert.ok(samsungFilter.items.every((item) => item.device_brand === "Samsung" || item.compatible_brand === "Samsung"), "device_brand=Samsung respeta marca/compatibilidad");

  const modelFilter = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, modelBase: "iPhone 12" });
  assert.ok(modelFilter.items.length > 0, "filtro iPhone 12 debe devolver resultados");
  assert.ok(modelFilter.items.every((item) => item.model_base === "iPhone 12"), "model_base=iPhone 12 no devuelve otros modelos");

  const frameFilter = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 20, partType: "display", hasFrame: "true" });
  assert.ok(frameFilter.items.length > 0, "has_frame=true debe devolver displays con marco en fixtures");
  assert.ok(frameFilter.items.every((item) => item.has_frame === true), "has_frame=true solo devuelve productos con marco");

  const noCrashQueries = [
    "pin de carga samsung a54",
    "display samsung a15 5g",
    "tapa honor 200",
    "sim tray iphone 15 pro",
    "camara iphone 15 pro max",
    "adhesivo pantalla iphone 16",
    "macbook air 13 2020 display",
  ];
  for (const query of noCrashQueries) {
    const result = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 10, search: query, debugSearch: true });
    assert.ok(result.facets && typeof result.facets === "object", `${query} debe devolver facets`);
    assert.ok(result.searchDebug?.engine === "product_search_index", `${query} debe devolver debug avanzado`);
  }

  console.log(JSON.stringify({
    ok: true,
    examples: {
      pantalla_iphone_12: pantalla.result.searchDebug.results.slice(0, 3),
      bateria_iphone_12: bateria.result.searchDebug.results.slice(0, 3),
      display_samsung_a16_4g: samsungA16.result.searchDebug.results.slice(0, 3),
    },
    facets: pantalla.result.facets,
  }, null, 2));
}

main().catch((error) => {
  console.error("[test-catalog-intelligence-search]", error?.stack || error?.message || error);
  process.exit(1);
});
