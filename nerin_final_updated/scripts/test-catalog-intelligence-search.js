#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

const productsPath = path.resolve(__dirname, "../data/products.json");
const hardeningFixtures = [
  { id: "test-pixel7-display", sku: "PIX7-DISPLAY", name: "Display Original Black Google Pixel 7 Pro", brand: "Google", model: "Pixel 7 Pro", category: "Pantallas", stock: 4, price_minorista: 90000, image: "/assets/product1.png", visibility: "private" },
  { id: "test-pixel7-base-display", sku: "PIX7-BASE-DISPLAY", name: "Display Original Black Google Pixel 7", brand: "Google", model: "Pixel 7", category: "Pantallas", stock: 6, price_minorista: 82000, image: "/assets/product1.png", visibility: "private" },
  { id: "test-pixel6a-battery", sku: "BAT-PIX6A", name: "Battery Compatible for Google Pixel 6a", brand: "for Google", model: "Pixel 6a", category: "Baterias", stock: 8, price_minorista: 35000, image: "/assets/product2.png", visibility: "private" },
  { id: "test-pixel7-lens", sku: "LENS-PIX7", name: "Camera Lens Google Pixel 7", brand: "Google", model: "Pixel 7", category: "Camaras", stock: 5, price_minorista: 12000, image: "/assets/product2.png", visibility: "private" },
  { id: "test-unclassified", sku: "MYSTERY-LOW", name: "Universal Small Parts Kit", category: "Varios", stock: 1, price_minorista: 1000, visibility: "private" },
  { id: "test-display-adhesive", sku: "ADH-IPH16", name: "Display Adhesive Tape for iPhone 16", brand: "for Apple", model: "iPhone 16", category: "Adhesivos", stock: 10, price_minorista: 5000, image: "/assets/product1.png", visibility: "private" },
];

function titleOf(item) {
  return String(item?.title || item?.name || "");
}

async function firstTitle(query, extra = {}) {
  const result = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 10, search: query, debugSearch: true, ...extra });
  assert.ok(result.source === "sqlite_search_index", `${query} debe usar product_search_index`);
  return { result, title: titleOf(result.items[0]) };
}

async function main() {
  const originalProductsJson = await fs.promises.readFile(productsPath, "utf8");
  try {
    const parsed = JSON.parse(originalProductsJson);
    const products = Array.isArray(parsed.products) ? parsed.products : Array.isArray(parsed) ? parsed : [];
    const withoutFixtures = products.filter((product) => !hardeningFixtures.some((fixture) => fixture.id === product.id));
    const nextPayload = Array.isArray(parsed) ? [...withoutFixtures, ...hardeningFixtures] : { ...parsed, products: [...withoutFixtures, ...hardeningFixtures] };
    await fs.promises.writeFile(productsPath, JSON.stringify(nextPayload, null, 2), "utf8");
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

    const adminPixel = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 10, search: "pixel 7 display", debugSearch: true });
    assert.equal(adminPixel.source, "sqlite_search_index_admin", "admin search debe usar product_search_index admin");
    assert.match(titleOf(adminPixel.items[0]), /pixel 7/i, "admin pixel 7 display debe priorizar Pixel display");
    assert.equal(adminPixel.items[0].part_type, "display");

    const adminPixelBattery = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 10, search: "google pixel bateria", debugSearch: true });
    assert.equal(adminPixelBattery.items[0].part_type, "battery", "admin google pixel bateria debe priorizar baterias Pixel");

    const missingModel = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 20, missingModel: "1" });
    assert.ok(missingModel.items.some((item) => item.sku === "MYSTERY-LOW"), "admin missing_model devuelve productos sin modelo");

    const lowConfidence = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 20, lowConfidence: "1" });
    assert.ok(lowConfidence.items.some((item) => item.sku === "MYSTERY-LOW"), "admin low_confidence devuelve productos baja confianza");

    const skuExact = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 10, search: "BAT-PIX6A", debugSearch: true });
    assert.equal(skuExact.items[0].sku, "BAT-PIX6A", "admin SKU exacto prioriza SKU exacto");

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
        admin_pixel_7_display: adminPixel.searchDebug.results.slice(0, 3),
        admin_google_pixel_bateria: adminPixelBattery.searchDebug.results.slice(0, 3),
      },
      facets: pantalla.result.facets,
      adminFacets: adminPixel.facets,
    }, null, 2));
  } finally {
    await fs.promises.writeFile(productsPath, originalProductsJson, "utf8");
    await productsSqliteRepo.rebuildProductsDbFromJson({ force: true, reason: "catalog_intelligence_search_test_restore" }).catch(() => {});
  }
}

main().catch((error) => {
  console.error("[test-catalog-intelligence-search]", error?.stack || error?.message || error);
  process.exit(1);
});
