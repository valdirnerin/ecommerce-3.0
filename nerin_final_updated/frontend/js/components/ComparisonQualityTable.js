const QUALITY_TABLE_ANCHOR_ID = "comparacion-calidades";
const QUALITY_COLUMNS = ["original", "oled_compatible", "incell"];

function normalizeValue(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isScreenCategory(category) {
  const normalized = normalizeValue(category);
  if (!normalized) return false;
  return normalized === "pantallas" || normalized === "pantalla";
}

function getOriginalColumnTitle(brand, isServicePack) {
  const normalizedBrand = normalizeValue(brand);
  if (normalizedBrand === "samsung" && isServicePack === true) {
    return "Original (Service Pack)";
  }
  return "Original";
}

function createMutedHeader(title) {
  const wrapper = document.createElement("div");
  wrapper.className = "quality-header-cell";

  const text = document.createElement("span");
  text.textContent = title;

  const badge = document.createElement("span");
  badge.className = "quality-no-sell-badge";
  badge.textContent = "No lo vendemos";

  wrapper.append(text, badge);
  return wrapper;
}

function buildRow(label, rowData) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <th scope="row">${label}</th>
    <td class="quality-col--original">${rowData.original}</td>
    <td class="quality-col--muted">${rowData.oled_compatible}</td>
    <td class="quality-col--muted">${rowData.incell}</td>
  `;
  return tr;
}

function getTableRows() {
  return [
    {
      label: "Calce / terminación",
      original: "Estándar OEM (sin adaptaciones)",
      oled_compatible: "Depende del proveedor/lote",
      incell: "Depende del proveedor/lote",
    },
    {
      label: "Calidad de imagen",
      original: "Experiencia prevista por el fabricante",
      oled_compatible: "Puede variar según proveedor",
      incell: "LCD in-cell (menor contraste/negros vs OLED)",
    },
    {
      label: "Táctil",
      original: "Respuesta OEM",
      oled_compatible: "Puede variar según proveedor",
      incell: "Depende del proveedor/lote",
    },
    {
      label: "Durabilidad / estabilidad",
      original: "Estándar OEM",
      oled_compatible: "Depende del proveedor/lote",
      incell: "Depende del proveedor/lote",
    },
    {
      label: "Variabilidad entre lotes",
      original: "Baja",
      oled_compatible: "Media",
      incell: "Alta",
    },
  ];
}

export function removeQualitySelector() {
  ["#qualitySelector", ".quality-selector", "[data-quality-selector]"]
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .forEach((node) => node.remove());
}

export function createComparisonQualityTable({ brand, isServicePack, category }) {
  if (!brand || !category || !isScreenCategory(category)) {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "comparison-quality";
  wrapper.id = QUALITY_TABLE_ANCHOR_ID;
  wrapper.setAttribute("aria-label", "Comparación de calidades");

  const title = document.createElement("h3");
  title.className = "comparison-quality__title";
  title.textContent = "Comparación de calidades (informativo)";

  const subtitle = document.createElement("p");
  subtitle.className = "comparison-quality__subtitle";
  subtitle.textContent =
    "Este producto se vende únicamente en calidad ORIGINAL. OLED compatible e INCELL no se comercializan.";

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "comparison-quality__table-wrap";

  const scrollHint = document.createElement("p");
  scrollHint.className = "comparison-quality__scroll-hint";
  scrollHint.textContent = "Deslizá horizontalmente para ver las 3 calidades.";

  const table = document.createElement("table");
  table.className = "comparison-quality__table";

  const originalHeading = getOriginalColumnTitle(brand, isServicePack);
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const aspectHeader = document.createElement("th");
  aspectHeader.scope = "col";
  aspectHeader.textContent = "Aspecto";

  const originalHeader = document.createElement("th");
  originalHeader.scope = "col";
  originalHeader.className = "quality-col--original quality-col--original-head";
  originalHeader.textContent = originalHeading;

  const oledHeader = document.createElement("th");
  oledHeader.scope = "col";
  oledHeader.className = "quality-col--muted-head";
  oledHeader.appendChild(createMutedHeader("OLED compatible"));

  const incellHeader = document.createElement("th");
  incellHeader.scope = "col";
  incellHeader.className = "quality-col--muted-head";
  incellHeader.appendChild(createMutedHeader("INCELL"));

  headerRow.append(aspectHeader, originalHeader, oledHeader, incellHeader);
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  getTableRows().forEach((row) => {
    const hasAllColumns = QUALITY_COLUMNS.every((key) => typeof row[key] === "string" && row[key]);
    if (hasAllColumns) {
      tbody.appendChild(buildRow(row.label, row));
    }
  });

  table.append(thead, tbody);
  tableWrapper.appendChild(table);
  wrapper.append(title, subtitle, scrollHint, tableWrapper);

  const jumpLink = document.createElement("a");
  jumpLink.href = `#${QUALITY_TABLE_ANCHOR_ID}`;
  jumpLink.className = "comparison-quality__jump-link";
  jumpLink.textContent = "Ver comparación de calidades";
  jumpLink.addEventListener("click", (event) => {
    event.preventDefault();
    wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  return {
    section: wrapper,
    jumpLink,
  };
}
