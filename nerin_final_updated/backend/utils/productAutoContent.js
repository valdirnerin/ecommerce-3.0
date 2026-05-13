function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanSentence(value) {
  return normalizeText(value).replace(/\s+([.,;:])/g, "$1");
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
    if (Object.prototype.hasOwnProperty.call(product, key)) {
      const value = product[key];
      if (value != null && value !== "") return value;
    }
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      const value = meta[key];
      if (value != null && value !== "") return value;
    }
    if (Object.prototype.hasOwnProperty.call(supplierImport, key)) {
      const value = supplierImport[key];
      if (value != null && value !== "") return value;
    }
  }
  return null;
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function buildSearchText(product = {}) {
  return [
    pickField(product, ["description", "Description"]),
    pickField(product, ["quality", "Quality"]),
    pickField(product, ["name", "title"]),
    pickField(product, ["remarks", "Remarks"]),
    pickField(product, ["category", "Category", "mainCategory", "MainCategory"]),
    pickField(product, ["subcategory", "subCategory", "SubCategory"]),
    pickField(product, ["productGroup", "ProductGroup"]),
  ].map(normalizeText).filter(Boolean).join(" ");
}

function canonicalQuality(rawQuality) {
  const quality = normalizeText(rawQuality);
  const key = quality.toLowerCase();
  const aliases = new Map([
    ["original", "Original"],
    ["compatible", "Compatible"],
    ["compatible soft", "Compatible Soft"],
    ["compatible hard", "Compatible Hard"],
    ["compatible budget", "Compatible Budget"],
    ["refurbished", "Refurbished"],
    ["pulled", "Pulled"],
    ["pulled a", "Pulled A"],
    ["pulled b", "Pulled B"],
    ["pulled c", "Pulled C"],
    ["factory standard", "Factory Standard"],
    ["in-cell", "In-Cell"],
    ["incell", "In-Cell"],
    ["in cell", "In-Cell"],
    ["in-cell fhd", "In-Cell FHD"],
    ["incell fhd", "In-Cell FHD"],
    ["in cell fhd", "In-Cell FHD"],
    ["best possible", "Best possible"],
    ["selected by the art of repair", "Selected by The Art Of Repair"],
    ["while supplies last", "While supplies last"],
    ["po-a", "PO-A"],
    ["po-a+", "PO-A+"],
    ["po-b", "PO-B"],
    ["po-c", "PO-C"],
    ["po-c+", "PO-C+"],
    ["po-swap", "PO-SWAP"],
  ]);
  if (aliases.has(key)) return aliases.get(key);
  if (/^pulled\s+[abc]$/i.test(quality)) return quality.replace(/\bpulled\b/i, "Pulled").toUpperCase().replace("PULLED", "Pulled");
  if (/^po-[a-z0-9+]+$/i.test(quality)) return quality.toUpperCase();
  return quality;
}

function buildQualityResult(commercialQuality, origin, rawQuality, detectedFrom = "quality") {
  const originLabels = {
    original_fabricante: "original de fabricante",
    original_reacondicionado: "original reacondicionado",
    aftermarket: "aftermarket",
    aftermarket_economico: "aftermarket economico",
    estandar_fabrica: "estandar de fabrica",
    retirado_de_equipo: "retirado de equipo",
    pre_owned: "pre-owned",
    unknown: "no especificado",
  };
  return {
    rawQuality: normalizeText(rawQuality),
    commercialQuality,
    origin,
    originLabel: originLabels[origin] || origin,
    qualityKnown: commercialQuality !== "Calidad no especificada",
    detectedFrom,
  };
}

