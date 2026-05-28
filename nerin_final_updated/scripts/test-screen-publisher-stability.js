#!/usr/bin/env node
"use strict";

process.env.SCREEN_PUBLISHER_ENABLED = "true";
process.env.SCREEN_PUBLISHER_SCAN_LIMIT_DEFAULT = "5";
process.env.SCREEN_PUBLISHER_SCAN_LIMIT_MAX = "10";
process.env.SCREEN_PUBLISHER_CHUNK_SIZE = "2";
process.env.DATA_DIR = process.env.DATA_DIR || require("path").join(__dirname, "..", "data");

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createServer } = require("../backend/server");

const ROOT = path.join(__dirname, "..");
const ADMIN_TOKEN = Buffer.from("admin@nerin.com:test").toString("base64");

async function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
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
  return { response, data: text ? JSON.parse(text) : {} };
}

async function waitJob(baseUrl, jobId, auth) {
  for (let i = 0; i < 40; i += 1) {
    const result = await requestJson(baseUrl, `/api/admin/screens/jobs/${encodeURIComponent(jobId)}`, { headers: auth });
    const status = result.data.job?.status;
    if (status === "done" || status === "failed") return result.data;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("job did not finish");
}

function assertSourceContracts() {
  const service = fs.readFileSync(path.join(ROOT, "backend", "services", "screenPublicationService.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");
  const admin = fs.readFileSync(path.join(ROOT, "frontend", "js", "admin.js"), "utf8");
  const packageJson = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");

  assert(!packageJson.includes("applyScreenPublisherHotfix.js"), "start must not run screen publisher hotfix");
  assert(service.includes("SCREEN_PUBLISHER_SCAN_LIMIT_DEFAULT || 5000"), "interactive scan default must be 5000");
  assert(service.includes("SCREEN_PUBLISHER_SCAN_LIMIT_MAX || 60000"), "interactive scan max must be 60000");
  assert(service.includes("candidateWhere(type"), "loadRows must prefilter candidates in SQLite");
  assert(service.includes("LIMIT ? OFFSET ?"), "loadRows must support chunk/cursor paging");
  assert(service.includes(".filter((item) => isPublicProduct(item.product))"), "buildFeed must use computed public state");
  assert(service.indexOf(".filter((item) => isPublicProduct(item.product))") < service.indexOf(".slice(0, outputLimit)"), "buildFeed must apply outputLimit at the end");
  assert(!/Number\([^)\n]*is_public/.test(service), "service must not use raw Number(is_public)");
  assert(!/boolish\([^)\n]*is_public/.test(service), "service must not use raw boolish(is_public)");

  assert(server.includes("SCREEN_PUBLISHER_ENABLED"), "server must have publisher feature flag");
  assert(server.includes("startScreenPublisherJob"), "server must start publisher jobs");
  assert(server.includes("screenPublisherLocks"), "server must lock publisher jobs");
  assert(server.includes("[screen-publisher:memory]"), "server must log memory for publisher jobs");
  assert(server.includes("/api/system/health-light"), "health-light endpoint missing");
  assert(server.includes("DEBUG_PRODUCT_DETAIL"), "product detail found logs must be debug-gated");
  assert(server.includes("productDetailCache"), "product detail cache missing");
  assert(server.includes("productsSqliteRepo.getProductByPublicSlugOrAnyIdentifier"), "product detail must use SQLite first");
  assert(server.includes("ANALYTICS_DETAILED_ENABLED") && server.includes("!IS_PRODUCTION"), "analytics detailed must be disabled by default in production");
  assert(server.includes("ANALYTICS_CATALOG_SNAPSHOT_ENABLED") && server.includes("!IS_PRODUCTION"), "analytics snapshot must be disabled by default in production");

  assert(admin.includes("/audit-job"), "admin must start audit jobs");
  assert(admin.includes("/publish-job"), "admin must start publish jobs");
  assert(admin.includes("/jobs/"), "admin must poll jobs");
  assert(admin.includes("fetchAdminJson"), "admin must use robust JSON helper");
}

(async () => {
  assertSourceContracts();
  const server = createServer();
  const baseUrl = await listen(server);
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  try {
    const health = await requestJson(baseUrl, "/api/admin/screens/publisher-health");
    assert.strictEqual(health.data.enabled, true, "publisher should be enabled in this test");

    const start = await requestJson(baseUrl, "/api/admin/screens/audit-job", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ scanLimit: 5 }),
    });
    assert.strictEqual(start.response.status, 202, "audit job should return immediately");
    assert(start.data.jobId, "audit job id missing");
    const done = await waitJob(baseUrl, start.data.jobId, auth);
    assert.strictEqual(done.job.status, "done", "job must finish successfully");
    assert(Number(done.job.scannedRows || 0) <= 10, "job must respect scan max");
  } finally {
    await close(server);
  }
  console.log("screen publisher stability tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
