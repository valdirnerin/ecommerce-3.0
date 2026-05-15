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

describe("bulk publish eligibility", () => {
  test("private and hidden block by default", () => {
    expect(resolveBulkPublishEligibility(validProduct({ visibility: "private" })).reasons).toContain("private");
    expect(resolveBulkPublishEligibility(validProduct({ status: "hidden" })).reasons).toContain("hidden");
    expect(resolveBulkPublishEligibility(validProduct({ hidden: true })).reasons).toContain("hidden");
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
    ["disabled", { enabled: false }],
    ["disabled", { enabled: 0 }],
    ["draft", { status: "draft" }],
    ["vip_only", { vip_only: true }],
    ["wholesale_only", { wholesale_only: true }],
  ])("%s always blocks", (reason, overrides) => {
    const result = resolveBulkPublishEligibility(validProduct({ visibility: "private", ...overrides }), {
      includePrivateHidden: true,
    });
    expect(result.reasons).toContain(reason);
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

  test("preview summary separates public candidates from private/hidden candidates", () => {
    const summary = summarizeBulkPublishProducts(
      [
        validProduct({ id: "public-candidate" }),
        validProduct({ id: "private-candidate", visibility: "private" }),
        validProduct({ id: "blocked-candidate", price: 0 }),
      ],
      { includePrivateHidden: true, totalCatalogProducts: 3, publicProductsCount: 1 },
    );

    expect(summary.totalCatalogProducts).toBe(3);
    expect(summary.publicProductsCount).toBe(1);
    expect(summary.scannedRows).toBe(3);
    expect(summary.eligiblePublicCandidates).toBe(1);
    expect(summary.eligiblePrivateHiddenCandidates).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.reasons.missing_price).toBe(1);
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
