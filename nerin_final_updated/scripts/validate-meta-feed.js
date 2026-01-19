const http = require("http");
const https = require("https");

const FEED_URL =
  process.env.META_FEED_URL || "http://localhost:3000/meta-feed.csv";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function isHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    return ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function validateRows(headers, rows) {
  const errors = [];
  const availabilitySet = new Set(["in stock", "out of stock"]);
  const priceRegex = /^\d+(\.\d{2})\sARS$/;
  rows.forEach((row, index) => {
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = row[idx] || "";
    });
    if (!record.id) {
      errors.push(`Fila ${index + 2}: id vacío`);
    }
    if (!availabilitySet.has(record.availability)) {
      errors.push(`Fila ${index + 2}: availability inválido (${record.availability})`);
    }
    if (!priceRegex.test(record.price)) {
      errors.push(`Fila ${index + 2}: price inválido (${record.price})`);
    }
    if (!isHttpsUrl(record.link)) {
      errors.push(`Fila ${index + 2}: link inválido (${record.link})`);
    }
    if (!isHttpsUrl(record.image_link)) {
      errors.push(`Fila ${index + 2}: image_link inválido (${record.image_link})`);
    }
  });
  return errors;
}

async function run() {
  const csv = await fetchText(FEED_URL);
  const lines = csv.trim().split("\n");
  if (!lines.length) {
    console.error("El feed está vacío.");
    process.exit(1);
  }
  const headers = parseCsvLine(lines[0]);
  const expected = [
    "id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "link",
    "image_link",
    "brand",
    "mpn",
  ];
  if (headers.join(",") !== expected.join(",")) {
    console.error("Headers inválidos:", headers);
    console.error("Se esperaba:", expected);
    process.exit(1);
  }
  const rows = lines.slice(1).filter(Boolean).map(parseCsvLine);
  const errors = validateRows(headers, rows);
  if (errors.length) {
    console.error("Errores encontrados:");
    errors.forEach((err) => console.error(`- ${err}`));
    process.exit(1);
  }
  console.log(`OK: ${rows.length} filas válidas.`);
}

run().catch((err) => {
  console.error("Error al validar feed:", err.message || err);
  process.exit(1);
});
