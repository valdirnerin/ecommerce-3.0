const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

function createWorkbook(filePath, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Price list");
  XLSX.writeFile(wb, filePath);
}

describe("stockXlsxImport", () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  function loadImporterWithDataDir(dataDir) {
    jest.resetModules();
    process.env.DATA_DIR = dataDir;
    return require("../services/stockXlsxImport");
  }

  test("parseSupplierStock interpreta formato con +", () => {
    const { parseSupplierStock } = loadImporterWithDataDir(
      fs.mkdtempSync(path.join(os.tmpdir(), "stock-xlsx-test-")),
    );
    expect(parseSupplierStock("25+")).toEqual({
      stockQuantity: 25,
      stockRaw: "25+",
      stockIsAtLeast: true,
    });
  });

  test("importStockXlsxFile actualiza stock y resume unmatched/errores", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-xlsx-test-"));
    const filePath = path.join(tempDir, "stock.xlsx");
    const productsPath = path.join(tempDir, "products.json");
    fs.writeFileSync(
      productsPath,
      JSON.stringify(
        {
          products: [
            {
              id: "1",
              sku: "GH82-33638A",
              stock: 1,
              metadata: { supplierPartNumber: "GH82-33638A" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    createWorkbook(filePath, [
      ["Article number", "Quantity in stock (NL)"],
      ["GH82-33638A", "25+"],
      ["GH82-00000X", "0"],
      ["GH82-BAD", "foo"],
      ["", "10"],
    ]);

    const { importStockXlsxFile } = loadImporterWithDataDir(tempDir);

    const summary = await importStockXlsxFile({
      filePath,
    });

    expect(summary.totalRows).toBe(4);
    expect(summary.matchedProducts).toBe(1);
    expect(summary.updatedProducts).toBe(1);
    expect(summary.unmatchedRows).toBe(1);
    expect(summary.failedRows).toBe(2);
    expect(summary.stockWithPlus).toBe(1);
    expect(summary.zeroStockRows).toBe(1);
    expect(summary.errors.length).toBe(2);
    const saved = JSON.parse(fs.readFileSync(productsPath, "utf8"));
    expect(saved.products[0].stock).toBe(25);
    expect(saved.products[0].stockRaw).toBe("25+");
    expect(saved.products[0].stockIsAtLeast).toBe(true);
    expect(saved.products[0].metadata.stockSource).toBe("mps_xlsx_nl");
    expect(fs.existsSync(`${productsPath}.bak`)).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("zeroMissingProducts no pisa a 0 productos vistos con stock inválido", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-xlsx-test-"));
    const filePath = path.join(tempDir, "stock.xlsx");
    const productsPath = path.join(tempDir, "products.json");
    fs.writeFileSync(
      productsPath,
      JSON.stringify(
        {
          products: [
            {
              id: "1",
              sku: "GH82-BAD",
              stock: 7,
              metadata: { supplierPartNumber: "GH82-BAD" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    createWorkbook(filePath, [
      ["Article number", "Quantity in stock (NL)"],
      ["GH82-BAD", "foo"],
    ]);

    const { importStockXlsxFile } = loadImporterWithDataDir(tempDir);
    const summary = await importStockXlsxFile({
      filePath,
      zeroMissingProducts: true,
    });

    const saved = JSON.parse(fs.readFileSync(productsPath, "utf8"));
    expect(summary.failedRows).toBe(1);
    expect(summary.zeroedMissingProducts).toBe(0);
    expect(saved.products[0].stock).toBe(7);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
