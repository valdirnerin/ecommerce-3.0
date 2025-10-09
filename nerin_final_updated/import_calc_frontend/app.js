function resolveApiBase() {
  const fallback = {
    base: "http://localhost:8000/api",
    source: "Respaldo local (http://localhost:8000/api)",
  };

  if (typeof window === "undefined") {
    return { ...fallback, source: "Respaldo local (sin contexto de navegador)" };
  }

  const seen = new Set();
  const candidates = [];

  const appendCandidate = (value, source) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push({ value: trimmed, source });
  };

  const normalizeCandidate = (raw) => {
    try {
      const origin = window.location ? window.location.origin : undefined;
      const normalized = new URL(raw, origin);
      const normalizedString = normalized.toString().replace(/\/+$/, "");
      const pathname = normalized.pathname.replace(/\/+$/, "");
      const hasApiSuffix = /\/api$/i.test(pathname);
      return {
        base: hasApiSuffix ? normalizedString : `${normalizedString}/api`,
        appended: !hasApiSuffix,
      };
    } catch (error) {
      console.warn("No se pudo normalizar API_BASE", raw, error);
      return null;
    }
  };

  const collectFromContext = (context, label, { immediate = false } = {}) => {
    if (!context) return null;

    try {
      const direct = typeof context.API_BASE === "string" ? context.API_BASE.trim() : "";
      if (direct) {
        const cleaned = direct.replace(/\/+$/, "");
        const source = `${label} (API_BASE)`;
        if (immediate) {
          return { base: cleaned, source };
        }
        appendCandidate(cleaned, source);
      }
    } catch (error) {
      console.warn(`No se pudo leer API_BASE de ${label}`, error);
    }

    try {
      const configBase =
        context.NERIN_CONFIG && typeof context.NERIN_CONFIG.apiBase === "string"
          ? context.NERIN_CONFIG.apiBase
          : "";
      if (configBase) {
        appendCandidate(configBase, `${label} (NERIN_CONFIG.apiBase)`);
      }
    } catch (error) {
      console.warn(`No se pudo leer NERIN_CONFIG.apiBase de ${label}`, error);
    }

    try {
      const globalBase = typeof context.API_BASE_URL === "string" ? context.API_BASE_URL : "";
      if (globalBase) {
        appendCandidate(globalBase, `${label} (API_BASE_URL)`);
      }
    } catch (error) {
      console.warn(`No se pudo leer API_BASE_URL de ${label}`, error);
    }

    return null;
  };

  const directBase = collectFromContext(window, "esta página", { immediate: true });
  if (directBase) {
    return directBase;
  }

  collectFromContext(window, "esta página");

  if (window.parent && window.parent !== window) {
    const parentDirect = collectFromContext(window.parent, "panel administrador", { immediate: true });
    if (parentDirect) {
      return parentDirect;
    }
    collectFromContext(window.parent, "panel administrador");
  }

  appendCandidate(window.location ? window.location.origin : "", "Mismo origen del iframe");

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const normalized = normalizeCandidate(candidate.value);
    if (!normalized) continue;
    return {
      base: normalized.base,
      source: normalized.appended
        ? `${candidate.source} (se agregó /api)`
        : candidate.source,
    };
  }

  return fallback;
}