function detectProductQuality(product = {}) {
  const raw = pickField(product, ["quality", "Quality"]);
  const description = normalizeText(pickField(product, ["description", "Description"]));
  const quality = canonicalQuality(raw);

  if (!quality) {
    if (/\brefurb(?:ished)?\b/i.test(description)) return buildQualityResult("Refurbished", "original_reacondicionado", "Refurbished", "description");
    return buildQualityResult("Calidad no especificada", "unknown", "", "missing");
  }

  const key = normalizeKey(quality);
  if (key === "original") return buildQualityResult("Original", "original_fabricante", quality);
  if (key === "refurbished") return buildQualityResult("Refurbished", "original_reacondicionado", quality);
  if (key === "compatible") return buildQualityResult("Compatible", "aftermarket", quality);
  if (key === "compatible soft") return buildQualityResult("Compatible Soft OLED", "aftermarket", quality);
  if (key === "compatible hard") return buildQualityResult("Compatible Hard OLED", "aftermarket", quality);
  if (key === "compatible budget") return buildQualityResult("Compatible Budget", "aftermarket_economico", quality);
  if (key === "factory standard") return buildQualityResult("Factory Standard", "estandar_fabrica", quality);
  if (key === "in-cell") return buildQualityResult("Compatible In-Cell", "aftermarket", quality);
  if (key === "in-cell fhd") return buildQualityResult("Compatible In-Cell FHD", "aftermarket", quality);
  if (/^pulled\b/i.test(quality)) return buildQualityResult(quality, "retirado_de_equipo", quality);
  if (/^po-/i.test(quality)) return buildQualityResult(quality, "pre_owned", quality);
  return buildQualityResult(quality, "unknown", quality);
}

function textHas(text, regex) {
  return regex.test(String(text || ""));
}

function detectAdhesiveTarget(text) {
  if (textHas(text, /\b(display|screen|pantalla|lcd|oled|amoled|tft)\b/i)) return "pantalla";
  if (textHas(text, /\b(back\s+cover|rear\s+cover|battery\s+cover|back\s+glass|tapa\s+trasera)\b/i)) return "tapa trasera";
  if (textHas(text, /\bbattery|bateria\b/i)) return "bateria";
  if (textHas(text, /\bcamera\s+lens|lente\s+camara\b/i)) return "lente de camara";
  return null;
}

function detectPartType(product = {}) {
  const text = buildSearchText(product);
  const mainCategory = normalizeText(pickField(product, ["mainCategory", "MainCategory", "category", "Category"]));
  const subCategory = normalizeText(pickField(product, ["subCategory", "SubCategory", "subcategory"]));
  const categoryText = [mainCategory, subCategory].filter(Boolean).join(" ");

  // Orden defensivo: consumibles, adhesivos, herramientas y accesorios se detectan antes que display.
  // Esto evita que "display adhesive" termine clasificado como pantalla.
  if (textHas(`${categoryText} ${text}`, /\b(adhesive|adhesive\s+tape|glue|tape|sticker|seal|sealant|gasket|bonding|resin|oca|ac[f]?|epoxy|b7000|t7000|e8000|e6000|uv\s+glue|liquid\s+adhesive|double\s+sided|pegamento|adhesivo|cinta)\b/i)) {
    const target = detectAdhesiveTarget(text);
    return target ? `Adhesivo para ${target}` : "Adhesivo / pegamento";
  }

  if (textHas(`${categoryText} ${text}`, /\b(tool|repair\s+tool|screwdriver|tweezer|spudger|opener|suction|clamp|mat|pressing\s+jig|jig|fixture|solder|tip|herramienta|destornillador|pinza)\b/i)) return "Herramienta / accesorio tecnico";
  if (textHas(`${categoryText} ${text}`, /\b(screen\s+protection|tempered\s+glass|protector|glass\s+tempered|film)\b/i)) return "Protector de pantalla";
  if (textHas(`${categoryText} ${text}`, /\b(battery|bateria)\b/i)) return "Bateria";
  if (textHas(`${categoryText} ${text}`, /\b(back\s+cover|rear\s+cover|battery\s+cover|back\s+glass|housing|case|tapa\s+trasera|carcasa)\b/i)) return "Tapa trasera / carcasa";
  if (textHas(`${categoryText} ${text}`, /\b(charging\s+board|charge\s+port|charging\s+port|dock\s+connector|usb\s+connector|conector\s+de\s+carga|placa\s+de\s+carga)\b/i)) return "Placa / flex de carga";
  if (textHas(`${categoryText} ${text}`, /\b(flex\s+cable|flex|ribbon\s+cable|flat\s+cable)\b/i)) return "Flex / cable interno";
  if (textHas(`${categoryText} ${text}`, /\b(camera\s+lens|lens\s+cover|lente\s+camara)\b/i)) return "Lente / vidrio de camara";
  if (textHas(`${categoryText} ${text}`, /\b(camera|camara)\b/i)) return "Camara";
  if (textHas(`${categoryText} ${text}`, /\b(speaker|earpiece|buzzer|loudspeaker|altavoz|auricular)\b/i)) return "Audio / parlante";
  if (textHas(`${categoryText} ${text}`, /\b(microphone|mic\b|microfono)\b/i)) return "Microfono";
  if (textHas(`${categoryText} ${text}`, /\b(vibrator|vibration|taptic|vibrador)\b/i)) return "Vibrador / taptic";
  if (textHas(`${categoryText} ${text}`, /\b(button|keypad|power\s+key|volume\s+key|boton|tecla)\b/i)) return "Boton / tecla";
  if (textHas(`${categoryText} ${text}`, /\b(sim\s+tray|sim\s+holder|card\s+tray|bandeja\s+sim)\b/i)) return "Bandeja SIM";
  if (textHas(`${categoryText} ${text}`, /\b(antenna|antena)\b/i)) return "Antena";
  if (textHas(`${categoryText} ${text}`, /\b(ic|chip|board\s+component|component)\b/i)) return "Componente electronico";

  if (textHas(`${categoryText} ${text}`, /\b(display|screen|pantalla|lcd|oled|amoled|tft)\b/i)) return "Pantalla / display";
  return mainCategory || subCategory || "Repuesto";
}

