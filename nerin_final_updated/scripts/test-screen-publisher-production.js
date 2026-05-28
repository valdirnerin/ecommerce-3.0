#!/usr/bin/env node
"use strict";

process.env.SCREEN_PUBLISHER_ENABLED = "false";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createServer } = require("../backend/server");

const ROOT = path.join(__dirname, "..");
const ADMIN_TOKEN = Buffer.from("admin@nerin.com:test").toString("base64");

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const preview = text.slice(0, 300).replace(/\s+/g, " ");
  assert(contentType.includes("application/json"), `${pathName} returned ${response.status} ${contentType}: ${preview}`);
  assert(!preview.startsWith("<!DOCTYPE"), `${pathName} returned HTML`);
  const data = text ? JSON.parse(text) : {};
  return { response, data, preview, contentType };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function assertSourceContracts() {
  const service = fs.readFileSync(path.join(ROOT, "backend", "services", "screenPublicationService.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");
  const admin = fs.readFileSync(path.join(ROOT, "frontend", "js", "admin.js"), "utf8");
  const packageJson = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");

  assert(service.includes("SCREEN_PUBLISHER_SCAN_LIMIT_DEFAULT || 5000"), "DEFAULT_SCAN_LIMIT must default to 5000");
  assert(service.includes("function isPublicProduct(product = {})"), "isPublicProduct helper missing");
  assert(service.includes("computePublicationState(product).is_public"), "isPublicProduct must use computePublicationState");
  assert(!/Number\([^)\n]*is_public/.test(service), "service must not use Number(raw is_public)");
  assert(!/boolish\([^)\n]*is_public/.test(service), "service must not use boolish(raw is_public)");
  assert(!/p\.is_public\s*\|\|\s*0/.test(service), "audit CSV must not use raw p.is_public");
  assert(service.includes('type === "screen" ? item.screenClassification?.isScreen : item.adhesiveClassification?.isScreenAdhesive'), "buildFeed must filter real screens/adhesives before Merchant mapping");
  assert(service.includes(".filter((item) => isPublicProduct(item.product))"), "buildFeed must filter public state with isPublicProduct");
  assert(service.includes(".filter((item) => item.merchantReadiness?.ready)"), "buildFeed must filter merchant readiness");
  assert(service.indexOf(".filter((item) => isPublicProduct(item.product))") < service.indexOf(".slice(0, outputLimit)"), "buildFeed must apply outputLimit after filtering");
  assert(service.includes("debug?.computePublicationState?.is_public"), "publish verification must inspect debug computePublicationState");
  assert(service.includes("postVerificationFailed"), "publish must fail without public verification");

  assert(server.includes('pathname === "/api/admin/screens/publisher-health"'), "publisher-health endpoint missing");
  assert(server.includes("SCREEN_PUBLISHER_ROUTE_NOT_FOUND"), "screen publisher fallback JSON route missing");
  assert(server.includes("outputLimit: 48"), "/adhesivos-de-pantalla must use outputLimit");
  assert(!server.includes("limit: 48,"), "/adhesivos-de-pantalla must not scan only 48 products");
  assert(admin.includes("async function fetchAdminJson"), "frontend fetchAdminJson helper missing");
  assert(admin.includes("/api/admin/products/bulk-visibility"), "frontend must use normal bulk visibility endpoint");
  assert(!/screenAuditBtn|screenPreviewBtn|screenPublishBtn|adhAuditBtn|adhPreviewBtn|adhPublishBtn/.test(admin), "admin must not wire the retired screen publisher buttons");
  assert(!packageJson.includes("applyScreenPublisherHotfix.js"), "runtime hotfix must be removed from package.json");
}

async function assertEndpointContracts() {
  const server = createServer();
  const baseUrl = await listen(server);
  try {
    const health = await requestJson(baseUrl, "/api/admin/screens/publisher-health");
    assert.strictEqual(health.response.status, 200, "publisher health should be 200");
    assert.strictEqual(health.data.ok, true, "publisher health ok");
    assert.strictEqual(health.data.routesReady, true, "publisher routes ready");
    assert.strictEqual(health.data.startHotfixRemoved, true, "start hotfix removed");

    const unauthAudit = await requestJson(baseUrl, "/api/admin/screens/audit");
    assert.strictEqual(unauthAudit.response.status, 401, "screens audit without auth should be 401 JSON");
    assert.strictEqual(unauthAudit.data.error, "UNAUTHORIZED", "screens audit unauthorized code");

    const authHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` };
    const screensAudit = await requestJson(baseUrl, "/api/admin/screens/audit", { headers: authHeaders });
    assert.strictEqual(screensAudit.response.status, 503, "screens audit should be disabled by default");
    assert.strictEqual(screensAudit.data.error, "DISABLED", "screens audit disabled code");

    const preview = await requestJson(baseUrl, "/api/admin/screens/publish-preview", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ onlyWithImage: true, onlyWithPrice: true }),
    });
    assert.strictEqual(preview.response.status, 503, "screens preview should be disabled by default");
    assert.strictEqual(preview.data.error, "DISABLED", "screens preview disabled code");

    const publishNoConfirm = await requestJson(baseUrl, "/api/admin/screens/publish", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ onlyWithImage: true }),
    });
    assert.strictEqual(publishNoConfirm.response.status, 503, "screens publish should be disabled before confirm");
    assert.strictEqual(publishNoConfirm.data.ok, false, "screens publish without confirm ok=false");

    const adhesivesAudit = await requestJson(baseUrl, "/api/admin/screen-adhesives/audit", { headers: authHeaders });
    assert.strictEqual(adhesivesAudit.response.status, 503, "adhesives audit should be disabled by default");
    assert.strictEqual(adhesivesAudit.data.error, "DISABLED", "adhesives audit disabled code");
  } finally {
    await close(server);
  }
}

(async () => {
  assertSourceContracts();
  await assertEndpointContracts();
  console.log("screen publisher production tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
