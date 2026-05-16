const {
  resolveBulkPublishEligibility,
  summarizeBulkPublishProducts,
  buildBulkPublishPatch,
} = require("../../backend/data/productsSqliteRepo");

const validProduct = (overrides = {}) => ({
  id: "prod-1",
  sku: "SKU-1",
  name: "iPhone 15 Pro Battery",
  price: 1000,
  visibility: "catalog",
  status: "active",
  enabled: true,
  stock: 0,
  ...overrides,
});

const catalogImportMetadata = (overrides = {}) => ({
  importSource: "catalog_csv",
  supplierPartNumber: "GH82-12345A",
  csvStockQuantity: 0,
  supplierImport: {
    source: "parts_csv",
    supplierPartNumber: "GH82-12345A",
    csvStatus: "Available",
    csvCanBeOrdered: true,
    csvStockQuantity: 0,
    csvMaximumQuantityInOrder: 10,
    ...overrides.supplierImport,
  },
  ...overrides,
});

describe("bulk publish eligibility", () => {
  test("private and hidden block by default", () => {
    expect(resolveBulkPublishEligibility(validProduct({ visibility: "private" })).reasons).toContain("private_visibility");
    expect(resolveBulkPublishEligibility(validProduct({ status: "hidden" })).reasons).toContain("hidden_visibility");
    expect(resolveBulkPublishEligibility(validProduct({ hidden: true })).reasons).toContain("hidden_visibility");
  });

  test("private and hidden can be eligible when includePrivateHidden=true", () => {
    expect(resolveBulkPublishEligibility(validProduct({ visibility: "private" }), { includePrivateHidden: true }).eligible).toBe(true);
    expect(resolveBulkPublishEligibility(validProduct({ status: "hidden" }), { includePrivateHidden: true }).eligible).toBe(true);
  });

  test.each([
    ["missing_name", { name: "", title: "" }],
    ["missing_identifier", { id: "", sku: "", code: "" }],
    ["missing_price", { price: 0, price_minorista: 0, precio_minorista: 0, precio_final: 0 }],
    ["deleted", { deleted: true }],
    ["archived", { archived: true }],
    ["draft", { status: "draft" }],
    ["vip_only", { vip_only: true }],
    ["wholesale_only", { wholesale_only: true }],
  ])("%s remains an absolute blocker", (reason, overrides) => {
    const result = resolveBulkPublishEligibility(validProduct({
      visibility: "private",
      metadata: catalogImportMetadata(),
      enabled: false,
      ...overrides,
    }), {
      includePrivateHidden: true,
      includeDisabledImportCandidates: true,
    });
    expect(result.reasons).toContain(reason);
    expect(result.eligible).toBe(false);
  });

  test.each([
    ["disabled_enabled_false", { enabled: false }],
    ["disabled_enabled_zero", { enabled: 0 }],
    ["disabled_field_true", { disabled: true }],
    ["disabled_status", { status: "disabled" }],
    ["disabled_visibility", { visibility: "disabled" }],
    [
      "disabled_catalog_import_not_orderable",
      {
        enabled: false,
        metadata: catalogImportMetadata({
          supplierImport: { csvCanBeOrdered: false, csvStockQuantity: 5 },
          csvStockQuantity: 5,
        }),
      },
    ],
    [
      "disabled_stock_import_zero",
      {
        enabled: false,
        stock: 0,
        metadata: catalogImportMetadata(),
      },
    ],
  ])("classifies %s explicitly", (reason, overrides) => {
    const result = resolveBulkPublishEligibility(validProduct(overrides));
    expect(result.diagnostics.disabledReasons).toContain(reason);
    expect(result.reasons).toContain(reason);
    expect(result.eligible).toBe(false);
  });

  test("disabled import and stock candidates require the advanced flag", () => {
    const product = validProduct({ enabled: false, stock: 0, metadata: catalogImportMetadata() });

    const defaultResult = resolveBulkPublishEligibility(product);
    expect(defaultResult.reasons).toEqual(expect.arrayContaining(["disabled_enabled_false", "disabled_stock_import_zero"]));
    expect(defaultResult.eligible).toBe(false);

    const advancedResult = resolveBulkPublishEligibility(product, { includeDisabledImportCandidates: true });
    expect(advancedResult.reasons).toEqual([]);
    expect(advancedResult.eligible).toBe(true);
  });

  test("generic disabled reasons stay hard-blocked even with disabled import flag", () => {
    const product = validProduct({ disabled: true, stock: 0, metadata: catalogImportMetadata() });
    const result = resolveBulkPublishEligibility(product, { includeDisabledImportCandidates: true });

    expect(result.reasons).toContain("disabled_field_true");
    expect(result.eligible).toBe(false);
  });

  test("stock zero, missing image, missing description and generated slug are warnings only", () => {
    const result = resolveBulkPublishEligibility(validProduct({ image: "", description: "", slug: "", public_slug: "" }));

    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "stock_zero_remote_assumed",
      "remote_delivery_estimated",
      "missing_image",
      "missing_description",
      "generated_slug",
    ]));
  });

  test("preview summary separates strict, private hidden, disabled import and hard-blocked candidates", () => {
    const summary = summarizeBulkPublishProducts(
      [
        validProduct({ id: "public-candidate", image: "battery.jpg" }),
        validProduct({ id: "private-candidate", visibility: "private" }),
        validProduct({ id: "disabled-import-candidate", enabled: false, stock: 0, metadata: catalogImportMetadata() }),
        validProduct({ id: "blocked-candidate", price: 0 }),
      ],
      { includePrivateHidden: true, includeDisabledImportCandidates: true, totalCatalogProducts: 4, publicProductsCount: 1 },
    );

    expect(summary.totalCatalogProducts).toBe(4);
    expect(summary.publicProductsCount).toBe(1);
    expect(summary.scannedRows).toBe(4);
    expect(summary.searchMatchedCount).toBe(4);
    expect(summary.withNameCount).toBe(4);
    expect(summary.withIdentifierCount).toBe(4);
    expect(summary.withPriceCount).toBe(3);
    expect(summary.withImageCount).toBe(1);
    expect(summary.strictEligibleCount).toBe(1);
    expect(summary.eligiblePublicCandidates).toBe(2);
    expect(summary.eligiblePrivateHiddenCandidates).toBe(1);
    expect(summary.eligibleDisabledImportCandidates).toBe(1);
    expect(summary.privateHiddenCount).toBe(1);
    expect(summary.advancedPublishableCount).toBe(2);
    expect(summary.hardBlockedCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.reasons.missing_price).toBe(1);
    expect(summary.disabledBreakdown.disabled_stock_import_zero).toBe(1);
  });

  test("publish patch does not change price or stock", () => {
    const product = validProduct({ price: 1234, stock: 7, public_slug: "iphone-15-pro-battery" });
    const patch = buildBulkPublishPatch(product, resolveBulkPublishEligibility(product));

    expect(patch).toMatchObject({
      visibility: "public",
      status: "active",
      enabled: true,
      is_public: true,
    });
    expect(patch).not.toHaveProperty("price");
    expect(patch).not.toHaveProperty("stock");
  });
});
