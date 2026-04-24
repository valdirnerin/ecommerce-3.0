const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseEuropeanDecimal,
  toImportedRecord,
  importCatalogCsvFile,
} = require("../services/catalogCsvImport");

describe("catalogCsvImport", () => {
  test("parseEuropeanDecimal soporta coma decimal", () => {
    expect(parseEuropeanDecimal("10,17")).toBe(10.17);
    expect(parseEuropeanDecimal("1.234,56")).toBe(1234.56);
  });

  test("toImportedRecord transforma imágenes y flags", () => {
    const row = {
      PartId: "1001",
      ManufacturerName: "ACME",
      ManufacturerId: "44",
      ManufacturerArticleCode: "",
      MainCategory: "Display",
      SubCategory: "OLED",
      PartNumber: "ABC-123",
      Description: "Pantalla iPhone, calidad premium",
      Status: "Available (longer delivery time)",
      CanBeOrdered: "Yes",
      UnitPrice: "10,17",
      StockQuantity: "12",
      MaximumQuantityInOrder: "5",
      Quality: "Original",
      Remarks: "",
      ImageUrl: "https://cdn.example.com/1.jpg",
      ImageUrl2: "",
      ImageUrl3: "https://cdn.example.com/2.jpg",
      ImageUrl4: "",
      ImageUrl5: "",
      EanNumber: "",
      CountryOfOrigin: "CN",
      ProductGroup: "Mobile",
    };

    const transformed = toImportedRecord(row, 2).record;
    expect(transformed.externalId).toBe(1001);
    expect(transformed.images).toEqual([
      "https://cdn.example.com/1.jpg",
      "https://cdn.example.com/2.jpg",
    ]);
    expect(transformed.isAvailable).toBe(true);
    expect(transformed.hasLongerDeliveryTime).toBe(true);
    expect(transformed.isExpiring).toBe(false);
    expect(transformed.manufacturerArticleCode).toBeNull();
    expect(transformed.remarks).toBeNull();
  });

  test("importCatalogCsvFile devuelve errores por duplicados y parsea descripción con comas", async () => {
    const csv = [
      "PartId,ManufacturerName,ManufacturerId,ManufacturerArticleCode,MainCategory,SubCategory,PartNumber,Description,Status,CanBeOrdered,UnitPrice,StockQuantity,MaximumQuantityInOrder,Quality,Remarks,ImageUrl,ImageUrl2,ImageUrl3,ImageUrl4,ImageUrl5,EanNumber,CountryOfOrigin,ProductGroup",
      '1001,ACME,1,,Main,Sub,SKU-1,"Desc, con coma",Available,Yes,"10,17",5,2,Original,,https://img/1.jpg,,,,,,CN,Mobile',
      '1001,ACME,1,,Main,Sub,SKU-2,"Otro",Available,Yes,"11,00",5,2,Original,,https://img/2.jpg,,,,,,CN,Mobile',
      '1003,ACME,1,,Main,Sub,SKU-1,"Dup partnumber",Available,Yes,"11,00",5,2,Original,,https://img/3.jpg,,,,,,CN,Mobile',
    ].join("\n");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-import-test-"));
    const filePath = path.join(tempDir, "catalog.csv");
    fs.writeFileSync(filePath, csv, "utf8");

    let upsertValues = null;
    const query = jest.fn(async (sql, values) => {
      if (/SELECT id, metadata/.test(sql)) return { rows: [] };
      if (/INSERT INTO products/.test(sql)) {
        upsertValues = values;
        return { rows: [{ inserted: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await importCatalogCsvFile({
      filePath,
      pool: { query },
      chunkSize: 2,
    });

    expect(result.totalRows).toBe(3);
    expect(result.inserted).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.errors.some((err) => /PartId duplicado/.test(err.message))).toBe(true);
    expect(result.errors.some((err) => /PartNumber duplicado/.test(err.message))).toBe(true);
    expect(result.pricing).toBeDefined();
    expect(result.pricing.processedRows).toBe(3);
    expect(result.pricing.okRows).toBe(3);
    expect(upsertValues).toBeTruthy();
    const metadata = upsertValues[5];
    expect(metadata.supplierImport.pricing.tiempo_demora_dias).toBe(20);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