function detectEmbeddingContext() {
  const fallback = {
    label: "Vista externa",
    detail: "La calculadora se está viendo fuera del panel de administración.",
    inIframe: false,
    likelyAdmin: false,
  };

  if (typeof window === "undefined") {
    return {
      label: "Sin contexto de navegador",
      detail: "No se pudo determinar el origen porque no hay ventana del navegador.",
      inIframe: false,
      likelyAdmin: false,
    };
  }

  const inIframe = (() => {
    try {
      return window.parent && window.parent !== window;
    } catch (error) {
      console.warn("No se pudo determinar si estamos en un iframe", error);
      return false;
    }
  })();

  if (!inIframe) {
    return fallback;
  }

  let referrer = "";
  try {
    referrer = document.referrer || "";
  } catch (error) {
    console.warn("No se pudo leer document.referrer", error);
  }

  let hostname = "";
  let pathname = "";

  if (referrer) {
    try {
      const url = new URL(referrer);
      hostname = url.hostname;
      pathname = url.pathname || "";
    } catch (error) {
      console.warn("No se pudo normalizar el referrer", referrer, error);
    }
  }

  const looksLikeAdmin = /admin|panel|dashboard|nerin/i.test(`${hostname}${pathname}`);

  if (looksLikeAdmin) {
    return {
      label: "Panel administrador detectado",
      detail: hostname
        ? `La calculadora está embebida desde ${hostname}${pathname}`
        : "La calculadora está embebida dentro del panel administrador.",
      inIframe: true,
      likelyAdmin: true,
    };
  }

  return {
    label: "Iframe externo",
    detail: hostname
      ? `La calculadora está embebida desde ${hostname}${pathname}, que no coincide con el panel de administración.`
      : "La calculadora está embebida en un iframe externo pero no parece provenir del panel de administración.",
    inIframe: true,
    likelyAdmin: false,
  };
}

const { base: API_BASE, source: API_SOURCE } = resolveApiBase();
const embedding = detectEmbeddingContext();
window.__NERIN_IMPORT_CALCULATOR = {
  apiBase: API_BASE,
  apiSource: API_SOURCE,
  embedding,
};
document.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("apiBaseNotice");
  if (!banner) return;

  const valueEl = banner.querySelector('[data-role="api-base"]');
  const sourceEl = banner.querySelector('[data-role="api-source"]');
  const embeddingLabelEl = banner.querySelector('[data-role="embedding-label"]');
  const embeddingDetailEl = banner.querySelector('[data-role="embedding-detail"]');

  if (valueEl) {
    valueEl.textContent = API_BASE;
  }

  if (sourceEl) {
    sourceEl.textContent = API_SOURCE;
  }

  if (embeddingLabelEl) {
    embeddingLabelEl.textContent = embedding.label;
  }

  if (embeddingDetailEl) {
    embeddingDetailEl.textContent = embedding.detail;
  }

  banner.hidden = false;

  if (/Respaldo local/.test(API_SOURCE)) {
    banner.classList.add("is-warning");
  }

  if (embedding.likelyAdmin) {
    banner.classList.add("is-admin");
  } else if (embedding.inIframe) {
    banner.classList.add("is-iframe");
  } else {
    banner.classList.add("is-external");
  }
});
let lastCalculationId = null;

const presetSelect = document.getElementById("presetSelect");
const refreshPresetsBtn = document.getElementById("refreshPresets");
const calculatorForm = document.getElementById("calculatorForm");
const additionalTaxesContainer = document.getElementById("additionalTaxes");
const addTaxBtn = document.getElementById("addTax");
const resultsCard = document.getElementById("resultsCard");
const summary = document.getElementById("summary");
const breakdownTableBody = document.querySelector("#breakdownTable tbody");
const exportCsvBtn = document.getElementById("exportCsv");
const exportXlsxBtn = document.getElementById("exportXlsx");
const notificationForm = document.getElementById("notificationForm");
const notificationResult = document.getElementById("notificationResult");
const precioInput = document.getElementById("precioNetoInput");
const margenObjetivoInput = document.getElementById("margenObjetivo");

function formatCurrency(value, currency = "ARS") {
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(number);
}

async function loadPresets() {
  try {
    const response = await fetch(`${API_BASE}/presets`);
    if (!response.ok) throw new Error("No se pudo obtener presets");
    const presets = await response.json();
    presetSelect.innerHTML = '<option value="">Sin preset</option>';
    presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      option.dataset.params = JSON.stringify(preset.parameters);
      presetSelect.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

function toggleTargetInputs() {
  const target = new FormData(calculatorForm).get("target") || "margen";
  if (target === "precio") {
    precioInput.disabled = false;
    margenObjetivoInput.disabled = true;
  } else {
    precioInput.disabled = true;
    margenObjetivoInput.disabled = false;
  }
}

document.querySelectorAll('input[name="target"]').forEach((radio) => {
  radio.addEventListener("change", toggleTargetInputs);
});

refreshPresetsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  loadPresets();
});

