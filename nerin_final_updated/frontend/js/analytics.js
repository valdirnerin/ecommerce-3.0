import { apiFetch } from "./api.js";

const palette = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#14b8a6",
  "#f43f5e",
  "#ec4899",
  "#a3e635",
];

const activeCharts = [];
const analyticsRangeState = {
  range: "7d",
  from: "",
  to: "",
};

function buildRangeParams(state) {
  const params = new URLSearchParams();
  const range = state?.range || "7d";
  params.set("range", range);
  if (range === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  return params;
}

function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("es-AR");
}

function formatPercent(value, digits = 1) {
  const num = Number(value) || 0;
  return `${(num * 100).toFixed(digits)}%`;
}

function formatDurationMinutes(value) {
  const num = Number(value) || 0;
  if (num >= 120) {
    return `${(num / 60).toFixed(1)} h`;
  }
  return `${num.toFixed(1)} min`;
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, num));
}

const insightIcons = {
  positive: "⬆️",
  alert: "⚠️",
  neutral: "•",
  info: "ℹ️",
  default: "•",
};

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== "string") {
    return `rgba(59, 130, 246, ${alpha})`;
  }
  let normalized = hex.replace("#", "").trim();
  if (normalized.length === 3) {
    normalized = normalized
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (normalized.length !== 6) {
    return `rgba(59, 130, 246, ${alpha})`;
  }
  const intVal = parseInt(normalized, 16);
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createStatCard({ title, value, subtitle, tone = "default" }) {
  const card = document.createElement("article");
  card.className = `analytics-card analytics-card--${tone}`;
  const h4 = document.createElement("h4");
  h4.textContent = title;
  const metric = document.createElement("p");
  metric.className = "analytics-card__metric";
  metric.textContent = value;
  const caption = document.createElement("p");
  caption.className = "analytics-card__caption";
  caption.textContent = subtitle;
  card.appendChild(h4);
  card.appendChild(metric);
  card.appendChild(caption);
  return card;
}

function createEmptyState(message) {
  const div = document.createElement("div");
  div.className = "analytics-empty";
  div.textContent = message;
  return div;
}

function createProgressRow({ label, value, percent, tone = "default", hint }) {
  const row = document.createElement("div");
  row.className = `analytics-progress analytics-progress--${tone}`;
  const header = document.createElement("div");
  header.className = "analytics-progress__header";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  header.appendChild(labelEl);
  header.appendChild(valueEl);
  const bar = document.createElement("div");
  bar.className = "analytics-progress__bar";
  const fill = document.createElement("span");
  fill.style.width = `${clampPercent(percent)}%`;
  bar.appendChild(fill);
  row.appendChild(header);
  row.appendChild(bar);
  if (hint) {
    const hintEl = document.createElement("p");
    hintEl.className = "analytics-progress__hint";
    hintEl.textContent = hint;
    row.appendChild(hintEl);
  }
  return row;
}

function createInsightItem({ level = "info", message }) {
  const li = document.createElement("li");
  li.className = `analytics-insights__item analytics-insights__item--${level}`;
  const icon = document.createElement("span");
  icon.className = "analytics-insights__icon";
  icon.textContent = insightIcons[level] || insightIcons.default;
  const text = document.createElement("p");
  text.textContent = message;
  li.appendChild(icon);
  li.appendChild(text);
  return li;
}

function createChart(
  container,
  title,
  type,
  labels = [],
  data = [],
  { valueType = "currency", fill, color, indexAxis = "x", tension } = {},
) {
  if (!labels || labels.length === 0 || !data || data.every((val) => !Number(val))) {
    const empty = createEmptyState(`Sin datos disponibles para ${title.toLowerCase()}`);
    empty.classList.add("analytics-empty--inline");
    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";
    const h4 = document.createElement("h4");
    h4.textContent = title;
    wrapper.appendChild(h4);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return null;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "chart-wrapper";
  const h4 = document.createElement("h4");
  h4.textContent = title;
  wrapper.appendChild(h4);
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = labels.map((_, i) => palette[i % palette.length]);
  const baseColor = color || palette[0];
  const datasetColors = labels.map((_, i) => palette[i % palette.length]);
  const dataset = {
    label: title,
    data,
    backgroundColor:
      type === "line"
        ? fill === false
          ? baseColor
          : hexToRgba(baseColor, 0.2)
        : datasetColors,
    borderColor: type === "line" ? baseColor : datasetColors,
    borderWidth: type === "line" ? 3 : 0,
    fill: typeof fill === "boolean" ? fill : type === "line",
    tension: typeof tension === "number" ? tension : type === "line" ? 0.35 : 0,
    pointRadius: type === "line" ? 3 : 0,
    pointBackgroundColor: baseColor,
    pointBorderWidth: 0,
  };
  if (type === "line" && dataset.fill) {
    dataset.backgroundColor = hexToRgba(baseColor, 0.2);
  }
  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [dataset],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis,
      plugins: {
        legend: { display: type === "pie" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = type === "pie" ? ctx.parsed : ctx.parsed.y;
              if (valueType === "units") {
                return `${val} u.`;
              }
              if (valueType === "percent") {
                return `${val}%`;
              }
              if (valueType === "minutes") {
                return `${val} min`;
              }
              return formatCurrency(val);
            },
          },
        },
      },
      scales:
        type === "pie"
          ? {}
          : {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: (tickValue) => {
                    const numeric = Number(tickValue) || 0;
                    if (valueType === "percent") {
                      return `${numeric}%`;
                    }
                    if (valueType === "units") {
                      return formatNumber(numeric);
                    }
                    if (valueType === "minutes") {
                      return `${numeric}m`;
                    }
                    return formatCurrency(numeric);
                  },
                },
              },
            },
    },
  });

  const btnContainer = document.createElement("div");
  btnContainer.className = "chart-buttons";
  const imgBtn = document.createElement("button");
  imgBtn.className = "button secondary";
  imgBtn.textContent = "Descargar PNG";
  imgBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = chart.toBase64Image();
    a.download = `${title}.png`;
    a.click();
  });
  const csvBtn = document.createElement("button");
  csvBtn.className = "button secondary";
  csvBtn.textContent = "Exportar datos";
  csvBtn.addEventListener("click", () => {
    let csv = "Etiqueta,Valor\n";
    labels.forEach((lab, i) => {
      csv += `${lab},${data[i]}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
  btnContainer.appendChild(imgBtn);
  btnContainer.appendChild(csvBtn);
  wrapper.appendChild(btnContainer);
  container.appendChild(wrapper);
  activeCharts.push(chart);
  return chart;
}

export async function renderAnalyticsDashboard(
  containerId = "analytics-dashboard",
  options = {},
) {
  const { autoRefreshMs = null, range, from, to } = options || {};
  const container =
    typeof containerId === "string"
      ? document.getElementById(containerId)
      : containerId;
  if (!container) return;
  if (activeCharts.length) {
    activeCharts.forEach((chart) => {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });
    activeCharts.splice(0, activeCharts.length);
  }
  container.innerHTML = "<p>Cargando...</p>";
  if (range) analyticsRangeState.range = range;
  if (from !== undefined) analyticsRangeState.from = from || "";
  if (to !== undefined) analyticsRangeState.to = to || "";
  const rangeParams = buildRangeParams(analyticsRangeState);
  try {
    const res = await apiFetch(`/api/analytics/detailed?${rangeParams.toString()}`);
    const { analytics } = await res.json();
    container.innerHTML = "";
    const fetchedAt = new Date();
    const rangeLabelMap = {
      today: "Hoy",
      "7d": "Últimos 7 días",
      "30d": "Últimos 30 días",
      custom: "Rango personalizado",
    };
    const rangeLabel = analyticsRangeState.range === "custom"
      ? `${analyticsRangeState.from || "inicio"} → ${analyticsRangeState.to || "hoy"}`
      : rangeLabelMap[analyticsRangeState.range] || analyticsRangeState.range;

    const controls = document.createElement("div");
    controls.className = "analytics-controls";
    const rangeGroup = document.createElement("div");
    rangeGroup.className = "analytics-range";
    const rangeLabelEl = document.createElement("label");
    rangeLabelEl.textContent = "Rango de análisis";
    const rangeSelect = document.createElement("select");
    [
      { value: "today", label: "Hoy" },
      { value: "7d", label: "7 días" },
      { value: "30d", label: "30 días" },
      { value: "custom", label: "Personalizado" },
    ].forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      if (analyticsRangeState.range === opt.value) {
        option.selected = true;
      }
      rangeSelect.appendChild(option);
    });
    const customFields = document.createElement("div");
    customFields.className = "analytics-range__custom";
    const fromInput = document.createElement("input");
    fromInput.type = "date";
    fromInput.value = analyticsRangeState.from || toDateInputValue(analytics?.range?.from);
    const toInput = document.createElement("input");
    toInput.type = "date";
    toInput.value = analyticsRangeState.to || toDateInputValue(analytics?.range?.to);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "button secondary";
    applyBtn.textContent = "Aplicar";
    customFields.append(fromInput, toInput, applyBtn);
    const toggleCustomFields = () => {
      customFields.style.display =
        analyticsRangeState.range === "custom" ? "flex" : "none";
    };
    toggleCustomFields();
    rangeSelect.addEventListener("change", () => {
      analyticsRangeState.range = rangeSelect.value;
      if (analyticsRangeState.range !== "custom") {
        analyticsRangeState.from = "";
        analyticsRangeState.to = "";
        renderAnalyticsDashboard(containerId, { autoRefreshMs, range: rangeSelect.value });
      } else {
        toggleCustomFields();
      }
    });
    applyBtn.addEventListener("click", () => {
      analyticsRangeState.range = "custom";
      analyticsRangeState.from = fromInput.value;
      analyticsRangeState.to = toInput.value;
      renderAnalyticsDashboard(containerId, {
        autoRefreshMs,
        range: "custom",
        from: fromInput.value,
        to: toInput.value,
      });
    });
    rangeGroup.append(rangeLabelEl, rangeSelect, customFields);
    controls.appendChild(rangeGroup);
    container.appendChild(controls);

    const meta = document.createElement("div");
    meta.className = "analytics-meta";
    meta.setAttribute("role", "status");
    const status = document.createElement("span");
    status.className = "analytics-meta__status";
    status.textContent = `Actualizado ${fetchedAt.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;
    meta.appendChild(status);
    if (autoRefreshMs) {
      const intervalSeconds = Math.max(1, Math.round(autoRefreshMs / 1000));
      const hint = document.createElement("span");
      hint.className = "analytics-meta__hint";
      hint.textContent = `Actualización automática cada ${intervalSeconds} s`;
      meta.appendChild(hint);
    }
    if (analytics?.trackingHealth) {
      const health = document.createElement("span");
      health.className = "analytics-meta__hint";
      const lastEventText = analytics.trackingHealth.lastEventAt
        ? new Date(analytics.trackingHealth.lastEventAt).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "sin eventos";
      health.textContent = `Último evento ${lastEventText} · ${formatNumber(
        analytics.trackingHealth.eventsLastHour || 0,
      )} eventos/h`;
      meta.appendChild(health);
      if (!analytics.trackingHealth.isPersistentDataDir) {
        const warning = document.createElement("span");
        warning.className = "analytics-meta__hint analytics-meta__hint--warning";
        warning.textContent = "⚠️ DATA_DIR no persistente: los datos pueden perderse.";
        meta.appendChild(warning);
      }
    }
    container.appendChild(meta);

    const summaryGrid = document.createElement("div");
    summaryGrid.className = "analytics-summary-grid";
    const summaryCards = [
      {
        title: "Sesiones activas",
        value: formatNumber(analytics.activeSessions || 0),
        subtitle: "Personas navegando en tiempo real",
        tone: "primary",
      },
      {
        title: "Checkout en curso",
        value: formatNumber(analytics.checkoutInProgress || 0),
        subtitle: "Usuarios a punto de comprar",
        tone: "warning",
      },
      {
        title: "Visitantes hoy",
        value: formatNumber(analytics.visitorsToday || 0),
        subtitle: "Sesiones únicas del día",
      },
      {
        title: `Visitantes ${rangeLabel}`,
        value: formatNumber(analytics.visitorsThisWeek || 0),
        subtitle: "Sesiones únicas en el rango",
      },
      {
        title: "Ingresos hoy",
        value: formatCurrency(analytics.revenueToday || 0),
        subtitle: `${formatNumber(analytics.ordersToday || 0)} órdenes confirmadas`,
        tone: "success",
      },
      {
        title: `Ingresos ${rangeLabel}`,
        value: formatCurrency(analytics.revenueThisWeek || 0),
        subtitle: `${formatNumber(analytics.ordersThisWeek || 0)} órdenes en el rango`,
        tone: "primary",
      },
      {
        title: "Tasa de conversión",
        value: formatPercent(analytics.conversionRate || 0),
        subtitle: `Abandono ${formatPercent(analytics.cartAbandonmentRate || 0)}`,
        tone: "info",
      },
      {
        title: "Duración media sesión",
        value: formatDurationMinutes(analytics.averageSessionDuration || 0),
        subtitle: `Mediana ${formatDurationMinutes(analytics.medianSessionDuration || 0)}`,
      },
    ];
    summaryCards.forEach((card) => {
      summaryGrid.appendChild(createStatCard(card));
    });
    container.appendChild(summaryGrid);

    const definitions = document.createElement("section");
    definitions.className = "analytics-panel analytics-definitions";
    const definitionsTitle = document.createElement("h4");
    definitionsTitle.textContent = "Definiciones rápidas";
    const definitionsList = document.createElement("ul");
    definitionsList.innerHTML = `
      <li><strong>Sesiones activas:</strong> visitantes con actividad en los últimos 5 minutos.</li>
      <li><strong>Checkout en curso:</strong> usuarios en carrito o checkout.</li>
      <li><strong>Carritos activos:</strong> sesiones con importe en carrito en 24 h.</li>
      <li><strong>Conversión:</strong> compras / vistas de producto.</li>
    `;
    definitions.append(definitionsTitle, definitionsList);
    container.appendChild(definitions);

    const topRow = document.createElement("div");
    topRow.className = "analytics-two-column";

    const liveBlock = document.createElement("section");
    liveBlock.className = "analytics-panel";
    const liveTitle = document.createElement("h4");
    liveTitle.textContent = "Sesiones en vivo";
    liveBlock.appendChild(liveTitle);
    if (analytics.liveSessions && analytics.liveSessions.length > 0) {
      const table = document.createElement("table");
      table.className = "analytics-live-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Última actividad</th>
            <th>Etapa</th>
            <th>Carrito</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      analytics.liveSessions.forEach((session) => {
        const tr = document.createElement("tr");
        const name = session.userName || session.userEmail || session.id;
        const lastSeen = session.lastSeenAt
          ? new Date(session.lastSeenAt).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—";
        const step = session.currentStep
          ? session.currentStep
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())
          : "Explorando";
        const cartValue = session.cartValue
          ? formatCurrency(session.cartValue)
          : "—";
        tr.innerHTML = `
          <td>
            <div class="analytics-user">
              <strong>${name}</strong>
              ${session.location ? `<span>${session.location}</span>` : ""}
            </div>
          </td>
          <td>${lastSeen}</td>
          <td>${step}</td>
          <td>${cartValue}</td>
        `;
        tbody.appendChild(tr);
      });
      liveBlock.appendChild(table);
    } else {
      liveBlock.appendChild(
        createEmptyState("No hay sesiones activas en este momento."),
      );
    }

    const highlightBlock = document.createElement("section");
    highlightBlock.className = "analytics-panel";
    const highlightTitle = document.createElement("h4");
    highlightTitle.textContent = "Productos más vistos";
    highlightBlock.appendChild(highlightTitle);

    const hotProducts = document.createElement("div");
    hotProducts.className = "analytics-hot-products";
    if (analytics.mostViewedToday) {
      const badge = document.createElement("div");
      badge.className = "analytics-hot-products__leader";
      badge.innerHTML = `
        <p>Hoy</p>
        <strong>${analytics.mostViewedToday.name}</strong>
        <span>${formatNumber(analytics.mostViewedToday.count)} vistas</span>
      `;
      hotProducts.appendChild(badge);
    }
    if (analytics.mostViewedWeek) {
      const badge = document.createElement("div");
      badge.className = "analytics-hot-products__leader analytics-hot-products__leader--muted";
      badge.innerHTML = `
        <p>Semana</p>
        <strong>${analytics.mostViewedWeek.name}</strong>
        <span>${formatNumber(analytics.mostViewedWeek.count)} vistas</span>
      `;
      hotProducts.appendChild(badge);
    }
    const listsWrapper = document.createElement("div");
    listsWrapper.className = "analytics-hot-products__lists";

    const todayColumn = document.createElement("div");
    todayColumn.className = "analytics-hot-products__column";
    const todayTitle = document.createElement("span");
    todayTitle.className = "analytics-hot-products__subtitle";
    todayTitle.textContent = "Detalle del día";
    todayColumn.appendChild(todayTitle);
    const todayList = document.createElement("ol");
    todayList.className = "analytics-hot-products__list";
    (analytics.productViewsToday || [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .forEach((item) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span>${item.name}</span>
          <strong>${formatNumber(item.count)}</strong>
        `;
        todayList.appendChild(li);
      });
    if (!todayList.children.length) {
      const li = document.createElement("li");
      li.textContent = "Sin datos de vistas de producto hoy.";
      todayList.appendChild(li);
    }
    todayColumn.appendChild(todayList);
    listsWrapper.appendChild(todayColumn);

    const weekColumn = document.createElement("div");
    weekColumn.className = "analytics-hot-products__column";
    const weekTitle = document.createElement("span");
    weekTitle.className = "analytics-hot-products__subtitle";
    weekTitle.textContent = rangeLabel;
    weekColumn.appendChild(weekTitle);
    const weekList = document.createElement("ol");
    weekList.className = "analytics-hot-products__list analytics-hot-products__list--muted";
    (analytics.productViewsWeek || [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .forEach((item) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span>${item.name}</span>
          <strong>${formatNumber(item.count)}</strong>
        `;
        weekList.appendChild(li);
      });
    if (!weekList.children.length) {
      const li = document.createElement("li");
      li.textContent = `Sin datos en ${rangeLabel.toLowerCase()}.`;
      weekList.appendChild(li);
    }
    weekColumn.appendChild(weekList);
    listsWrapper.appendChild(weekColumn);

    hotProducts.appendChild(listsWrapper);
    highlightBlock.appendChild(hotProducts);

    topRow.appendChild(liveBlock);
    topRow.appendChild(highlightBlock);
    container.appendChild(topRow);

    const insightsRow = document.createElement("div");
    insightsRow.className = "analytics-two-column analytics-two-column--balanced";

    const insightsPanel = document.createElement("section");
    insightsPanel.className = "analytics-panel analytics-insights";
    const insightsTitle = document.createElement("h4");
    insightsTitle.textContent = "Insights automáticos";
    insightsPanel.appendChild(insightsTitle);
    if (Array.isArray(analytics.insights) && analytics.insights.length > 0) {
      const list = document.createElement("ul");
      list.className = "analytics-insights__list";
      analytics.insights.forEach((insight) => {
        list.appendChild(createInsightItem(insight));
      });
      insightsPanel.appendChild(list);
    } else {
      insightsPanel.appendChild(createEmptyState("Sin insights por ahora."));
    }

    const qualityPanel = document.createElement("section");
    qualityPanel.className = "analytics-panel analytics-quality";
    const qualityTitle = document.createElement("h4");
    qualityTitle.textContent = "Calidad de tráfico";
    qualityPanel.appendChild(qualityTitle);
    const progressGroup = document.createElement("div");
    progressGroup.className = "analytics-progress-group";
    const bounceRate = Number(analytics.bounceRate || 0);
    progressGroup.appendChild(
      createProgressRow({
        label: "Tasa de rebote",
        value: formatPercent(bounceRate),
        percent: bounceRate * 100,
        tone: bounceRate > 0.4 ? "danger" : "success",
        hint:
          analytics.topLandingPages && analytics.topLandingPages.length > 0
            ? `Entrada principal: ${analytics.topLandingPages[0].path}`
            : undefined,
      }),
    );
    const engagedRate = Number(analytics.engagedSessionsRate || 0);
    progressGroup.appendChild(
      createProgressRow({
        label: "Sesiones comprometidas",
        value: formatPercent(engagedRate),
        percent: engagedRate * 100,
        tone: engagedRate >= 0.3 ? "success" : "info",
        hint: "Objetivo recomendado: 30%",
      }),
    );
    const repeatRate = Number(analytics.repeatCustomerRate || 0);
    progressGroup.appendChild(
      createProgressRow({
        label: "Clientes recurrentes",
        value: formatPercent(repeatRate),
        percent: repeatRate * 100,
        tone: repeatRate >= 0.25 ? "success" : "info",
        hint: `${formatNumber(analytics.ordersThisWeek || 0)} órdenes en la semana`,
      }),
    );
    qualityPanel.appendChild(progressGroup);
    if (analytics.peakTrafficHour && analytics.peakTrafficHour.count > 0) {
      const signal = document.createElement("div");
      signal.className = "analytics-signal";
      const icon = document.createElement("span");
      icon.textContent = "⏰";
      const text = document.createElement("p");
      text.textContent = `Hora pico ${analytics.peakTrafficHour.label} · ${formatNumber(
        analytics.peakTrafficHour.count,
      )} eventos`;
      signal.appendChild(icon);
      signal.appendChild(text);
      qualityPanel.appendChild(signal);
    }

    insightsRow.appendChild(insightsPanel);
    insightsRow.appendChild(qualityPanel);
    container.appendChild(insightsRow);

    const chartsContainer = document.createElement("div");
    chartsContainer.className = "analytics-charts";

    createChart(
      chartsContainer,
      `Visitantes ${rangeLabel}`,
      "line",
      (analytics.visitTrend || []).map((item) => item.date),
      (analytics.visitTrend || []).map((item) => item.visitors),
      { valueType: "units" },
    );

    const hasHourlyTraffic =
      Array.isArray(analytics.trafficByHour) &&
      analytics.trafficByHour.some((item) => Number(item.count || 0) > 0);
    if (hasHourlyTraffic) {
      createChart(
        chartsContainer,
        `Tráfico por hora (${rangeLabel})`,
        "line",
        analytics.trafficByHour.map((item) => item.label),
        analytics.trafficByHour.map((item) => item.count),
        { valueType: "units", fill: true, tension: 0.4 },
      );
    }

    if (Array.isArray(analytics.topLandingPages) && analytics.topLandingPages.length > 0) {
      createChart(
        chartsContainer,
        "Páginas de entrada principales",
        "bar",
        analytics.topLandingPages.map((item) => item.path),
        analytics.topLandingPages.map((item) => item.count),
        { valueType: "units" },
      );
    }

    if (analytics.funnel) {
      const funnelLabels = [
        "Vistas de producto",
        "Añadidos al carrito",
        "Checkout iniciado",
        "Pago en proceso",
        "Compras",
      ];
      const funnelData = [
        analytics.funnel.product_view || 0,
        analytics.funnel.add_to_cart || 0,
        analytics.funnel.checkout_start || 0,
        analytics.funnel.checkout_payment || 0,
        analytics.funnel.purchase || 0,
      ];
      createChart(
        chartsContainer,
        "Embudo de conversión",
        "bar",
        funnelLabels,
        funnelData,
        { valueType: "units" },
      );
    }

    createChart(
      chartsContainer,
      "Ventas por categoría",
      "pie",
      Object.keys(analytics.salesByCategory || {}),
      Object.values(analytics.salesByCategory || {}),
    );

    createChart(
      chartsContainer,
      "Unidades vendidas por producto",
      "bar",
      Object.keys(analytics.salesByProduct || {}),
      Object.values(analytics.salesByProduct || {}),
      { valueType: "units" },
    );

    createChart(
      chartsContainer,
      "Devoluciones por producto",
      "bar",
      Object.keys(analytics.returnsByProduct || {}),
      Object.values(analytics.returnsByProduct || {}),
      { valueType: "units" },
    );

    const clientLabels = (analytics.topCustomers || []).map((c) => c.email);
    const clientData = (analytics.topCustomers || []).map((c) => c.total);
    createChart(
      chartsContainer,
      "Clientes con mayor facturación",
      "bar",
      clientLabels,
      clientData,
      { indexAxis: "y" },
    );

    createChart(
      chartsContainer,
      "Ventas por mes",
      "line",
      Object.keys(analytics.monthlySales || {}),
      Object.values(analytics.monthlySales || {}),
    );

    container.appendChild(chartsContainer);

    const stats = document.createElement("section");
    stats.className = "analytics-stats";
    const statsTitle = document.createElement("h4");
    statsTitle.textContent = "Resumen operacional";
    stats.appendChild(statsTitle);
    const statsGrid = document.createElement("div");
    statsGrid.className = "analytics-stats__grid";
    const statItems = [
      {
        label: "Valor medio de pedido",
        value: formatCurrency(analytics.averageOrderValue || 0),
        hint: `${formatNumber(analytics.ordersThisWeek || 0)} órdenes esta semana`,
      },
      {
        label: "Tasa de devoluciones",
        value: formatPercent(analytics.returnRate || 0, 2),
        hint: analytics.mostReturnedProduct
          ? `Más devuelto: ${analytics.mostReturnedProduct}`
          : "Sin devoluciones destacadas",
      },
      {
        label: "Carritos activos 24 h",
        value: formatNumber(analytics.activeCarts || 0),
        hint: "Con importe mayor a 0",
      },
      {
        label: "Duración mediana",
        value: formatDurationMinutes(analytics.medianSessionDuration || 0),
        hint: `Promedio ${formatDurationMinutes(analytics.averageSessionDuration || 0)}`,
      },
    ];
    statItems.forEach((item) => {
      const card = document.createElement("div");
      card.className = "analytics-stats__item";
      const label = document.createElement("span");
      label.className = "analytics-stats__label";
      label.textContent = item.label;
      const value = document.createElement("strong");
      value.className = "analytics-stats__value";
      value.textContent = item.value;
      card.appendChild(label);
      card.appendChild(value);
      if (item.hint) {
        const hint = document.createElement("p");
        hint.className = "analytics-stats__hint";
        hint.textContent = item.hint;
        card.appendChild(hint);
      }
      statsGrid.appendChild(card);
    });
    stats.appendChild(statsGrid);
    container.appendChild(stats);

    const stories = document.createElement("section");
    stories.className = "analytics-panel analytics-stories";
    const storiesTitle = document.createElement("h4");
    storiesTitle.textContent = "Seguimiento por visitante";
    stories.appendChild(storiesTitle);
    if (Array.isArray(analytics.sessionStories) && analytics.sessionStories.length > 0) {
      const list = document.createElement("ul");
      list.className = "analytics-stories__list";
      analytics.sessionStories.forEach((story) => {
        const item = document.createElement("li");
        item.className = "analytics-stories__item";
        const header = document.createElement("div");
        header.className = "analytics-stories__header";
        const name = document.createElement("span");
        name.className = "analytics-stories__name";
        name.textContent = story.person || story.sessionId || "Visitante";
        header.appendChild(name);
        const status = document.createElement("span");
        status.className = `analytics-stories__status${
          story.status === "active" ? " analytics-stories__status--active" : ""
        }`;
        status.textContent = story.statusText || (story.status === "active" ? "Activo" : "Inactivo");
        header.appendChild(status);
        item.appendChild(header);
        if (story.journeyLabel) {
          const journey = document.createElement("p");
          journey.className = "analytics-stories__journey";
          journey.textContent = `Recorrido: ${story.journeyLabel}`;
          item.appendChild(journey);
        }
        if (story.summary) {
          const summary = document.createElement("p");
          summary.className = "analytics-stories__summary";
          summary.textContent = story.summary;
          item.appendChild(summary);
        }
        list.appendChild(item);
      });
      stories.appendChild(list);
    } else {
      const empty = createEmptyState("Todavía no hay recorridos recientes.");
      empty.classList.add("analytics-empty--inline");
      stories.appendChild(empty);
    }
    container.appendChild(stories);

    const sessionsPanel = document.createElement("section");
    sessionsPanel.className = "analytics-panel analytics-sessions";
    const sessionsHeader = document.createElement("div");
    sessionsHeader.className = "analytics-sessions__header";
    const sessionsTitle = document.createElement("h4");
    sessionsTitle.textContent = "Explorador de sesiones";
    const sessionsFilters = document.createElement("div");
    sessionsFilters.className = "analytics-sessions__filters";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Buscar por email, nombre o ID";
    const statusSelect = document.createElement("select");
    [
      { value: "", label: "Estado: todos" },
      { value: "active", label: "Activos" },
      { value: "idle", label: "Inactivos" },
      { value: "ended", label: "Finalizados" },
    ].forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      statusSelect.appendChild(option);
    });
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "button secondary";
    refreshBtn.textContent = "Actualizar";
    sessionsFilters.append(searchInput, statusSelect, refreshBtn);
    sessionsHeader.append(sessionsTitle, sessionsFilters);
    sessionsPanel.appendChild(sessionsHeader);

    const sessionsTable = document.createElement("table");
    sessionsTable.className = "analytics-live-table analytics-sessions__table";
    sessionsTable.innerHTML = `
      <thead>
        <tr>
          <th>Sesión</th>
          <th>Última actividad</th>
          <th>Etapa</th>
          <th>Carrito</th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const sessionsTbody = sessionsTable.querySelector("tbody");
    const timelinePanel = document.createElement("div");
    timelinePanel.className = "analytics-session-timeline";
    timelinePanel.innerHTML = "<p>Seleccioná una sesión para ver su timeline.</p>";

    const describeTimelineEvent = (evt) => {
      const type = String(evt.type || "").toLowerCase();
      const product = evt.productName || evt.productId || evt.product?.name;
      if (type === "page_view") {
        return `Visitó ${evt.path || evt.url || "una página"}.`;
      }
      if (type === "product_view") {
        return `Vio ${product || "un producto"}.`;
      }
      if (type === "add_to_cart") {
        return `Agregó ${product || "un producto"} al carrito.`;
      }
      if (type === "checkout_start") {
        return "Inició el checkout.";
      }
      if (type === "checkout_payment") {
        return "Seleccionó un método de pago.";
      }
      if (type === "purchase") {
        return `Confirmó compra ${evt.orderId ? `#${evt.orderId}` : ""}.`;
      }
      return evt.step
        ? `Pasó por ${evt.step}.`
        : `Evento ${type || "interacción"}.`;
    };

    const renderSessionTimeline = (session, timeline) => {
      timelinePanel.innerHTML = "";
      const header = document.createElement("div");
      header.className = "analytics-session-timeline__header";
      const title = document.createElement("h5");
      title.textContent = session?.userName || session?.userEmail || session?.id || "Sesión";
      const meta = document.createElement("span");
      meta.textContent = session?.lastSeenAt
        ? `Última actividad ${new Date(session.lastSeenAt).toLocaleString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : "";
      header.append(title, meta);
      timelinePanel.appendChild(header);
      if (!timeline.length) {
        timelinePanel.appendChild(createEmptyState("Sin eventos en el rango seleccionado."));
        return;
      }
      const list = document.createElement("ul");
      list.className = "analytics-timeline__list";
      timeline
        .slice()
        .sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0))
        .forEach((event) => {
          const li = document.createElement("li");
          const time = document.createElement("span");
          time.className = "analytics-timeline__time";
          time.textContent = event.timestamp
            ? new Date(event.timestamp).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—";
          const desc = document.createElement("span");
          desc.className = "analytics-timeline__desc";
          desc.textContent = describeTimelineEvent(event);
          li.append(time, desc);
          list.appendChild(li);
        });
      timelinePanel.appendChild(list);
    };

    const loadSessionTimeline = async (session) => {
      const params = buildRangeParams(analyticsRangeState);
      const res = await apiFetch(
        `/api/analytics/sessions/${encodeURIComponent(session.id)}?${params.toString()}`,
      );
      const payload = await res.json();
      renderSessionTimeline(payload.session || session, payload.timeline || []);
    };

    const renderSessions = (sessionsList) => {
      sessionsTbody.innerHTML = "";
      if (!sessionsList.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "No hay sesiones para este rango.";
        row.appendChild(cell);
        sessionsTbody.appendChild(row);
        return;
      }
      sessionsList.forEach((session) => {
        const row = document.createElement("tr");
        const name = session.userName || session.userEmail || session.id;
        const lastSeen = session.lastSeenAt
          ? new Date(session.lastSeenAt).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—";
        const step = session.currentStep
          ? String(session.currentStep)
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())
          : "Explorando";
        const cartValue = session.cartValue
          ? formatCurrency(session.cartValue)
          : "—";
        row.innerHTML = `
          <td>${name}</td>
          <td>${lastSeen}</td>
          <td>${step}</td>
          <td>${cartValue}</td>
        `;
        const actionCell = document.createElement("td");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button secondary";
        btn.textContent = "Ver timeline";
        btn.addEventListener("click", () => loadSessionTimeline(session));
        actionCell.appendChild(btn);
        row.appendChild(actionCell);
        sessionsTbody.appendChild(row);
      });
    };

    const loadSessions = async () => {
      const params = buildRangeParams(analyticsRangeState);
      const searchValue = searchInput.value.trim();
      const statusValue = statusSelect.value;
      if (searchValue) params.set("search", searchValue);
      if (statusValue) params.set("status", statusValue);
      const res = await apiFetch(`/api/analytics/sessions?${params.toString()}`);
      const payload = await res.json();
      renderSessions(payload.sessions || []);
    };

    refreshBtn.addEventListener("click", loadSessions);
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        loadSessions();
      }
    });
    statusSelect.addEventListener("change", loadSessions);
    loadSessions();

    sessionsPanel.append(sessionsTable, timelinePanel);
    container.appendChild(sessionsPanel);

    const timeline = document.createElement("section");
    timeline.className = "analytics-panel analytics-timeline";
    const timelineTitle = document.createElement("h4");
    timelineTitle.textContent = "Actividad reciente";
    timeline.appendChild(timelineTitle);
    if (analytics.recentEvents && analytics.recentEvents.length > 0) {
      const list = document.createElement("ul");
      analytics.recentEvents.forEach((event) => {
        const li = document.createElement("li");
        const timeSpan = document.createElement("span");
        timeSpan.className = "analytics-timeline__time";
        timeSpan.textContent = event.timestamp
          ? new Date(event.timestamp).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        const descSpan = document.createElement("span");
        descSpan.className = "analytics-timeline__desc";
        descSpan.textContent = event.description || "";
        li.appendChild(timeSpan);
        li.appendChild(descSpan);
        list.appendChild(li);
      });
      timeline.appendChild(list);
    } else {
      timeline.appendChild(createEmptyState("Todavía no hay eventos registrados."));
    }
    container.appendChild(timeline);
  } catch (err) {
    console.error(err);
    container.innerHTML = "<p>No se pudieron cargar las analíticas</p>";
  }
}