function isDisplayPartType(partType) {
  return /pantalla|display/i.test(partType || "");
}

function detectDisplayTechnology(product = {}, partType = null) {
  const resolvedPartType = partType || detectPartType(product);
  if (!isDisplayPartType(resolvedPartType)) return null;
  const quality = canonicalQuality(pickField(product, ["quality", "Quality"]));
  const text = buildSearchText(product);
  if (quality === "Compatible Soft" || /\bsoft\s+oled\b/i.test(text)) return "Soft OLED";
  if (quality === "Compatible Hard" || /\bhard\s+oled\b/i.test(text)) return "Hard OLED";
  if (quality === "In-Cell FHD" || /\bin[\s-]?cell\s+fhd\b/i.test(text)) return "In-Cell FHD";
  if (quality === "In-Cell" || /\bin[\s-]?cell\b/i.test(text)) return "In-Cell";
  if (/\bamoled\b/i.test(text)) return "AMOLED";
  if (/\boled\b/i.test(text)) return "OLED";
  if (/\blcd\b/i.test(text)) return "LCD";
  if (/\btft\b/i.test(text)) return "TFT";
  return null;
}

function detectAssemblyType(product = {}, partType = null) {
  const resolvedPartType = partType || detectPartType(product);
  const text = buildSearchText(product);
  const result = { assemblyType: null, extra: null };
  if (!isDisplayPartType(resolvedPartType)) return result;
  if (/\b(?:incl\.?\s*frame|with\s+frame)\b/i.test(text)) result.assemblyType = "con marco";
  if (/\b(?:excl\.?\s*frame|without\s+frame)\b/i.test(text)) result.assemblyType = "sin marco";
  if (/\bfront\s+flex\b/i.test(text)) result.extra = "con flex frontal";
  return result;
}

function detectProductCondition(product = {}) {
  const quality = detectProductQuality(product);
  const text = buildSearchText(product);
  if (/\brefurb(?:ished)?\b/i.test(text) || quality.commercialQuality === "Refurbished") return "reacondicionado";
  if (/\bpulled\b/i.test(text) || quality.origin === "retirado_de_equipo") return "retirado de equipo";
  if (quality.origin === "pre_owned") return "equipo pre-owned";
  if (/\bused\b/i.test(text)) return "usado";
  if (["Original", "Compatible", "Compatible Soft OLED", "Compatible Hard OLED", "Compatible Budget", "Factory Standard", "Compatible In-Cell", "Compatible In-Cell FHD"].includes(quality.commercialQuality)) return "nuevo";
  return null;
}

