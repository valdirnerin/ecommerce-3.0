const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DIRS = ["backend", "scripts"];
const OFFENDERS = [];
const RULE_VIOLATIONS = [];
const SERVER_PATH = path.join(ROOT, "backend", "server.js");

function assertNoPatternInBlock({ content, blockName, startPattern, endPattern, forbidden }) {
  const start = content.search(startPattern);
  if (start < 0) return;
  const tail = content.slice(start);
  const endMatch = tail.match(endPattern);
  const block = endMatch ? tail.slice(0, endMatch.index) : tail;
  forbidden.forEach((rule) => {
    if (rule.pattern.test(block)) {
      RULE_VIOLATIONS.push(`${blockName}: ${rule.message}`);
    }
  });
}

function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    const dangerPatterns = [
      /JSON\.parse\(\s*fs\.readFileSync\([\s\S]{0,240}products\.json[\s\S]{0,240}\)\s*\)/gi,
      /JSON\.parse\(\s*await\s+fs\.promises\.readFile\([\s\S]{0,240}products\.json[\s\S]{0,240}\)\s*\)/gi,
    ];
    for (const pattern of dangerPatterns) {
      const matches = content.match(pattern);
      if (matches?.length) {
        OFFENDERS.push({
          file: path.relative(ROOT, fullPath),
          matches: matches.length,
        });
      }
    }
  }
}

for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}

if (OFFENDERS.length) {
  console.error("[check-no-products-full-parse] forbidden patterns found");
  OFFENDERS.forEach((item) => {
    console.error(` - ${item.file} (${item.matches})`);
  });
  process.exit(1);
}

if (fs.existsSync(SERVER_PATH)) {
  const serverContent = fs.readFileSync(SERVER_PATH, "utf8");

  assertNoPatternInBlock({
    content: serverContent,
    blockName: "calculateDetailedAnalytics",
    startPattern: /async function calculateDetailedAnalytics\s*\(/,
    endPattern: /\nfunction getProducts\s*\(/,
    forbidden: [
      { pattern: /\bgetProducts\s*\(/, message: "no debe llamar getProducts()" },
      { pattern: /\bloadProducts\s*\(/, message: "no debe llamar loadProducts()" },
      { pattern: /\breadJsonFile\s*\(/, message: "no debe leer products.json completo" },
      { pattern: /\bJSON\.parse\s*\(/, message: "no debe hacer JSON.parse directo del catálogo" },
    ],
  });

  const analyticsRouteStart = serverContent.indexOf('if (pathname === "/api/analytics/detailed"');
  if (analyticsRouteStart >= 0) {
    const analyticsRouteTail = serverContent.slice(analyticsRouteStart);
    const nextRouteIdx = analyticsRouteTail.indexOf("\n  if (pathname === ");
    const analyticsRouteBlock =
      nextRouteIdx > 0 ? analyticsRouteTail.slice(0, nextRouteIdx) : analyticsRouteTail;
    if (/\bgetProducts\s*\(/.test(analyticsRouteBlock)) {
      RULE_VIOLATIONS.push("/api/analytics/detailed: no debe usar getProducts()");
    }
  }
}

if (RULE_VIOLATIONS.length) {
  console.error("[check-no-products-full-parse] rules violations found");
  RULE_VIOLATIONS.forEach((entry) => console.error(` - ${entry}`));
  process.exit(1);
}

console.log("[check-no-products-full-parse] ok");
