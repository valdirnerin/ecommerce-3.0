const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { fork } = require("child_process");

const root = path.resolve(__dirname, "..");

function requestJson(port, pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method: "GET", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch {}
        resolve({ statusCode: res.statusCode, body, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const res = await requestJson(port, "/health", 500);
      if (res.statusCode === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

async function writeJsonl(filePath, events) {
  await fsp.writeFile(filePath, events.map((evt) => JSON.stringify(evt)).join("\n") + "\n", "utf8");
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nerin-analytics-safe-"));
  const analyticsDir = path.join(dataDir, "analytics");
  const archiveDir = path.join(analyticsDir, "archive");
  await fsp.mkdir(archiveDir, { recursive: true });

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hotEvents = Array.from({ length: 12 }, (_, index) => ({
    id: `evt-${index}`,
    type: index % 2 ? "page_view" : "view_item",
    sessionId: `s-${index % 3}`,
    timestamp: new Date(now.getTime() - index * 60_000).toISOString(),
    path: "/shop.html",
  }));
  await writeJsonl(path.join(analyticsDir, `events-${today}.jsonl`), hotEvents);

  const oldEvents = Array.from({ length: 20 }, (_, index) => JSON.stringify({
    id: `archive-${index}`,
    type: "page_view",
    sessionId: "archived",
    timestamp: "2025-01-01T00:00:00.000Z",
  })).join("\n") + "\n";
  await fsp.writeFile(path.join(archiveDir, "2025-W01.jsonl.gz"), zlib.gzipSync(oldEvents));
  await fsp.writeFile(path.join(analyticsDir, "sessions.json"), JSON.stringify({ sessions: [{ id: "s-1", status: "active", lastSeenAt: now.toISOString() }] }), "utf8");
  await fsp.writeFile(path.join(dataDir, "products.manifest.json"), JSON.stringify({ productCount: 52272, publicProductCount: 1000 }), "utf8");
  await fsp.writeFile(path.join(dataDir, "orders.json"), JSON.stringify({ orders: [] }), "utf8");
  await fsp.writeFile(path.join(dataDir, "returns.json"), JSON.stringify({ returns: [] }), "utf8");

  const serverSource = await fsp.readFile(path.join(root, "backend/server.js"), "utf8");
  const liveBlock = serverSource.slice(serverSource.indexOf('pathname === "/api/analytics/live"'), serverSource.indexOf('pathname === "/api/admin/analytics/health"'));
  const detailedBlock = serverSource.slice(serverSource.indexOf('pathname === "/api/analytics/detailed"'), serverSource.indexOf("API: Alertas de stock"));
  if (/getEventsByRange\(/.test(liveBlock) || /getEventsByRange\(/.test(detailedBlock)) {
    throw new Error("live/detailed routes must not use the readFileSync event loader");
  }
  if (!/skipArchive:\s*true/.test(liveBlock)) {
    throw new Error("live route must skip archives");
  }
  if (!/ANALYTICS_CATALOG_SNAPSHOT_ENABLED/.test(serverSource)) {
    throw new Error("catalog snapshot feature flag is missing");
  }

  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = fork(path.join(root, "backend/server.js"), {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      PORT: String(port),
      ANALYTICS_DETAILED_ENABLED: "true",
      ANALYTICS_CATALOG_SNAPSHOT_ENABLED: "false",
      ANALYTICS_MAX_EVENTS_DETAILED: "5",
      ANALYTICS_DETAILED_TEST_DELAY_MS: "1000",
    },
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    await waitForServer(port);
    const live = await requestJson(port, "/api/analytics/live");
    if (live.statusCode !== 200 || Number(live.json?.eventsLastHour || 0) !== hotEvents.length) {
      throw new Error(`live did not use hot events only: ${live.statusCode} ${live.body}`);
    }

    const firstDetailedPromise = requestJson(port, "/api/analytics/detailed");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const concurrent = await requestJson(port, "/api/analytics/detailed");
    if (concurrent.statusCode !== 429) {
      throw new Error(`concurrent detailed should return 429, got ${concurrent.statusCode}`);
    }

    const firstDetailed = await firstDetailedPromise;
    if (firstDetailed.statusCode !== 200) throw new Error(`detailed failed: ${firstDetailed.statusCode} ${firstDetailed.body}`);
    if (firstDetailed.json?.range?.key !== "today") throw new Error(`default detailed range is not today: ${firstDetailed.body}`);
    if (!firstDetailed.json?.truncated || Number(firstDetailed.json?.eventsUsed || 0) !== 5) {
      throw new Error(`detailed did not truncate at max events: ${firstDetailed.body}`);
    }
    if (logs.includes("[analytics-catalog-snapshot] start")) {
      throw new Error("catalog snapshot ran while disabled");
    }

    const cached = await requestJson(port, "/api/analytics/detailed");
    if (cached.statusCode !== 200 || cached.json?.cacheHit !== true) {
      throw new Error(`second detailed request did not hit cache: ${cached.statusCode} ${cached.body}`);
    }

    console.log(JSON.stringify({
      ok: true,
      liveEventsLastHour: live.json.eventsLastHour,
      defaultRange: firstDetailed.json.range.key,
      truncated: firstDetailed.json.truncated,
      eventsUsed: firstDetailed.json.eventsUsed,
      concurrentStatus: concurrent.statusCode,
      cacheHit: cached.json.cacheHit,
      catalogSnapshotDisabled: !logs.includes("[analytics-catalog-snapshot] start"),
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
