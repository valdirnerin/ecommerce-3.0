const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let changedFiles = 0;

function filePath(rel) { return path.join(root, rel); }
function read(rel) { return fs.readFileSync(filePath(rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(filePath(rel), text, "utf8"); }
function patch(rel, updater) {
  const before = read(rel);
  const after = updater(before);
  if (after !== before) {
    write(rel, after);
    changedFiles += 1;
    console.log("[product-auto-content-patch] updated " + rel);
  }
}

patch("backend/utils/productSeo.js", (text) => {
  let next = text;
  if (!next.includes('require("./productAutoContent")')) {
    next = next.replace(/(\nfunction normalizeText\(value\) \{)/, '\nconst { buildProductAutoContent } = require("./productAutoContent");\n$1');
  }
  if (!next.includes("const autoContent = buildProductAutoContent(product);")) {
    next = next.replace(/function generateProductSeo\(product = \{\}\) \{\n/, `function generateProductSeo(product = {}) {
  const autoContent = buildProductAutoContent(product);
  if (autoContent && (autoContent.seoTitle || autoContent.seoDescription)) {
    return {
      title: truncateText(autoContent.seoTitle || "Repuesto NERIN Parts", 160),
      description: truncateText(autoContent.seoDescription || autoContent.shortDescription || "", 200),
      ogTitle: autoContent.h1 || autoContent.seoTitle,
      ogDescription: autoContent.longDescription || autoContent.seoDescription,
    };
  }

`);
  }
  return next;
});

patch("backend/services/catalogCsvImport.js", (text) => {
  let next = text;
  if (!next.includes("quality: imported.quality,")) {
    next = next.replace(/(\s+csvMaximumQuantityInOrder: imported\.maximumQuantityInOrder,\n)/, "$1      quality: imported.quality,\n      remarks: imported.remarks,\n");
    next = next.replace(/(\s+supplierPartNumber: imported\.supplierPartNumber,\n)/, "$1    quality: imported.quality,\n    remarks: imported.remarks,\n");
    next = next.replace(/(\s+brand: imported\.manufacturerName,\n)/, "$1    quality: imported.quality,\n    remarks: imported.remarks,\n");
  }
  return next;
});

patch("backend/server.js", (text) => {
  let next = text;
  if (!next.includes('require("./utils/productAutoContent")')) {
    next = next.replace(/(\} = require\("\.\/utils\/productSeo"\);\n)/, '$1const { buildProductAutoContent } = require("./utils/productAutoContent");\nconst { evaluateProductSeoQuality } = require("./utils/productSeoQuality");\n');
  }
  if (!next.includes("function isProductIndexable(product)")) {
    next = next.replace(/(\n  return hasIdentifier;\n\}\n\n)function getProductLastModifiedDate/, `$1function isProductIndexable(product) {
  if (!isProductPublic(product)) return false;
  const autoContent = buildProductAutoContent(product || {});
  return evaluateProductSeoQuality(product || {}, autoContent).indexable;
}

function getProductLastModifiedDate`);
  }
  next = next.replace(/function buildFeaturePhrase\(product\) \{\n(?!\s+const autoContent = buildProductAutoContent)/, `function buildFeaturePhrase(product) {
  const autoContent = buildProductAutoContent(product || {});
  if (autoContent.shortDescription) return autoContent.shortDescription;
`);
  next = next.replace(/function buildProductSeoTitle\(product\) \{\n(?!\s+const autoContent = buildProductAutoContent)/, `function buildProductSeoTitle(product) {
  const autoContent = buildProductAutoContent(product || {});
  if (autoContent.seoTitle) return autoContent.seoTitle;
`);
  next = next.replace(/function buildProductHeading\(product\) \{\n(?!\s+const autoContent = buildProductAutoContent)/, `function buildProductHeading(product) {
  const autoContent = buildProductAutoContent(product || {});
  if (autoContent.h1) return autoContent.h1;
`);
  next = next.replace(/function buildProductMetaDescription\(product\) \{\n(?!\s+const autoContent = buildProductAutoContent)/, `function buildProductMetaDescription(product) {
  const autoContent = buildProductAutoContent(product || {});
  if (autoContent.seoDescription) return autoContent.seoDescription;
`);
  next = next.replace(/const productEntries = products\.filter\(\(p\)=>isProductPublic\(p\)\)/g, "const productEntries = products.filter((p)=>isProductIndexable(p))");
  next = next.replace(/\.filter\(\(product\) => isProductPublic\(product\)\)/g, ".filter((product) => isProductIndexable(product))");
  next = next.replace(/function renderProductInfoSsr\(product, siteBase\) \{\n\s+const heading = buildProductHeading\(product\);\n\s+const description = buildFeaturePhrase\(product\);/, `function renderProductInfoSsr(product, siteBase) {
  const autoContent = buildProductAutoContent(product || {});
  const heading = autoContent.h1 || buildProductHeading(product);
  const description = autoContent.shortDescription || buildFeaturePhrase(product);`);
  next = next.replace(/(\s+const stockValue = typeof product\?\.stock === "number" \? product\.stock : null;\n)\s+const technology = inferDisplayTechnology\(product\);\n\s+const frame = inferHasFrame\(product\);/, `$1  const specs = autoContent.technicalSpecs || {};
  const technology = null;
  const frame = null;`);
  if (!next.includes("specs.calidad ? `<li><strong>Calidad:")) {
    next = next.replace(/(\s+const infoItems = \[\n)/, `$1    specs.calidad ? \`<li><strong>Calidad:</strong> \${esc(specs.calidad)}</li>\` : "",
    specs.tecnologia ? \`<li><strong>Tecnologia:</strong> \${esc(specs.tecnologia)}</li>\` : "",
    specs.tipoRepuesto ? \`<li><strong>Tipo de repuesto:</strong> \${esc(specs.tipoRepuesto)}</li>\` : "",
    specs.marcaModelo ? \`<li><strong>Marca/modelo:</strong> \${esc(specs.marcaModelo)}</li>\` : "",
    specs.condicion ? \`<li><strong>Condicion:</strong> \${esc(specs.condicion)}</li>\` : "",
    specs.origen ? \`<li><strong>Origen:</strong> \${esc(specs.origen)}</li>\` : "",
    specs.montaje ? \`<li><strong>Montaje:</strong> \${esc(specs.montaje)}</li>\` : "",
    specs.disponibilidad ? \`<li><strong>Disponibilidad:</strong> \${esc(specs.disponibilidad)}</li>\` : "",
`);
  }
  next = next.replace(/const compatibility = \[brand, model, sku\]\.filter\(Boolean\)\.join\(" "\);\n\s+const compatibilityHtml = compatibility\n\s+\? `<p class=\\"product-compatibility\\">Compatible con \$\{esc\(compatibility\)\}\.<\/p>`/, `const compatibility = autoContent.compatibilityNotice || [brand, model, sku].filter(Boolean).join(" ");
  const compatibilityHtml = compatibility
    ? \`<p class=\\"product-compatibility\\">\${esc(compatibility)}</p>\``);
  next = next.replace(/(\s+const name = product\.name \|\| "";\n)(?!\s+const autoContent = buildProductAutoContent)/, `$1    const autoContent = buildProductAutoContent(product);
    const seoQuality = evaluateProductSeoQuality(product, autoContent);
`);
  next = next.replace(/const seoTitle = productSeo\.title \|\| buildProductSeoTitle\(product\);/, "const seoTitle = autoContent.seoTitle || productSeo.title || buildProductSeoTitle(product);");
  next = next.replace(/const description = productSeo\.description \|\| buildProductMetaDescription\(product\);/, "const description = autoContent.seoDescription || productSeo.description || buildProductMetaDescription(product);");
  next = next.replace(/const h1 = buildProductHeading\(product\);/, "const h1 = autoContent.h1 || buildProductHeading(product);");
  if (!next.includes("const schemaCondition = /reacondicionado/i.test")) {
    next = next.replace(/(\s+const formattedPrice = Number\.isFinite\(numericPrice\)\n\s+\? numericPrice\.toFixed\(2\)\n\s+: "0\.00";\n)/, `$1    const schemaCondition = /reacondicionado/i.test(autoContent.detected?.condition || "")
      ? "https://schema.org/RefurbishedCondition"
      : /(usado|retirado|pre-owned)/i.test(autoContent.detected?.condition || "")
        ? "https://schema.org/UsedCondition"
        : "https://schema.org/NewCondition";
`);
  }
  next = next.replace(/itemCondition: "https:\/\/schema\.org\/NewCondition",/, "itemCondition: schemaCondition,");
  if (!next.includes('<meta name="robots" content="${esc(seoQuality.robots)}">')) {
    next = next.replace(/(`\<meta name="description" content="\$\{esc\(metaDescription\)\}"\>`,\n)/, '$1      `<meta name="robots" content="${esc(seoQuality.robots)}">`,\n');
  }
  return next;
});

console.log("[product-auto-content-patch] complete; changedFiles=" + changedFiles);