presetSelect.addEventListener("change", (event) => {
  const option = event.target.selectedOptions[0];
  if (!option || !option.dataset.params) return;
  try {
    const params = JSON.parse(option.dataset.params);
    if (params.di_rate) document.getElementById("diRate").value = params.di_rate;
    if (params.iva_rate) document.getElementById("ivaRate").value = params.iva_rate;
    if (params.perc_iva_rate) document.getElementById("percIvaRate").value = params.perc_iva_rate;
    if (params.perc_ganancias_rate)
      document.getElementById("percGananciasRate").value = params.perc_ganancias_rate;
    if (typeof params.apply_tasa_estadistica !== "undefined")
      document.getElementById("applyTasa").value = params.apply_tasa_estadistica ? "true" : "false";
    if (params.mp_rate) document.getElementById("mpRate").value = params.mp_rate;
    if (params.mp_iva_rate) document.getElementById("mpIvaRate").value = params.mp_iva_rate;
    if (params.rounding?.step) document.getElementById("roundingStep").value = params.rounding.step;
    if (params.rounding?.psychological_endings?.length)
      document.getElementById("psychological").value = params.rounding.psychological_endings[0];
  } catch (error) {
    console.warn("Preset inválido", error);
  }
});

function buildTaxRow() {
  const row = document.createElement("div");
  row.className = "tax-row";
  row.innerHTML = `
    <div class="grid">
      <div class="form-group">
        <label>Nombre</label>
        <input type="text" name="taxName" required />
      </div>
      <div class="form-group">
        <label>Base</label>
        <select name="taxBase">
          <option value="CIF">CIF</option>
          <option value="BaseIVA">Base IVA</option>
          <option value="ARS">ARS fijo</option>
        </select>
      </div>
      <div class="form-group" data-type="rate">
        <label>Tasa</label>
        <input type="number" step="0.0001" name="taxRate" />
      </div>
      <div class="form-group" data-type="amount">
        <label>Monto ARS</label>
        <input type="number" step="0.01" name="taxAmount" disabled />
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        <button type="button" class="secondary remove-tax">Quitar</button>
      </div>
    </div>
  `;

  const baseSelect = row.querySelector('select[name="taxBase"]');
  const rateInput = row.querySelector('input[name="taxRate"]');
  const amountInput = row.querySelector('input[name="taxAmount"]');
  const removeBtn = row.querySelector(".remove-tax");

  baseSelect.addEventListener("change", () => {
    if (baseSelect.value === "ARS") {
      amountInput.disabled = false;
      rateInput.disabled = true;
      rateInput.value = "";
    } else {
      amountInput.disabled = true;
      amountInput.value = "";
      rateInput.disabled = false;
    }
  });

  removeBtn.addEventListener("click", () => row.remove());

  return row;
}

addTaxBtn.addEventListener("click", () => {
  additionalTaxesContainer.appendChild(buildTaxRow());
});

function collectAdditionalTaxes() {
  const taxes = [];
  additionalTaxesContainer.querySelectorAll(".tax-row").forEach((row) => {
    const name = row.querySelector('input[name="taxName"]').value;
    const base = row.querySelector('select[name="taxBase"]').value;
    const rate = row.querySelector('input[name="taxRate"]').value;
    const amount = row.querySelector('input[name="taxAmount"]').value;
    if (!name) return;
    if (base === "ARS" && !amount) return;
    const tax = { name, base };
    if (base === "ARS") {
      tax.amount_ars = amount;
    } else {
      tax.rate = rate;
    }
    taxes.push(tax);
  });
  return taxes;
}

