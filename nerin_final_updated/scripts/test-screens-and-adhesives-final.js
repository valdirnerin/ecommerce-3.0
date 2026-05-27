#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  isRealScreenProduct,
  isScreenAdhesiveProduct,
} = require("../backend/utils/screenProductClassifier");
const {
  computeScreenPublicationEligibility,
  computeScreenAdhesivePublicationEligibility,
  feedEntry,
} = require("../backend/services/screenPublicationService");

const ROOT = path.join(__dirname, "..");

function product(title, overrides = {}) {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    sku: title.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48),
    title,
    name: title,
    public_slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    image: "https://example.com/image.jpg",
    price: 10000,
    stock: 2,
    is_public: 0,
    visibility: "private",
    rowid: Math.floor(Math.random() * 100000),
    product_rowid: 1,
    ...overrides,
  };
}

function assertMany(name, cases, fn) {
  for (const value of cases) {
    assert.strictEqual(fn(product(value)), true, `${name} should be true: ${value}`);
  }
}

function assertManyFalse(name, cases, fn) {
  for (const value of cases) {
    assert.strictEqual(fn(product(value)), false, `${name} should be false: ${value}`);
  }
}

function testClassifiers() {
  assertMany("screen", [
    "Display Original Black Samsung Galaxy A15 SM-A155",
    "Display Incl Frame Original Green Honor 9X Lite",
    "Display JK Compatible Hard OLED for iPhone 15 Pro",
    "Modulo Samsung A15 5G Original Con Marco Service Pack GH82-33638A",
    "Repair Kit Display Galaxy S24 Plus SM-S926",
    "Display Excl Frame Refurb Redmi Note 10S",
    "Display Soft Factory STD for iPhone 11 Pro Max",
    "Pantalla Samsung Galaxy A16 4G Original Negra con Marco AMOLED",
  ], (p) => isRealScreenProduct(p).isScreen);

  assertManyFalse("screen", [
    "Display Adhesive Tape 30 pcs Original Apple iPhone 16",
    "Bracket Display Galaxy XCover6 Pro",
    "Coverz MagSafe Compatible Black Apple iPhone 17",
    "Back Glass Black iPhone 14 Plus",
    "SIM Tray Original Black Titanium iPhone 15 Pro",
    "GPS Antenna Compatible iPhone 17 Air",
    "Camera Lens iPhone 12",
    "Dock Connector iPhone 14 Plus",
  ], (p) => isRealScreenProduct(p).isScreen);

  assertMany("screen adhesive", [
    "Display Adhesive Tape 30 pcs Original Apple iPhone 16",
    "Adhesive Tape for Samsung Galaxy A15 Display",
    "LCD Adhesive for iPhone 12",
    "Display Gasket for iPhone 13 Pro",
    "Screen Seal for Google Pixel 7 Pro",
    "Cinta adhesiva de pantalla Samsung A54",
  ], (p) => isScreenAdhesiveProduct(p).isScreenAdhesive);

  assertManyFalse("screen adhesive", [
    "Battery Adhesive iPhone 12",
    "Back Cover Adhesive Samsung A54",
    "Rear Cover Adhesive Huawei P30",
    "Camera Lens Adhesive iPhone 14",
    "Universal Adhesive Tape sin modelo ni destino claro",
  ], (p) => isScreenAdhesiveProduct(p).isScreenAdhesive);
}

function testPublicationEligibility() {
  assert.strictEqual(computeScreenPublicationEligibility(product("Display Samsung Galaxy A15 Original")).eligible, true, "private eligible screen");
  assert.strictEqual(computeScreenPublicationEligibility(product("Display iPhone 12 Hard OLED", { visibility: "hidden" })).eligible, true, "hidden eligible screen");
  assert(computeScreenPublicationEligibility(product("Display Samsung Galaxy A15", { image: "" })).blockers.includes("missingImage"), "screen missing image blocked");
  assert(computeScreenPublicationEligibility(product("Display Samsung Galaxy A15", { price: 0 })).blockers.includes("missingPrice"), "screen missing price blocked");
  assert(computeScreenPublicationEligibility(product("Display Samsung Galaxy A15", { stock: 0, remote_stock: 0 })).blockers.includes("outOfStockNotOrderable"), "screen not orderable blocked");
  assert(computeScreenPublicationEligibility(product("Display Adhesive Tape 30 pcs Original Apple iPhone 16")).blockers.includes("likelyAccessory"), "display adhesive not screen");
  assert(computeScreenPublicationEligibility(product("Bracket Display Galaxy XCover6 Pro")).blockers.includes("likelyAccessory"), "bracket display not screen");
  assert(computeScreenPublicationEligibility(product("Coverz MagSafe Compatible Black Apple iPhone 17")).blockers.includes("likelyAccessory"), "case not screen");

  assert.strictEqual(computeScreenAdhesivePublicationEligibility(product("Display Adhesive Tape for iPhone 12")).eligible, true, "private eligible screen adhesive");
  assert(computeScreenAdhesivePublicationEligibility(product("Battery Adhesive iPhone 12")).blockers.includes("battery_adhesive"), "battery adhesive blocked");
  assert(computeScreenAdhesivePublicationEligibility(product("Universal Adhesive Tape sin modelo ni destino claro")).blockers.includes("genericAdhesiveWithoutModel"), "generic adhesive blocked");
}

