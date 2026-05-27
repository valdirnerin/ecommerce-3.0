#!/usr/bin/env node
"use strict";

const {
  writeAuditCsv,
  buildFeed,
} = require("../backend/services/screenPublicationService");

function countBlockers(summary, names) {
  return names.reduce((total, name) => total + Number(summary.blockersBreakdown?.[name] || 0), 0);
}

function topEntries(map = {}, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
}

function printSamples(title, samples = [], limit = 15) {
  console.log(`\n${title}`);
  const list = samples.slice(0, limit);
  if (!list.length) {
    console.log("- none");
    return;
  }
  for (const item of list) {
    const why = item.blockers?.length ? ` | blockers=${item.blockers.join("|")}` : "";
    console.log(`- ${item.sku || item.id || "sin-id"} | ${item.title || "sin-titulo"}${why}`);
  }
}

async function main() {
  const { screens, adhesives, exportDir } = await writeAuditCsv();
  const screensFeed = await buildFeed("screen", { limit: 100000 });
  const adhesivesFeed = await buildFeed("screen_adhesive", { limit: 100000 });

  const screenEligible = screens.items.filter((item) => item.eligible);
  const adhesiveEligible = adhesives.items.filter((item) => item.eligible);

  const screenAccessoryBlocked = countBlockers(screens, ["likelyAccessory", "display_adhesive", "adhesive_display", "bracket_display", "screen_protector", "case_cover"]);
  const adhesiveNotScreenBlocked = countBlockers(adhesives, ["notScreenAdhesive", "genericAdhesiveWithoutModel", "battery_adhesive", "back_cover_adhesive", "camera_adhesive", "audio_adhesive"]);

  console.log("NERIN final screens and screen adhesives audit");
  console.log(`exportsDir=${exportDir}`);
  console.log(`total productos=${screens.totalProducts}`);
  console.log(`pantallas detectadas totales=${screens.totalScreensDetected || 0}`);
  console.log(`pantallas publicas actuales=${screens.publicScreensCurrent || 0}`);
  console.log(`pantallas privadas elegibles=${screens.privateScreensEligible || 0}`);
  console.log(`pantallas ocultas elegibles=${screens.hiddenScreensEligible || 0}`);
  console.log(`pantallas stock real elegibles=${screens.stockRealScreensEligible || 0}`);
  console.log(`pantallas a pedido elegibles=${screens.remoteScreensEligible || 0}`);
  console.log(`pantallas bloqueadas por imagen=${screens.blockersBreakdown?.missingImage || 0}`);
  console.log(`pantallas bloqueadas por precio=${screens.blockersBreakdown?.missingPrice || 0}`);
  console.log(`pantallas bloqueadas por Merchant=${countBlockers(screens, ["merchantAvailabilityDateMissing", "merchantAvailabilityInvalid", "outOfStockNotOrderable", "lowClassificationConfidence"])}`);
  console.log(`pantallas bloqueadas por accesorio=${screenAccessoryBlocked}`);
  console.log(`adhesivos de pantalla detectados totales=${adhesives.totalScreenAdhesivesDetected || 0}`);
  console.log(`adhesivos de pantalla publicos actuales=${adhesives.publicScreenAdhesivesCurrent || 0}`);
  console.log(`adhesivos privados elegibles=${adhesives.privateScreenAdhesivesEligible || 0}`);
  console.log(`adhesivos ocultos elegibles=${adhesives.hiddenScreenAdhesivesEligible || 0}`);
  console.log(`adhesivos stock real elegibles=${adhesives.stockRealScreenAdhesivesEligible || 0}`);
  console.log(`adhesivos a pedido elegibles=${adhesives.remoteScreenAdhesivesEligible || 0}`);
  console.log(`adhesivos bloqueados por imagen=${adhesives.blockersBreakdown?.missingImage || 0}`);
  console.log(`adhesivos bloqueados por precio=${adhesives.blockersBreakdown?.missingPrice || 0}`);
  console.log(`adhesivos bloqueados por Merchant=${countBlockers(adhesives, ["merchantAvailabilityDateMissing", "merchantAvailabilityInvalid", "outOfStockNotOrderable", "lowClassificationConfidence"])}`);
  console.log(`adhesivos bloqueados por no ser de pantalla=${adhesiveNotScreenBlocked}`);
  console.log(`top marcas con pantallas pendientes=${topEntries(screens.byBrand)}`);
  console.log(`top marcas con adhesivos pendientes=${topEntries(adhesives.byBrand)}`);
  console.log(`top calidades de pantallas=${topEntries(screens.byQualityTier)}`);
  console.log(`total screens feed ready=${screensFeed.entries.length}`);
  console.log(`total screen adhesives feed ready=${adhesivesFeed.entries.length}`);
  console.log(`total screens feed blocked=${Math.max(0, screens.totalScreensDetected - screensFeed.entries.length)}`);
  console.log(`total screen adhesives feed blocked=${Math.max(0, adhesives.totalScreenAdhesivesDetected - adhesivesFeed.entries.length)}`);

  printSamples("top 15 pantallas candidatas a publicar", screenEligible.map((item) => ({
    ...(item.screenClassification || {}),
    id: item.product.id || item.product.rowid,
    sku: item.product.sku || "",
    title: item.product.title || item.product.name || "",
  })));
  printSamples("top 15 pantallas bloqueadas", screens.blockedSamples, 15);
  printSamples("top 15 adhesivos candidatos a publicar", adhesiveEligible.map((item) => ({
    ...(item.adhesiveClassification || {}),
    id: item.product.id || item.product.rowid,
    sku: item.product.sku || "",
    title: item.product.title || item.product.name || "",
  })));
  printSamples("top 15 adhesivos bloqueados", adhesives.blockedSamples, 15);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