function buildRequestPayload() {
  const formData = new FormData(calculatorForm);
  const target = formData.get("target") || "margen";

  const roundingStep = document.getElementById("roundingStep").value;
  const psychological = document.getElementById("psychological").value;

  const payload = {
    preset_name: presetSelect.value || null,
    parameters: {
      costs: {
        fob: { amount: formData.get("fobAmount"), currency: formData.get("fobCurrency") },
        freight: { amount: formData.get("freightAmount"), currency: formData.get("freightCurrency") },
        insurance: { amount: formData.get("insuranceAmount"), currency: formData.get("insuranceCurrency") },
      },
      tc_aduana: formData.get("exchangeRate"),
      di_rate: formData.get("diRate"),
      apply_tasa_estadistica: formData.get("applyTasa") === "true",
      iva_rate: formData.get("ivaRate"),
      perc_iva_rate: formData.get("percIvaRate"),
      perc_ganancias_rate: formData.get("percGananciasRate"),
      gastos_locales_ars: formData.get("gastosLocales"),
      costos_salida_ars: formData.get("costosSalida"),
      mp_rate: formData.get("mpRate"),
      mp_iva_rate: formData.get("mpIvaRate"),
      target,
      quantity: Number(formData.get("quantity")) || 1,
      order_reference: formData.get("orderReference") || null,
      additional_taxes: collectAdditionalTaxes(),
    },
  };

  if (target === "margen") {
    payload.parameters.margen_objetivo = margenObjetivoInput.value || 0;
  } else {
    payload.parameters.precio_neto_input_ars = precioInput.value || 0;
  }

  if (roundingStep) {
    payload.parameters.rounding = {
      step: roundingStep,
      mode: "nearest",
      psychological_endings: psychological ? [psychological] : [],
    };
  }

  return payload;
}

function renderSummary(results) {
  summary.innerHTML = "";
  const summaryItems = [
    { label: "Costo Puesto", value: results.costo_puesto_ars },
    { label: "Precio Neto", value: results.precio_neto_ars },
    { label: "Precio Final IVA", value: results.precio_final_ars },
    { label: "Margen", value: `${(Number(results.margen) * 100).toFixed(2)}%` },
  ];

  summaryItems.forEach((item) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `<h3>${item.label}</h3><p>${item.label === "Margen" ? item.value : formatCurrency(item.value)}</p>`;
    summary.appendChild(card);
  });
}

function renderBreakdown(breakdown) {
  breakdownTableBody.innerHTML = "";
  Object.entries(breakdown).forEach(([concept, value]) => {
    const row = document.createElement("tr");
    let displayValue = value;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      if (concept.toLowerCase().includes("margen")) {
        displayValue = `${(numeric * 100).toFixed(2)}%`;
      } else if (concept.toUpperCase().includes("_USD")) {
        displayValue = formatCurrency(numeric, "USD");
      } else {
        displayValue = formatCurrency(numeric);
      }
    }
    row.innerHTML = `<td>${concept}</td><td>${displayValue}</td>`;
    breakdownTableBody.appendChild(row);
  });
}

calculatorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = buildRequestPayload();
    const response = await fetch(`${API_BASE}/calculations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Error en el cálculo");
    }
    const data = await response.json();
    lastCalculationId = data.calculation_id;
    resultsCard.hidden = false;
    renderSummary(data.results);
    renderBreakdown(data.results.breakdown);
    exportCsvBtn.disabled = false;
    exportXlsxBtn.disabled = false;
  } catch (error) {
    alert(error.message);
  }
});

function exportFile(format) {
  if (!lastCalculationId) return;
  const url = `${API_BASE}/calculations/${lastCalculationId}/export?format=${format}`;
  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const link = document.createElement("a");
      const href = window.URL.createObjectURL(blob);
      link.href = href;
      link.download = format === "csv" ? "calculo.csv" : "calculo.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(href);
    });
}

exportCsvBtn.addEventListener("click", () => exportFile("csv"));
exportXlsxBtn.addEventListener("click", () => exportFile("xlsx"));

notificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = {
      payment_id: document.getElementById("paymentId").value,
      order_reference: document.getElementById("notificationReference").value || null,
      amount: document.getElementById("amount").value,
      fee_total: document.getElementById("feeTotal").value,
      currency: document.getElementById("currency").value || "ARS",
      fee_breakdown: JSON.parse(document.getElementById("feeBreakdown").value || "{}"),
      raw_payload: {},
    };
    const response = await fetch(`${API_BASE}/payments/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Error al registrar fee");
    }
    const data = await response.json();
    notificationResult.textContent = JSON.stringify(data, null, 2);
    if (data.updated_results) {
      renderSummary(data.updated_results);
      renderBreakdown(data.updated_results.breakdown);
    }
  } catch (error) {
    alert(error.message);
  }
});

loadPresets();
toggleTargetInputs();