function testMerchantFeeds() {
  const screen = computeScreenPublicationEligibility(product("Display Samsung Galaxy A15 Original", { is_public: 1 }));
  const adhesive = computeScreenAdhesivePublicationEligibility(product("Display Adhesive Tape for iPhone 12", { is_public: 1 }));
  const screenEntry = feedEntry({ ...screen, product: product("Display Samsung Galaxy A15 Original", { is_public: 1 }) }, "screen", "https://nerinparts.com.ar");
  const adhesiveEntry = feedEntry({ ...adhesive, product: product("Display Adhesive Tape for iPhone 12", { is_public: 1 }) }, "screen_adhesive", "https://nerinparts.com.ar");

  assert(screenEntry, "screen feed entry created");
  assert(adhesiveEntry, "adhesive feed entry created");
  assert.strictEqual(screenEntry.custom_label_0, "screens", "screen custom label");
  assert.strictEqual(adhesiveEntry.custom_label_0, "screen_adhesives", "adhesive custom label");
  assert(!/adhesivo|adhesive|gasket/i.test(screenEntry.title), "screen title is not adhesive");
  assert(!/^pantalla\b/i.test(adhesiveEntry.title), "adhesive title is not screen");
  assert.strictEqual(screenEntry.availability, "in_stock", "screen in stock");
  assert.strictEqual(screenEntry.availability_date, "", "in stock has no availability date");
  assert.notStrictEqual(screenEntry.identifier_exists, "yes", "no invented gtin/mpn");
  assert(!/original/i.test(feedEntry({ ...computeScreenPublicationEligibility(product("Display compatible for iPhone 12 Hard OLED", { is_public: 1 })), product: product("Display compatible for iPhone 12 Hard OLED", { is_public: 1 }) }, "screen").title), "compatible is not titled as original");
}

function testSearchAndRoutesContracts() {
  const repoSource = fs.readFileSync(path.join(ROOT, "backend", "data", "productsSqliteRepo.js"), "utf8");
  assert(repoSource.includes("adhesiveIntent"), "search scoring has adhesive intent");
  assert(repoSource.includes("displayIntent"), "search scoring has display intent");
  assert(repoSource.includes("isRealScreenProduct"), "search scoring uses screen classifier");
  assert(repoSource.includes("isScreenAdhesiveProduct"), "search scoring uses adhesive classifier");

  const serverSource = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");
  assert(serverSource.includes("/api/admin/screens/audit"), "screen audit endpoint exists");
  assert(serverSource.includes("/api/admin/screen-adhesives/audit"), "adhesive audit endpoint exists");
  assert(serverSource.includes("/api/merchant/screens-feed.csv"), "screens feed exists");
  assert(serverSource.includes("/api/merchant/screen-adhesives-feed.csv"), "adhesive feed exists");
  assert(serverSource.includes("/adhesivos-de-pantalla"), "screen adhesives page exists");
  const serviceSource = fs.readFileSync(path.join(ROOT, "backend", "services", "screenPublicationService.js"), "utf8");
  assert(serviceSource.includes("confirmScreenBulkPublish"), "screen publish confirmation required");
  assert(serviceSource.includes("confirmScreenAdhesiveBulkPublish"), "adhesive publish confirmation required");
}

testClassifiers();
testPublicationEligibility();
testMerchantFeeds();
testSearchAndRoutesContracts();

console.log("screens and screen adhesives final tests passed");
