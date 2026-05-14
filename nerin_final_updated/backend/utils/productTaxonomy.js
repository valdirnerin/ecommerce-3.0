function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function pickMetadata(product = {}) {
  return product && typeof product.metadata === "object" && product.metadata !== null ? product.metadata : {};
}

function pickSupplierImport(product = {}) {
  const meta = pickMetadata(product);
  return meta && typeof meta.supplierImport === "object" && meta.supplierImport !== null ? meta.supplierImport : {};
}

function pickField(product = {}, keys = []) {
  const meta = pickMetadata(product);
  const supplierImport = pickSupplierImport(product);
  for (const key of keys) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(product, key) && product[key] != null && product[key] !== "") return product[key];
    if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] != null && meta[key] !== "") return meta[key];
    if (Object.prototype.hasOwnProperty.call(supplierImport, key) && supplierImport[key] != null && supplierImport[key] !== "") return supplierImport[key];
  }
  return null;
}

function buildTaxonomyText(product = {}) {
  return [
    pickField(product, ["name", "Name"]),
    pickField(product, ["title", "Title"]),
    pickField(product, ["description", "Description"]),
    pickField(product, ["category", "Category"]),
    pickField(product, ["subcategory", "SubCategory", "subCategory"]),
    pickField(product, ["ProductGroup", "productGroup"]),
    pickField(product, ["quality", "Quality"]),
    pickField(product, ["remarks", "Remarks"]),
    pickField(product, ["MainCategory", "mainCategory"]),
    pickField(product, ["SubCategory", "subCategory"]),
    pickField(product, ["Description"]),
  ].map(normalizeText).filter(Boolean).join(" ").toLowerCase();
}

function has(text, pattern) {
  return pattern.test(text);
}

function detectProductType(product = {}) {
  const text = buildTaxonomyText(product);
  if (!text) return "Repuesto";


  const screenBlockers = /\b(adhesive|tape|glue|protector|pressing\s+jig|tool|flex|charge\s+port|charging\s+board|dock\s+connector|resin|gasket|screw|holder|bracket)\b/i;
  if (has(text, /\b(screen\s+protection|screen\s+protector|tempered\s+glass|vidrio\s+templado|protector(?:\s+de\s+pantalla)?)\b/i)) return "Protector de pantalla";
  if (has(text, /\b(pressing\s+jig|repair\s+tool|tool|herramienta|jig|molde|fixture)\b/i)) return "Herramienta / accesorio técnico";
  if (has(text, /\b(display|screen|pantalla)\s+(adhesive|tape|sticker|seal|sealant|gasket|bonding|glue|oca)\b/i)) return "Adhesivo para pantalla";
  if (has(text, /\b(back|rear|battery)\s+(cover\s+)?(adhesive|tape|sticker|seal|gasket)\b/i)) return "Adhesivo para tapa trasera";
  if (has(text, /\b(resin|adhesive|adhesive\s+tape|glue|tape|sticker|seal|sealant|gasket|bonding|oca|epoxy|pegamento|adhesivo)\b/i)) return "Adhesivo / pegamento";
  if (has(text, /\b(charging\s+board|charge\s+port|dock\s+connector|pin\s+de\s+carga|puerto\s+de\s+carga|placa\s+de\s+carga)\b/i)) return "Placa / pin de carga";
  if (has(text, /\b(flex\s+cable|flex|cable\s+interno|flat\s+cable)\b/i)) return "Flex / cable interno";
  if (has(text, /\b(back\s+cover|rear\s+cover|battery\s+cover|tapa\s+trasera|carcasa)\b/i)) return "Tapa trasera / carcasa";
  if (has(text, /\b(battery|bateria|bater[ií]a)\b/i)) return "Batería";
  if (has(text, /\b(camera\s+lens|lens\s+camera|lente\s+de\s+c[aá]mara|cristal\s+c[aá]mara)\b/i)) return "Lente de cámara";
  if (has(text, /\b(camera|camara|c[aá]mara)\b/i)) return "Cámara";
  if (has(text, /\b(speaker|parlante|earpiece|buzzer|audio)\b/i)) return "Audio / parlante";
  if (has(text, /\b(microphone|micr[oó]fono|microfono)\b/i)) return "Micrófono";
  if (has(text, /\b(sim\s+tray|sim\s+reader|lector\s+sim|bandeja\s+sim)\b/i)) return "Bandeja / lector SIM";
  if (has(text, /\b(screw|screws|tornillo|tornillos|fixing|fijaci[oó]n|fijaciones)\b/i)) return "Tornillos / fijaciones";
  if (has(text, /\b(holder|bracket|soporte)\b/i)) return "Soporte / bracket";
  if (has(text, /\b(antenna|antena|ic|chip|board\s+component|componente\s+electr[oó]nico)\b/i)) return "Componente electrónico";
  if (has(text, /\b(display|screen|pantalla|lcd|oled|amoled|tft)\b/i) && !screenBlockers.test(text)) return "Pantalla / display";

  return "Repuesto";
}

module.exports = { detectProductType };
