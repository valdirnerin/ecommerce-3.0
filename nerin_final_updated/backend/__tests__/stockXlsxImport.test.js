const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const { parseSupplierStock, importStockXlsxFile } = require("../services/stockXlsxImport");

function createWorkbook(filePath, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Price list");
  XLSX.writeFile(wb, filePath);
}

describe("stockXlsxImport", () => {
  test("parseSupplierStock interpreta formato con +", () => {
    expect(parseSupplierStock("25+")).toEqual({
      stockQuantity: 25,
      stockRaw: "25+",
      stockIsAtLeast: true,
    });
  });

  test("importStockXlsxFile actualiza stock y resume unmatched/errores", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-xlsx-test-"));
    const filePath = path.join(tempDir, "stock.xlsx");

    createWorkbook(filePath, [
      ["Article number", "Quantity in stock (NL)"],
      ["GH82-33638A", "25+"],
      ["GH82-00000X", "0"],
      ["GH82-BAD", "foo"],
      ["", "10"],
    ]);

    let updateValues = null;
    const query = jest.fn(async (sql, values) => {
      if (/SELECT id/.test(sql)) {
        return {
          rows: [
            {
              id: "1",
              supplier_part_number: "GH82-33638A",
              nested_supplier_part_number: null,
            },
          ],
        };
      }
      if (/UPDATE products p/.test(sql)) {
        updateValues = values;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const summary = await importStockXlsxFile({
      filePath,
      pool: { query },
    });

    expect(summary.totalRows).toBe(4);
    expect(summary.matchedProducts).toBe(1);
    expect(summary.updatedProducts).toBe(1);
    expect(summary.unmatchedRows).toBe(1);
    expect(summary.failedRows).toBe(2);
    expect(summary.stockWithPlus).toBe(1);
    expect(summary.zeroStockRows).toBe(1);
    expect(summary.errors.length).toBe(2);
    expect(updateValues).toBeTruthy();
    expect(updateValues[1]).toBe(25);
    expect(updateValues[2]).toBe("25+");
    expect(updateValues[3]).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
