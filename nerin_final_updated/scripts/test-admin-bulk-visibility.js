#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const sourceDataDir = path.join(rootDir, "data");
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-bulk-visibility-"));

for (const fileName of ["products.json", "products.sqlite", "products.manifest.json"]) {
  const source = path.join(sourceDataDir, fileName);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(tempDataDir, fileName));
  }
}

process.env.DATA_DIR = tempDataDir;
process.env.SCREEN_PUBLISHER_ENABLED = "false";

const { createServer } = require("../backend/server");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

const ADMIN_TOKEN = Buffer.from("admin@nerin.com:test").toString("base64");

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const preview = text.slice(0, 300).replace(/\s+/g, " ");
  assert(contentType.includes("application/json"), `${pathName} returned ${response.status} ${contentType}: ${preview}`);
  assert(!preview.startsWith("<!DOCTYPE"), `${pathName} returned HTML`);
  return { response, data: text ? JSON.parse(text) : {}, preview };
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `${name} debe existir`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace, i + 1);
  }
  throw new Error(`No se pudo leer el cuerpo de ${name}`);
}

(async () => {
  await productsSqliteRepo.ensureProductsDb();
  const adminPage = await productsSqliteRepo.queryAdminProducts({ page: 1, pageSize: 40 });
  const samples = (adminPage.items || [])
    .map((product) => product.sku || product.code || product.id || product.publicSlug)
    .filter(Boolean)
    .slice(0, 4);
  assert(samples.length >= 4, "Se necesitan al menos 4 productos fixture");

  const server = createServer();
  const baseUrl = await listen(server);
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  try {
    const health = await requestJson(baseUrl, "/api/admin/products/bulk-visibility/health", { headers: auth });
    assert.strictEqual(health.response.status, 200, "bulk health status");
    assert.strictEqual(health.data.ok, true, "bulk health ok");
    assert.strictEqual(health.data.rebuildsFullCatalog, false, "bulk health no rebuild");

    const empty = await requestJson(baseUrl, "/api/admin/products/bulk-visibility", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: [], visibility: "public" }),
    });
    assert.strictEqual(empty.response.status, 400, "empty identifiers status");
    assert.strictEqual(empty.data.error, "BULK_VISIBILITY_EMPTY", "empty identifiers code");

    const invalid = await requestJson(baseUrl, "/api/admin/products/bulk-visibility", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: samples.slice(0, 1), visibility: "draft" }),
    });
    assert.strictEqual(invalid.response.status, 400, "invalid visibility status");
    assert.strictEqual(invalid.data.error, "INVALID_VISIBILITY", "invalid visibility code");

    await requestJson(baseUrl, "/api/admin/products/bulk-visibility", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: samples.slice(0, 3), visibility: "private", reindex: true }),
    });

    const publish = await requestJson(baseUrl, "/api/admin/products/bulk-visibility", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: samples.slice(0, 3), visibility: "public", reindex: true }),
    });
    assert.strictEqual(publish.response.status, 200, "publish status");
    assert.strictEqual(publish.data.requestedCount, 3, "requested count");
    assert.strictEqual(publish.data.updatedCount, 3, "updated count");
    assert.strictEqual(publish.data.failedCount, 0, "failed count");
    assert(Array.isArray(publish.data.sampleUpdated), "sampleUpdated array");
    assert(Array.isArray(publish.data.sampleFailed), "sampleFailed array");

    for (const identifier of samples.slice(0, 3)) {
      const debug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
      assert(debug?.found === true, `debug exists for ${identifier}`);
      assert(debug.computePublicationState?.is_public === true || debug.computed?.isPublic === true, `${identifier} debe quedar publico`);
      assert(debug.index?.found === true, `${identifier} debe estar reindexado`);
    }

    const partial = await requestJson(baseUrl, "/api/admin/products/bulk-visibility", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: [samples[0], "missing-bulk-visibility-fixture", samples[1]], visibility: "hidden", reindex: true }),
    });
    assert.strictEqual(partial.response.status, 200, "partial status");
    assert.strictEqual(partial.data.updatedCount, 2, "partial updated count");
    assert.strictEqual(partial.data.failedCount, 1, "partial failed count");
    assert(partial.data.sampleFailed.some((item) => item.identifier === "missing-bulk-visibility-fixture"), "partial failure sample");

    const screenDisabled = await requestJson(baseUrl, "/api/admin/screens/audit", { headers: auth });
    assert.strictEqual(screenDisabled.response.status, 503, "screen publisher disabled status");
    assert.strictEqual(screenDisabled.data.error, "DISABLED", "screen publisher disabled code");
  } finally {
    await close(server);
    try {
      await fsp.rm(tempDataDir, { recursive: true, force: true });
    } catch {}
  }

  const repoSource = readSource("backend/data/productsSqliteRepo.js");
  const batchBody = functionBody(repoSource, "setProductsVisibilityBatch");
  assert(!/rebuildProductsDb|rebuildProductsDbFromJson|ensureProductsDb\s*\(/.test(batchBody), "batch no debe hacer rebuild completo");
  assert(repoSource.includes("reindexProduct(identifier)"), "batch debe reindexar por producto");

  const serverSource = readSource("backend/server.js");
  assert(serverSource.includes("/api/admin/products/bulk-visibility"), "server debe exponer bulk-visibility");

  const adminSource = readSource("frontend/js/admin.js");
  assert(adminSource.includes("/api/admin/products/bulk-visibility"), "frontend debe llamar al endpoint batch");
  assert(!/screenAuditBtn|screenPreviewBtn|screenPublishBtn|adhAuditBtn|adhPreviewBtn|adhPublishBtn/.test(adminSource), "frontend no debe mantener botones del publicador viejo");
  assert(!/for\s*\(\s*const\s+id\s+of\s+selected\s*\)[\s\S]{0,700}visibility/.test(adminSource), "frontend no debe hacer PATCH por producto para visibilidad");

  const htmlSource = readSource("frontend/admin.html");
  assert(!htmlSource.includes("Publicador final de pantallas"), "admin no debe mostrar el publicador viejo");
  assert(htmlSource.includes('value="vis-hidden"'), "admin debe incluir accion Ocultar");

  console.log("admin bulk visibility tests passed", { samples: samples.slice(0, 3) });
})().catch(async (error) => {
  try {
    await fsp.rm(tempDataDir, { recursive: true, force: true });
  } catch {}
  console.error(error);
  process.exitCode = 1;
});
