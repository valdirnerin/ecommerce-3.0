const fsp = require("fs").promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { fork } = require("child_process");

const root = path.resolve(__dirname, "..");

function requestJson(port, pathname, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: pathname, method: "GET", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          let json = null;
          try { json = body ? JSON.parse(body) : null; } catch {}
          resolve({ statusCode: res.statusCode, body, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(port, predicate, deadlineMs = 7000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < deadlineMs) {
    try {
      last = await requestJson(port, "/api/catalog/status", 1000);
      if (predicate(last)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not reached; last=${last?.body || last?.message || JSON.stringify(last)}`);
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nerin-rebuild-timeout-"));
  const products = Array.from({ length: 40 }, (_, index) => ({
    id: `timeout-${index + 1}`,
    sku: `TIMEOUT-${index + 1}`,
    name: `Producto timeout ${index + 1}`,
    title: `Producto timeout ${index + 1}`,
    brand: "Test",
    category: "pantallas",
    visibility: "public",
    status: "active",
    stock: 3,
    price: 1000 + index,
    image: "/assets/test.png",
  }));
  await fsp.writeFile(path.join(dataDir, "products.json"), JSON.stringify({ products }, null, 2), "utf8");

  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = fork(path.join(root, "backend/server.js"), {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      PORT: String(port),
      CATALOG_REBUILD_TEST_DELAY_MS: "250",
      CATALOG_REBUILD_TIMEOUT_MS: "1000",
    },
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    await waitFor(port, (res) => res.statusCode === 200, 4000);
    const failedStatus = await waitFor(
      port,
      (res) => res.statusCode === 200 && res.json?.failed && !res.json?.initializing && !res.json?.rebuilding,
      8000,
    );

    if (failedStatus.json?.ready) {
      throw new Error(`expected no sqlite-ready catalog after timed-out rebuild: ${failedStatus.body}`);
    }
    if (failedStatus.json?.lastError?.code !== "CATALOG_REBUILD_TIMEOUT") {
      throw new Error(`expected timeout error state: ${failedStatus.body}`);
    }

    const productsResponse = await requestJson(port, "/api/products?page=1&pageSize=5", 2500);
    if (productsResponse.statusCode !== 200) {
      throw new Error(`/api/products must use fallback, got ${productsResponse.statusCode}: ${productsResponse.body}`);
    }
    if (productsResponse.json?.source !== "streaming_fallback") {
      throw new Error(`expected streaming_fallback source: ${productsResponse.body}`);
    }
    if (!Array.isArray(productsResponse.json?.items) || productsResponse.json.items.length === 0) {
      throw new Error(`expected fallback items: ${productsResponse.body}`);
    }
    if (/CATALOG_INITIALIZING/.test(productsResponse.body)) {
      throw new Error(`public catalog leaked CATALOG_INITIALIZING: ${productsResponse.body}`);
    }
    if (!logs.includes("[products-db] rebuild timeout")) {
      throw new Error("timeout log not found");
    }

    console.log(JSON.stringify({
      ok: true,
      status: {
        ready: Boolean(failedStatus.json.ready),
        initializing: Boolean(failedStatus.json.initializing),
        rebuilding: Boolean(failedStatus.json.rebuilding),
        failed: Boolean(failedStatus.json.failed),
        code: failedStatus.json.lastError?.code,
      },
      products: {
        source: productsResponse.json.source,
        items: productsResponse.json.items.length,
      },
    }, null, 2));
  } finally {
    if (!child.killed) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
