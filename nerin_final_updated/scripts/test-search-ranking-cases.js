const {
  computeSearchIntent,
  rankRowsBySearchIntent,
} = require("../backend/data/productsSqliteRepo");

const fixtures = [
  { rowid: 1, name: "Display (Original), Apple iPhone 12 mini", model: "iPhone 12 mini", brand: "Apple", category: "Display" },
  { rowid: 2, name: "Display (Original), Apple iPhone 12 Pro Max", model: "iPhone 12 Pro Max", brand: "Apple", category: "Display" },
  { rowid: 3, name: "Display (Original), Apple iPhone 12", model: "iPhone 12", brand: "Apple", category: "Display" },
  { rowid: 4, name: "Display (Original), Apple iPhone 12 Pro", model: "iPhone 12 Pro", brand: "Apple", category: "Display" },
  { rowid: 5, name: "Display (Original), Apple iPhone 13", model: "iPhone 13", brand: "Apple", category: "Display" },
  { rowid: 6, name: "Bateria Apple iPhone 12", model: "iPhone 12", brand: "Apple", category: "Bateria" },
  { rowid: 7, name: "Tapa trasera Apple iPhone 12", model: "iPhone 12", brand: "Apple", category: "Tapa trasera" },
];

function rank(query) {
  return rankRowsBySearchIntent(fixtures, computeSearchIntent(query), { preferPositiveScores: true });
}

function topTitle(query) {
  return rank(query)[0]?.row?.name || "";
}

function assertTop(query, expected, forbidden = []) {
  const title = topTitle(query);
  const lower = title.toLowerCase();
  if (!title.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`Query "${query}" expected first result containing "${expected}", got "${title}"`);
  }
  for (const term of forbidden) {
    if (lower.includes(term.toLowerCase())) {
      throw new Error(`Query "${query}" first result must not contain "${term}", got "${title}"`);
    }
  }
  return title;
}

const checks = [
  ["iphone 12 display", "Display (Original), Apple iPhone 12", ["mini", "pro max"]],
  ["iphone 12 mini display", "iPhone 12 mini"],
  ["iphone 12 pro max display", "iPhone 12 Pro Max"],
  ["iphone 12 pro display", "iPhone 12 Pro"],
  ["iphone 13 display", "iPhone 13"],
  ["iphone 12 bateria", "Bateria Apple iPhone 12"],
  ["iphone 12 tapa", "Tapa trasera Apple iPhone 12"],
  ["display iphone 12", "Display (Original), Apple iPhone 12", ["mini", "pro max"]],
  ["pantalla iphone 12", "Display (Original), Apple iPhone 12", ["mini", "pro max"]],
];

for (const [query, expected, forbidden = []] of checks) {
  const title = assertTop(query, expected, forbidden);
  const ranked = rank(query).slice(0, 4).map((entry, index) => ({
    position: index + 1,
    score: entry.score,
    title: entry.row.name,
    reasons: entry.debug.reasons.map((reason) => `${reason.label} ${reason.score > 0 ? "+" : ""}${reason.score}`).join("; "),
  }));
  console.log(`[search-ranking-test] PASS ${query} -> ${title}`);
  if (query === "iphone 12 display") {
    console.log("[search-ranking-test] debug iphone 12 display");
    console.table(ranked);
  }
}
