const { classifyCatalogProduct, parseCatalogQuery } = require("../../backend/utils/catalogClassifier");

describe("catalogClassifier", () => {
  test.each([
    ["Display Incl Frame Original Green Honor 9X Lite", { part_type: "display", device_brand: "Honor", model_base: "Honor 9X Lite", quality_tier: "original", has_frame: true, color: "green" }],
    ["Battery High Capacity Best Possible for iPhone 6S", { part_type: "battery", device_brand: "Apple", compatible_brand: "Apple", is_compatible_for_brand: true, model_base: "iPhone 6S", quality_tier: "compatible" }],
    ["Keyset Simcard Tray Black for iPhone 14 Pro", { part_type: "sim_tray", model_base: "iPhone 14 Pro", model_variant: "pro", color: "black" }],
    ["Display JK Compatible Hard OLED for iPhone 15 Pro", { part_type: "display", device_brand: "Apple", model_base: "iPhone 15 Pro", model_variant: "pro", quality_tier: "compatible" }],
    ["Display Original Lavender Samsung Galaxy S23 Plus SM-S916B", { part_type: "display", device_brand: "Samsung", model_base: "Galaxy S23 Plus", model_variant: "plus", color: "lavender" }],
    ["Back Glass Gold Huawei Mate 10 Lite", { part_type: "back_cover", device_brand: "Huawei", model_base: "Huawei Mate 10 Lite", model_variant: "lite", color: "gold" }],
    ["Flex Cable Rear Camera for iPhone 15 Pro Max", { part_type: "flex", device_brand: "Apple", model_base: "iPhone 15 Pro Max", model_variant: "pro max" }],
    ["Antenna GPS Compatible for iPhone 17 Air", { part_type: "antenna", device_brand: "Apple", model_base: "iPhone 17 Air", model_variant: "air", compatible_brand: "Apple" }],
  ])("classifies %s", (title, expected) => {
    const result = classifyCatalogProduct({ title, name: title });
    Object.entries(expected).forEach(([key, value]) => {
      expect(result[key]).toEqual(value);
    });
  });

  test("does not promote for Huawei to official brand without original signal", () => {
    const result = classifyCatalogProduct({ title: "Back Glass Gold for Huawei Mate 10 Lite" });
    expect(result.compatible_brand).toBe("Huawei");
    expect(result.is_compatible_for_brand).toBe(true);
    expect(result.official_brand).toBe("");
  });

  test("parses query intent for exact network and variants", () => {
    expect(parseCatalogQuery("display samsung a15 5g")).toMatchObject({
      part_type: "display",
      device_brand: "Samsung",
      model_base: "Galaxy A15 5G",
      network_variant: "5g",
    });
    expect(parseCatalogQuery("iphone 12 pro display")).toMatchObject({
      model_base: "iPhone 12 Pro",
      model_variant: "pro",
    });
    expect(parseCatalogQuery("iphone 12 pro max display")).toMatchObject({
      model_base: "iPhone 12 Pro Max",
      model_variant: "pro max",
    });
  });
});
