const fs = require("fs");
const { DATA_DIR, dataPath } = require("../backend/utils/dataDir");
const productsStreamRepo = require("../backend/data/productsStreamRepo");

async function main() {
  const productsFilePath = dataPath("products.json");
  const manifestPath = dataPath("products.manifest.json");
  const exists = fs.existsSync(productsFilePath);
  const productsFileSizeBytes = exists
    ? Number(fs.statSync(productsFilePath).size || 0)
    : 0;

  if (!exists) {
    throw new Error(`products.json no existe en ${productsFilePath}`);
  }

  const counters = {
    productCount: 0,
    supplierProductCount: 0,
    withSupplierPartNumber: 0,
    publicableCount: 0,
    hiddenCount: 0,
  };

  await productsStreamRepo.streamProducts({
    filePath: productsFilePath,
    onProduct: (product) => {
      counters.productCount += 1;
      if (product?.metadata?.supplierImport?.externalId != null) {
        counters.supplierProductCount += 1;
      }
      const supplierPartNumber =
        product?.metadata?.supplierImport?.supplierPartNumber ||
        product?.metadata?.supplierPartNumber ||
        product?.sku;
      if (String(supplierPartNumber || "").trim()) {
        counters.withSupplierPartNumber += 1;
      }
      const isPublic = String(product?.visibility || "public").toLowerCase() !== "private";
      const enabled = product?.enabled !== false;
      if (isPublic && enabled) counters.publicableCount += 1;
      else counters.hiddenCount += 1;
    },
  });

  const payload = {
    ...counters,
    updatedAt: new Date().toISOString(),
    productsFileSizeBytes,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("[products-manifest] rebuilt", {
    manifestPath,
    dataDir: DATA_DIR,
    ...payload,
  });
}

main().catch((error) => {
  console.error("[products-manifest] failed", error?.message || error);
  process.exit(1);
});
