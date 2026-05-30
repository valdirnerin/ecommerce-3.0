const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pkg = JSON.parse(read("package.json"));
const start = String(pkg.scripts?.start || "");
assert(start === "node backend/server.js", "start must run backend/server.js directly");
assert(!/apply(?:Patch|Hotfix|CodexSeoBulkPatch|SitemapHotfix)/i.test(start), "start must not run mutable patch/hotfix scripts");
assert(!/max-old-space-size=512/.test(start), "start must not force 512 MB V8 heap on Render");

const server = read("backend/server.js");
assert(server.includes('pathname === "/healthz"'), "server must expose /healthz");
assert(server.includes('pathname === "/readyz"'), "server must expose /readyz");
assert(server.includes("MAX_JSON_BODY_BYTES"), "server must enforce a request body limit");
assert(server.includes("PUBLIC_PRODUCTS_CACHE_MS"), "public product cache must be configurable");
assert(server.includes("PUBLIC_SEARCH_CACHE_MS"), "public search cache must be configurable");
assert(server.includes("/sitemap-stock.xml"), "server must expose /sitemap-stock.xml");
assert(server.includes("MERCHANT_FEED_CACHE_MS"), "Merchant feed cache must be configurable");
assert(!server.includes("req.destroy(error)"), "oversized body handling must preserve the response socket");
assert(server.includes('"Cache-Control": "private, no-store"'), "wholesale catalog responses must not be publicly cacheable");
assert(server.includes('"Vary": "Authorization, Cookie, X-Admin-Key"'), "private catalog responses must vary on auth headers");

const repo = read("backend/data/productsSqliteRepo.js");
assert(repo.includes("includeFacets"), "SQLite product queries must support includeFacets");

console.log("production hardening checks passed");
