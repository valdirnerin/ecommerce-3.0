const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { fork } = require("child_process");

const root = path.resolve(__dirname, "..");

function requestJson(port, pathname, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {}
          resolve({ statusCode: res.statusCode, body, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

async function waitForHealthy(port, deadlineMs = 3000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < deadlineMs) {
    try {
      const response = await requestJson(port, "/health", 500);
      if (response.statusCode === 200) return Date.now() - startedAt;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("server did not become healthy quickly");
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nerin-render-startup-"));
  const products = Array.from({ length: 80 }, (_, index) => ({
    id: `test-${index + 1}`,
    sku: `SKU-${index + 1}`,
    name: `Pantalla test ${index + 1}`,
    title: `Pantalla test ${index + 1}`,
    brand: "Test",
    category: "pantallas",
    visibility: "public",
    status: "active",
    stock: 5,
    price: 1000 + index,
    image: "/assets/test.png",
  }));
  await fsp.writeFile(path.join(dataDir, "products.json"), JSON.stringify({ products }, null, 2), "utf8");

  const port = 38000 + Math.floor(Math.random() * 1000);
  const child = fork(path.join(root, "backend/server.js"), {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      PORT: String(port),
      CATALOG_REBUILD_TEST_DELAY_MS: "25",
    },
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  try {
    const maxHealthMs = Math.max(1500, Number(process.env.RENDER_STARTUP_HEALTH_MAX_MS || 5000) || 5000);
    const healthMs = await waitForHealthy(port, maxHealthMs);
    if (healthMs > maxHealthMs) {
      throw new Error(`/health was too slow: ${healthMs}ms`);
    }

    const health = await requestJson(port, "/api/health", 1000);
    if (health.statusCode !== 200 || !health.json?.ok) {
      throw new Error(`/api/health failed: ${health.statusCode} ${health.body}`);
    }

    const status = await requestJson(port, "/api/catalog/status", 1000);
    if (status.statusCode !== 200) {
      throw new Error(`/api/catalog/status failed: ${status.statusCode} ${status.body}`);
    }
    if (!status.json?.rebuilding && !status.json?.initializing) {
      throw new Error(`catalog status did not show rebuild/init: ${status.body}`);
    }

    const productsResponse = await requestJson(port, "/api/products", 1000);
    if (![200, 503].includes(productsResponse.statusCode)) {
      throw new Error(`/api/products returned unexpected status ${productsResponse.statusCode}`);
    }
    if (
      productsResponse.statusCode === 503 &&
      productsResponse.json?.error !== "CATALOG_INITIALIZING" &&
      productsResponse.json?.code !== "CATALOG_INITIALIZING"
    ) {
      throw new Error(`/api/products 503 was not controlled: ${productsResponse.body}`);
    }

    if (!logs.includes("Servidor de NERIN corriendo")) {
      throw new Error("server listen log not found");
    }
    if (!logs.includes("[products-db] rebuild started")) {
      throw new Error("rebuild start log not found");
    }

    console.log(JSON.stringify({
      ok: true,
      healthMs,
      status: {
        ready: Boolean(status.json.ready),
        initializing: Boolean(status.json.initializing),
        rebuilding: Boolean(status.json.rebuilding),
        processed: Number(status.json.processed || 0),
        total: Number(status.json.total || 0),
      },
      productsStatusCode: productsResponse.statusCode,
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
