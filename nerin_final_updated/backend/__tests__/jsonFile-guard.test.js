const fs = require("fs");
const os = require("os");
const path = require("path");
const { readJsonFile } = require("../utils/jsonFile");

describe("readJsonFile guard for products.json", () => {
  test("throws controlled error for large products.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-products-guard-"));
    const productsPath = path.join(tmpDir, "products.json");
    const payload = " ".repeat(5 * 1024 * 1024 + 256);
    fs.writeFileSync(productsPath, payload, "utf8");

    expect(() => readJsonFile(productsPath)).toThrow(
      "Forbidden full parse of products.json. Use productsStreamRepo instead.",
    );
  });
});
