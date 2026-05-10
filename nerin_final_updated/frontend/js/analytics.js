import { apiFetch } from "./api.js";

const LIVE_MS = 8000;
const DETAIL_MS = 120000;
const state = { range: "7d", from: "", to: "" };
let liveTimer = null;
let detailTimer = null;
let liveBusy = false;
let detailBusy = false;
let hasDetail = false;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const num = (v) => (Number(v) || 0).toLocaleString("es-AR");
const money = (v) => (Number(v) || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
const mins = (v) => { const n = Number(v) || 0; return n >= 120 ? `${(n / 60).toFixed(1)} h` : `${n.toFixed(1)} min`; };
const clock = (v) => { const d = v ? new Date(v) : new Date(); return Number.isNaN(d.getTime()) ? "sin eventos" : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

function params() {
  const p = new URLSearchParams();
  p.set("range", state.range || "7d");
  if (state.range === "custom") {
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
  }
  return p;
}

function card(id, title, subtitle, tone = "default") {
  return `<article class="analytics-card analytics-card--${tone}"><h4>${esc(title)}</h4><p class="analytics-card__metric" id="${id}">—</p><p class="analytics-card__caption" id="${id}-caption">${esc(subtitle)}</p></article>`;
}

function shell(container) {
  if (!container || container.dataset.fastAnalytics === "1") return;
  container.dataset.fastAnalytics = "1";
  container.dataset.analyticsReady = "1";
  container.innerHTML = `
    <div class="analytics-controls"><div class="analytics-range">
      <label for="analytics-range-select">Rango de análisis</label>
      <select id="analytics-range-select"><option value="today">Hoy</option><option value="7d">7 días</option><option value="30d">30 días</option><option value="custom">Personalizado</option></select>
      <div class="analytics-range__custom" id="analytics-custom-range" style="display:none"><input type="date" id="analytics-from-date"><input type="date" id="analytics-to-date"><button type="button" class="button secondary" id="analytics-apply-range">Aplicar</button></div>
      <button type="button" class="button secondary" id="analytics-refresh-now">Actualizar ahora</button>
    </div></div>
    <div class="analytics-meta" role="status"><span class="analytics-meta__status" id="analytics-live-updated-at">Cargando datos en vivo...</span><span class="analytics-meta__hint">En vivo cada ${Math.round(LIVE_MS / 1000)} s</span><span class="analytics-meta__hint">Detallado cada ${Math.round(DETAIL_MS / 1000)} s</span><span class="analytics-meta__hint" id="analytics-live-health">Último evento: cargando...</span><span class="analytics-meta__hint" id="analytics-detail-status">Métricas detalladas: cargando...</span></div>
    <div class="analytics-summary-grid">${card("analytics-live-active-sessions", "Sesiones activas", "Personas navegando en tiempo real", "primary")}${card("analytics-live-checkout-in-progress", "Checkout en curso", "Usuarios a punto de comprar", "warning")}${card("analytics-visitors-today", "Visitantes hoy", "Datos detallados")}${card("analytics-revenue-today", "Ingresos hoy", "Datos detallados", "success")}${card("analytics-conversion-rate", "Tasa de conversión", "Datos detallados", "info")}${card("analytics-average-session-duration", "Duración media sesión", "Datos detallados")}</div>
    <div class="analytics-two-column"><section class="analytics-panel"><h4>Sesiones en vivo</h4><div id="analytics-live-sessions-panel" class="analytics-empty">Cargando sesiones...</div></section><section class="analytics-panel"><h4>Productos más vistos</h4><div id="analytics-hot-products-panel" class="analytics-empty">Cargando productos...</div></section></div>
    <div class="analytics-two-column analytics-two-column--balanced"><section class="analytics-panel"><h4>Insights automáticos</h4><div id="analytics-insights-panel" class="analytics-empty">Cargando insights...</div></section><section class="analytics-panel"><h4>Calidad de tráfico</h4><div id="analytics-quality-panel" class="analytics-empty">Cargando calidad...</div></section></div>
    <div class="analytics-charts" id="analytics-charts-panel"><div class="analytics-empty analytics-empty--inline">Los gráficos se actualizan en segundo plano.</div></div>`;

  const range = document.getElementById("analytics-range-select");
  const custom = document.getElementById("analytics-custom-range");
  const from = document.getElementById("analytics-from-date");
  const to = document.getElementById("analytics-to-date");
  range.value = state.range;
  range.addEventListener("change", () => {
    state.range = range.value;
    custom.style.display = state.range === "custom" ? "flex" : "none";
    if (state.range !== "custom") { state.from = ""; state.to = ""; fetchDetail(true); }
  });
  document.getElementById("analytics-apply-range")?.addEventListener("click", () => { state.range = "custom"; state.from = from?.value || ""; state.to = to?.value || ""; fetchDetail(true); });
  document.getElementById("analytics-refresh-now")?.addEventListener("click", () => { fetchLive(true); fetchDetail(true); });
}

function renderLiveSessions(sessions = []) {
  const panel = document.getElementById("analytics-live-sessions-panel");
  if (!panel) return;
  const list = Array.isArray(sessions) ? sessions.slice(0, 12) : [];
  if (!list.length) { panel.className = "analytics-empty"; panel.textContent = "No hay sesiones activas en este momento."; return; }
  panel.className = "";
  panel.innerHTML = `<table class="analytics-live-table"><thead><tr><th>Usuario</th><th>Última actividad</th><th>Etapa</th><th>Carrito</th></tr></thead><tbody>${list.map((s) => `<tr><td><strong>${esc(s.userName || s.userEmail || s.id || "Visitante")}</strong></td><td>${esc(clock(s.lastSeenAt || s.updatedAt))}</td><td>${esc(String(s.currentStep || "Explorando").replace(/_/g, " "))}</td><td>${esc(s.cartValue ? money(s.cartValue) : "—")}</td></tr>`).join("")}</tbody></table>`;
}

function applyLive(data = {}) {
  setText("analytics-live-active-sessions", num(data.activeSessions));
  setText("analytics-live-checkout-in-progress", num(data.checkoutInProgress));
  setText("analytics-live-updated-at", `Última actualización ${clock(data.updatedAt)}`);
  setText("analytics-live-health", `Último evento ${clock(data.lastEventAt)} · ${num(data.eventsLastHour)} eventos/h`);
  renderLiveSessions(data.liveSessions);
}

async function fetchLive(force = false) {
  if (liveBusy && !force) return;
  liveBusy = true;
  try {
    const res = await apiFetch("/api/analytics/live", { cache: "no-store" });
    if (!res.ok) throw new Error(`live analytics ${res.status}`);
    applyLive(await res.json());
  } catch (err) {
    console.warn("analytics-live-refresh-error", err);
    setText("analytics-live-updated-at", "No se pudieron actualizar los datos en vivo");
  } finally { liveBusy = false; }
}

function renderListPanel(id, items, emptyText) {
  const panel = document.getElementById(id);
  if (!panel) return;
  if (!items.length) { panel.className = "analytics-empty"; panel.textContent = emptyText; return; }
  panel.className = "analytics-hot-products";
  panel.innerHTML = `<ol class="analytics-hot-products__list">${items.map((i) => `<li><span>${esc(i.name || i.path || i.message || "Item")}</span><strong>${i.count != null ? num(i.count) : ""}</strong></li>`).join("")}</ol>`;
}

function applyDetail(a = {}) {
  setText("analytics-visitors-today", num(a.visitorsToday));
  setText("analytics-revenue-today", money(a.revenueToday));
  setText("analytics-revenue-today-caption", `${num(a.ordersToday)} órdenes confirmadas`);
  setText("analytics-conversion-rate", pct(a.conversionRate));
  setText("analytics-conversion-rate-caption", `Abandono ${pct(a.cartAbandonmentRate)}`);
  setText("analytics-average-session-duration", mins(a.averageSessionDuration));
  setText("analytics-average-session-duration-caption", `Mediana ${mins(a.medianSessionDuration)}`);
  const products = (Array.isArray(a.productViewsToday) ? a.productViewsToday : []).concat(Array.isArray(a.productViewsWeek) ? a.productViewsWeek : []).sort((x, y) => Number(y.count || 0) - Number(x.count || 0)).slice(0, 8);
  renderListPanel("analytics-hot-products-panel", products, "Sin datos de productos vistos todavía.");
  renderListPanel("analytics-insights-panel", Array.isArray(a.insights) ? a.insights.slice(0, 6) : [], "Sin insights por ahora.");
  const quality = [{ name: "Tasa de rebote", count: pct(a.bounceRate) }, { name: "Sesiones comprometidas", count: pct(a.engagedSessionsRate) }, { name: "Clientes recurrentes", count: pct(a.repeatCustomerRate) }];
  renderListPanel("analytics-quality-panel", quality, "Sin datos de calidad todavía.");
  const charts = document.getElementById("analytics-charts-panel");
  if (charts) charts.innerHTML = `<div class="analytics-empty analytics-empty--inline">Métricas detalladas actualizadas. Gráficos completos se mantienen desactivados para priorizar carga rápida.</div>`;
}

async function fetchDetail(force = false) {
  if (detailBusy && !force) return;
  detailBusy = true;
  setText("analytics-detail-status", "Métricas detalladas: actualizando...");
  try {
    const p = params();
    if (force) p.set("force", "1");
    const res = await apiFetch(`/api/analytics/detailed?${p.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`detailed analytics ${res.status}`);
    const payload = await res.json();
    const analytics = payload?.analytics || payload || {};
    if (analytics.analyticsAvailable === false) { setText("analytics-detail-status", analytics.error || analytics.message || "No se pudieron cargar las métricas detalladas."); return; }
    hasDetail = true;
    applyDetail(analytics);
    setText("analytics-detail-status", `Métricas detalladas actualizadas ${clock(new Date().toISOString())}`);
  } catch (err) {
    console.error("analytics-detailed-refresh-error", err);
    setText("analytics-detail-status", "No se pudieron actualizar las métricas detalladas.");
  } finally { detailBusy = false; }
}

function timers() {
  if (!liveTimer) liveTimer = window.setInterval(() => fetchLive(), LIVE_MS);
  if (!detailTimer) detailTimer = window.setInterval(() => fetchDetail(), DETAIL_MS);
}

export async function renderAnalyticsDashboard(containerId = "analytics-dashboard", options = {}) {
  const { range, from, to, isAutoRefresh = false, forceDetailed = false } = options || {};
  const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (!container) return;
  if (range) state.range = range;
  if (from !== undefined) state.from = from || "";
  if (to !== undefined) state.to = to || "";
  shell(container);
  timers();
  fetchLive(true);
  if (!isAutoRefresh || forceDetailed || !hasDetail) fetchDetail(Boolean(forceDetailed));
}
