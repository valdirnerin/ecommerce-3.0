#!/usr/bin/env node
"use strict";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.PORT = "0";

const http = require("http");
const { createServer } = require("../backend/server");

const paths = [
  "/stock-real",
  "/pantallas-en-stock",
  "/baterias-en-stock",
  "/repuestos-samsung",
  "/repuestos-iphone",
  "/sitemap.xml",
];

function request(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${pathname}`, (res) => {
      res.resume();
      res.on("end", () => resolve({ pathname, statusCode: res.statusCode || 0 }));
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error(`timeout ${pathname}`));
    });
    req.on("error", reject);
  });
}

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const results = [];
  try {
    for (const pathname of paths) {
      const result = await request(baseUrl, pathname);
      results.push(result);
      if (result.statusCode >= 500) {
        throw new Error(`${pathname} returned ${result.statusCode}`);
      }
    }
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error("[organic-seo-runtime-test]", error?.stack || error?.message || error);
  process.exit(1);
});
