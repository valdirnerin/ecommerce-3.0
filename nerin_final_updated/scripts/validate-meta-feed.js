const EXPECTED_HEADERS = [
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (current.length || row.length) {
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
      }
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function hasErrors(errors) {
  return Array.isArray(errors) && errors.length > 0;
}

async function main() {
  const feedUrl =
    process.env.META_FEED_URL || "http://localhost:3000/meta-feed.csv";
  const res = await fetch(feedUrl);
  if (!res.ok) {
    console.error(`No se pudo descargar el feed (${res.status})`);
    process.exit(1);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) {
    console.error("Feed vacío");
    process.exit(1);
  }
  const [headerRow, ...dataRows] = rows;
  const headerMismatch =
    headerRow.length !== EXPECTED_HEADERS.length ||
    headerRow.some((h, idx) => h !== EXPECTED_HEADERS[idx]);
  const errors = [];
  if (headerMismatch) {
    errors.push(
      `Headers inválidos. Esperado: ${EXPECTED_HEADERS.join(", ")}. Recibido: ${headerRow.join(
        ", ",
      )}`,
    );
  }
  const availabilityAllowed = new Set(["in stock", "out of stock"]);
  const priceRegex = /^\d+(?:\.\d{2})\sARS$/;
  dataRows.forEach((row, index) => {
    const line = index + 2;
    if (row.length !== EXPECTED_HEADERS.length) {
      errors.push(`Fila ${line}: columnas inválidas (${row.length}).`);
      return;
    }
    const record = Object.fromEntries(
      EXPECTED_HEADERS.map((key, idx) => [key, row[idx]]),
    );
    if (!record.id) {
      errors.push(`Fila ${line}: id vacío.`);
    }
    if (!availabilityAllowed.has(record.availability)) {
      errors.push(
        `Fila ${line}: availability inválido (${record.availability}).`,
      );
    }
    if (record.condition !== "new") {
      errors.push(`Fila ${line}: condition inválido (${record.condition}).`);
    }
    if (!priceRegex.test(record.price)) {
      errors.push(`Fila ${line}: price inválido (${record.price}).`);
    }
    if (!/^https:\/\//i.test(record.link || "")) {
      errors.push(`Fila ${line}: link inválido (${record.link}).`);
    }
    if (!/^https:\/\//i.test(record.image_link || "")) {
      errors.push(`Fila ${line}: image_link inválido (${record.image_link}).`);
    }
  });
  if (hasErrors(errors)) {
    console.error("Errores encontrados:");
    errors.forEach((err) => console.error(`- ${err}`));
    process.exit(1);
  }
  console.log(
    `Feed válido (${dataRows.length} productos) desde ${feedUrl}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
