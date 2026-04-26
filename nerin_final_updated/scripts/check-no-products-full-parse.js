const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DIRS = ["backend", "scripts"];
const OFFENDERS = [];

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

console.log("[check-no-products-full-parse] ok");
