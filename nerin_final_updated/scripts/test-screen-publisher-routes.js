#!/usr/bin/env node
"use strict";

process.env.SCREEN_PUBLISHER_ENABLED = "false";
process.env.DATA_DIR = process.env.DATA_DIR || require("path").join(__dirname, "..", "data");

const assert = require("assert");
const { createServer } = require("../backend/server");

const ADMIN_TOKEN = Buffer.from("admin@nerin.com:test").toString("base64");

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, pathName, options = {}) {
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

(async () => {
  const server = createServer();
  const baseUrl = await listen(server);
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  try {
    const light = await request(baseUrl, "/api/system/health-light");
    assert.strictEqual(light.response.status, 200, "health-light status");
    assert.strictEqual(light.data.ok, true, "health-light ok");

    const health = await request(baseUrl, "/api/admin/screens/publisher-health");
    assert.strictEqual(health.response.status, 200, "publisher health status");
    assert.strictEqual(health.data.enabled, false, "publisher disabled by default");

    const unauth = await request(baseUrl, "/api/admin/screens/audit");
    assert.strictEqual(unauth.response.status, 401, "unauth screens audit status");
    assert.strictEqual(unauth.data.error, "UNAUTHORIZED", "unauth screens audit code");

    const screensAudit = await request(baseUrl, "/api/admin/screens/audit", { headers: auth });
    assert.strictEqual(screensAudit.response.status, 503, "screens audit disabled status");
    assert.strictEqual(screensAudit.data.error, "SCREEN_PUBLISHER_DISABLED", "screens audit disabled code");

    const adhesivesAudit = await request(baseUrl, "/api/admin/screen-adhesives/audit", { headers: auth });
    assert.strictEqual(adhesivesAudit.response.status, 503, "adhesives audit disabled status");
    assert.strictEqual(adhesivesAudit.data.error, "SCREEN_PUBLISHER_DISABLED", "adhesives audit disabled code");

    const preview = await request(baseUrl, "/api/admin/screens/publish-preview", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ onlyWithImage: true }),
    });
    assert.strictEqual(preview.response.status, 503, "preview disabled status");
    assert.strictEqual(preview.data.error, "SCREEN_PUBLISHER_DISABLED", "preview disabled code");
  } finally {
    await close(server);
  }
  console.log("screen publisher route tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