function detectAvailability(product = {}) {
  const direct = normalizeText(pickField(product, ["availability", "Availability", "availabilityLabel"]));
  if (direct) return direct;
  const stock = Number(pickField(product, ["stock", "Stock", "available_stock", "remote_stock"]));
  if (Number.isFinite(stock) && stock > 0) return "Disponible";
  const canBeOrdered = pickField(product, ["canBeOrdered", "csvCanBeOrdered"]);
  const stockMode = normalizeKey(pickField(product, ["stock_mode", "fulfillment_mode"]));
  const leadDays = Number(pickField(product, ["remote_lead_days", "remote_lead_min_days"]));
  if (canBeOrdered === true || stockMode === "remote" || (Number.isFinite(leadDays) && leadDays > 0)) return "Disponible a pedido";
  return "Consultar disponibilidad";
}

function cleanModelCandidate(value = "") {
  return normalizeText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(display|screen|pantalla|adhesive|glue|tape|sticker|protector|battery|rear\s+cover|back\s+cover|charging\s+board|charge\s+port|camera|speaker|microphone|flex)\b/gi, " ")
    .replace(/\b(?:incl\.?|excl\.?)\s*frame\b/gi, " ")
    .replace(/\b(?:with|without)\s+frame\b/gi, " ")
    .replace(/\b(?:soft|hard)?\s*oled\b/gi, " ")
    .replace(/\bamoled|lcd|tft|in[\s-]?cell(?:\s+fhd)?\b/gi, " ")
    .replace(/\bcompatible|original|refurbished|pulled\b/gi, " ")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s*&\s*/g, " / ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferModelFromText(product = {}) {
  const sources = [pickField(product, ["description", "Description"]), pickField(product, ["name"]), pickField(product, ["title"])].map(normalizeText).filter(Boolean);
  for (const source of sources) {
    const forMatch = source.match(/\b(?:for|para)\s+(.+?)(?:\.|$)/i);
    if (forMatch && forMatch[1]) {
      const cleaned = cleanModelCandidate(forMatch[1]);
      if (cleaned) return cleaned;
    }
    const dashMatch = source.match(/\s-\s*(.+)$/);
    if (dashMatch && dashMatch[1]) {
      const cleaned = cleanModelCandidate(dashMatch[1]);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

function buildBrandModel(product = {}) {
  const brand = normalizeText(pickField(product, ["brand", "Brand", "manufacturerName", "ManufacturerName"]));
  const model = normalizeText(pickField(product, ["model", "Model"]));
  const inferredModel = inferModelFromText(product);
  const modelLabel = model || inferredModel;
  if (brand && modelLabel && modelLabel.toLowerCase().includes(brand.toLowerCase())) return modelLabel;
  return [brand, modelLabel].filter(Boolean).join(" ").trim();
}

function qualityForTitle(commercialQuality) {
  if (!commercialQuality || commercialQuality === "Calidad no especificada") return "";
  if (commercialQuality === "Original") return "original";
  if (commercialQuality === "Refurbished") return "refurbished";
  if (commercialQuality.startsWith("Compatible ")) return `compatible ${commercialQuality.slice("Compatible ".length)}`;
  if (commercialQuality === "Compatible") return "compatible";
  return commercialQuality;
}

function partTypeForTitle(partType) {
  const type = normalizeText(partType);
  if (/adhesivo/i.test(type)) return type;
  if (/pantalla|display/i.test(type)) return "Pantalla";
  if (/bateria/i.test(type)) return "Bateria";
  return type || "Repuesto";
}

function buildH1(product, detected) {
  const chunks = [partTypeForTitle(detected.partType)];
  const qualityText = qualityForTitle(detected.commercialQuality);
  if (qualityText) chunks.push(qualityText);
  if (detected.brandModel) chunks.push(`para ${detected.brandModel}`);
  if (detected.assemblyType) chunks.push(detected.assemblyType);
  return cleanSentence(chunks.join(" ")) || normalizeText(product?.name) || "Producto NERIN Parts";
}

function truncateText(value, limit) {
  const text = cleanSentence(value);
  if (!limit || text.length <= limit) return text;
  const slice = text.slice(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,.!?;:-]+$/, "")}...`;
}

function buildProductAutoContent(product = {}) {
  const quality = detectProductQuality(product);
  const partType = detectPartType(product);
  const displayTechnology = detectDisplayTechnology(product, partType);
  const assembly = detectAssemblyType(product, partType);
  const condition = detectProductCondition(product);
  const brand = normalizeText(pickField(product, ["brand", "Brand", "manufacturerName", "ManufacturerName"]));
  const model = normalizeText(pickField(product, ["model", "Model"]));
  const brandModel = buildBrandModel(product);
  const sku = normalizeText(pickField(product, ["sku", "SKU", "supplierPartNumber"]));
  const partNumber = normalizeText(pickField(product, ["part_number", "partNumber", "PartNumber", "Part Number", "supplierPartNumber"]));
  const category = normalizeText(pickField(product, ["category", "Category", "mainCategory", "MainCategory"]));
  const subCategory = normalizeText(pickField(product, ["subcategory", "subCategory", "SubCategory"]));
  const availability = detectAvailability(product);
  const detected = { ...quality, displayTechnology, assemblyType: assembly.assemblyType, assemblyExtra: assembly.extra, condition, partType, brand, model, brandModel, sku, partNumber, category, subCategory, availability };
  const h1 = buildH1(product, detected);
  const modelCopy = brandModel || "el modelo indicado por proveedor";
  const qualityCopy = quality.commercialQuality;
  const technologyCopy = displayTechnology ? ` con tecnologia ${displayTechnology}` : "";
  const assemblyCopy = assembly.assemblyType ? `, montaje ${assembly.assemblyType}` : "";
  const conditionCopy = condition ? ` en condicion ${condition}` : "";
  const shortDescription = cleanSentence(`${h1}. Repuesto ${qualityCopy}${technologyCopy}${assemblyCopy}${conditionCopy}. ${availability}.`);
  const supplierDescription = normalizeText(pickField(product, ["description", "Description"]));
  const displayParagraph = isDisplayPartType(partType)
    ? (displayTechnology ? `La tecnologia de pantalla detectada es ${displayTechnology}; no se agregan tecnologias que no figuren en la descripcion o en Quality.` : "La tecnologia de pantalla no fue especificada por el proveedor, por eso no se asume OLED, AMOLED, LCD ni otra variante.")
    : `Este producto fue clasificado como ${partType}; no se lo trata como pantalla ni se le asigna tecnologia OLED/LCD/AMOLED salvo que sea realmente un display.`;
  const assemblyParagraph = isDisplayPartType(partType)
    ? (assembly.assemblyType ? `El tipo de armado detectado es ${assembly.assemblyType}${assembly.extra ? `, ${assembly.extra}` : ""}.` : "El montaje no fue especificado por el proveedor.")
    : "El tipo de armado con/sin marco no aplica para este tipo de repuesto.";
  const longDescription = cleanSentence([
    `${h1} para ${modelCopy}. La calidad informada por el proveedor es ${qualityCopy} y el origen se clasifica como ${quality.originLabel}.`,
    displayParagraph,
    assemblyParagraph,
    supplierDescription ? `Descripcion del proveedor: ${supplierDescription}` : "",
    "Antes de instalar, comparar modelo, SKU y numero de parte con el equipo a reparar.",
  ].filter(Boolean).join(" "));
  const technicalSpecs = {
    calidad: qualityCopy,
    tecnologia: isDisplayPartType(partType) ? (displayTechnology || "No especificada por proveedor") : "No aplica",
    tipoRepuesto: partType,
    marcaModelo: brandModel || "No especificado por proveedor",
    condicion: condition || "No especificada por proveedor",
    origen: quality.originLabel,
    montaje: isDisplayPartType(partType) ? (assembly.assemblyType || "no especificado") : "no aplica",
    extra: assembly.extra || null,
    sku: sku || null,
    partNumber: partNumber || null,
    categoria: category || null,
    subcategoria: subCategory || null,
    disponibilidad: availability,
  };
  const compatibilityNotice = cleanSentence(`Verificar compatibilidad con ${modelCopy}${sku ? `, SKU ${sku}` : ""}${partNumber ? ` y numero de parte ${partNumber}` : ""} antes de confirmar la compra o realizar la instalacion.`);
  const seoTitle = truncateText(`${h1} | NERIN Parts`, 160);
  const seoDescription = truncateText(`${h1}. Calidad ${qualityCopy}${displayTechnology ? `, tecnologia ${displayTechnology}` : ""}. ${availability}. ${compatibilityNotice}`, 200);
  return { h1, shortDescription, longDescription, technicalSpecs, compatibilityNotice, seoTitle, seoDescription, detected };
}

module.exports = { buildProductAutoContent };
