const { generateProductSeo } = require("../../backend/utils/productSeo");
const { detectProductType } = require("../../backend/utils/productTaxonomy");

describe("product SEO taxonomy", () => {
  test("RESIN PC is never treated as a screen module", () => {
    const product = { name: "RESIN PC", brand: "Samsung", sku: "0103-009557" };
    const productType = detectProductType(product);
    const seo = generateProductSeo(product);
    expect(["Repuesto", "Adhesivo / pegamento"]).toContain(productType);
    expect(productType).not.toBe("Pantalla / display");
    expect(seo.title).toBe("RESIN PC | NERIN Parts");
    expect(seo.description).toContain("RESIN PC disponible en NERIN Parts.");
    expect(seo.description).toContain("SKU/código de pieza");
    expect(seo.description).toContain("SKU: 0103-009557.");
    expect(`${seo.title} ${seo.description}`).not.toMatch(/M[oó]dulo Pantalla|Samsung Galaxy|Original Service Pack/i);
  });

  test("real display is classified as screen", () => {
    const product = { description: "Display incl. frame Original Samsung Galaxy S25 SM-S931", brand: "Samsung", model: "Galaxy S25 SM-S931", quality: "Original" };
    expect(detectProductType(product)).toBe("Pantalla / display");
    const seo = generateProductSeo(product);
    expect(seo.title).toContain("Display incl. frame Original Samsung Galaxy S25 SM-S931");
    expect(`${seo.title} ${seo.description}`).not.toMatch(/M[oó]dulo Pantalla|Pantalla para|Original Service Pack/i);
  });

  test("display adhesive is adhesive, not screen", () => {
    expect(detectProductType({ name: "Display adhesive Samsung" })).toBe("Adhesivo para pantalla");
  });

  test("screen protection tempered glass is protector", () => {
    expect(detectProductType({ name: "Screen protection tempered glass" })).toBe("Protector de pantalla");
  });

  test("charging board is charge port board", () => {
    expect(detectProductType({ name: "Charging board Samsung" })).toBe("Placa / pin de carga");
  });

  test("dock connector is charge port board", () => {
    expect(detectProductType({ name: "Dock connector iPhone" })).toBe("Placa / pin de carga");
  });

  test("pressing jig display is repair tool", () => {
    expect(detectProductType({ name: "Pressing jig display" })).toBe("Herramienta / accesorio tecnico");
  });

  test("battery is battery", () => {
    expect(detectProductType({ name: "Battery Samsung" })).toBe("Batería");
  });

  test("flex cable is internal flex", () => {
    expect(detectProductType({ name: "Flex cable" })).toBe("Flex / cable interno");
  });

  test("RESIN PC keeps real commercial name in SEO", () => {
    const product = { name: "RESIN PC" };
    const seo = generateProductSeo(product);
    expect(seo.title).toContain("RESIN PC");
    expect(`${seo.title} ${seo.description}`).not.toMatch(/M[oó]dulo Pantalla|Pantalla para|Samsung Galaxy|Original Service Pack/i);
  });

});
