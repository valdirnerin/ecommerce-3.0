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
  const { autoRefreshMs = null } = options || {};
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
  try {
    const res = await apiFetch("/api/analytics/detailed");
    const { analytics } = await res.json();
    container.innerHTML = "";
    const fetchedAt = new Date();

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
        title: "Visitantes 7 días",
        value: formatNumber(analytics.visitorsThisWeek || 0),
        subtitle: "Alcance semanal acumulado",
      },
      {
        title: "Ingresos hoy",
        value: formatCurrency(analytics.revenueToday || 0),
        subtitle: `${formatNumber(analytics.ordersToday || 0)} órdenes confirmadas`,
        tone: "success",
      },
      {
        title: "Ingresos 7 días",
        value: formatCurrency(analytics.revenueThisWeek || 0),
        subtitle: `${formatNumber(analytics.ordersThisWeek || 0)} órdenes en la semana`,
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
    weekTitle.textContent = "Últimos 7 días";
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
      li.textContent = "Sin datos en los últimos 7 días.";
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
      "Visitantes últimos 7 días",
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
        "Tráfico por hora (7 días)",
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

    const timeline = document.createElement("section");
    timeline.className = "analytics-panel analytics-timeline";
    const timelineTitle = document.createElement("h4");
    timelineTitle.textContent = "Actividad reciente";
    timeline.appendChild(timelineTitle);
    if (analytics.recentEvents && analytics.recentEvents.length > 0) {
      const list = document.createElement("ul");
      analytics.recentEvents.forEach((event) => {
        const li = document.createElement("li");
        const time = event.timestamp
          ? new Date(event.timestamp).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        li.innerHTML = `
          <span class="analytics-timeline__time">${time}</span>
          <span class="analytics-timeline__desc">${event.description}</span>
        `;
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
