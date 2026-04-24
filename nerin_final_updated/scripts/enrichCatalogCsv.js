#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const {
  computePricingForRow,
  createPricingSummaryAccumulator,
  PRICING_OUTPUT_COLUMNS,
} = require("../backend/services/catalogPricing");

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[,"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvLine(values) {
  return values.map(csvEscape).join(",") + "\n";
}

function usage() {
  console.error("Uso: node scripts/enrichCatalogCsv.js <input.csv> [output.csv]");
}

async function run() {
  const input = process.argv[2];
  const output = process.argv[3] || path.join(process.cwd(), "catalog_enriched.csv");
  if (!input) {
    usage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);

  if (!fs.existsSync(inputPath)) {
    console.error(`No existe el archivo: ${inputPath}`);
    process.exit(1);
  }

  const summary = createPricingSummaryAccumulator();
  let headersWritten = false;
  let outputHeaders = [];

  const writer = fs.createWriteStream(outputPath, { encoding: "utf8" });
  const parser = fs.createReadStream(inputPath, { encoding: "utf8" }).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  for await (const row of parser) {
    if (!headersWritten) {
      outputHeaders = [...Object.keys(row), ...PRICING_OUTPUT_COLUMNS];
      writer.write(toCsvLine(outputHeaders));
      headersWritten = true;
    }

    const pricingResult = computePricingForRow(row, undefined, {
      costColumn: row.UnitPrice != null ? "UnitPrice" : undefined,
      currencyHeuristics: { assumeEuropeanSupplier: true },
    });

    const enriched = {
      ...row,
      ...pricingResult.pricing,
    };

    summary.add(row, pricingResult.pricing);

    const ordered = outputHeaders.map((key) => enriched[key]);
    writer.write(toCsvLine(ordered));
  }

  writer.end();
  await new Promise((resolve) => writer.on("finish", resolve));

  const report = summary.finalize();

  console.log(JSON.stringify({
    output: outputPath,
    summary: report,
  }, null, 2));
}

run().catch((error) => {
  console.error("Error enriqueciendo CSV:", error);
  process.exit(1);
});
