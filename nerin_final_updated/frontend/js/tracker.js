import { buildApiUrl } from "./api.js";

const STORAGE_KEY = "nerinActivitySession";
const SESSION_EXTENSION_MS = 6 * 60 * 60 * 1000; // 6 horas
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

let initialized = false;
let heartbeatTimer = null;
let pageViewSent = false;

function safeGetLocalStorage(key) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn("tracker:localStorage:get", err);
    return null;
  }
}

function safeSetLocalStorage(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn("tracker:localStorage:set", err);
  }
}

function loadStoredSession() {
  const raw = safeGetLocalStorage(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id) {
      return parsed;
    }
  } catch (err) {
    console.warn("tracker:session:parse", err);
  }
  return null;
}

function generateSessionId() {
  try {
    if (typeof window !== "undefined" && window.crypto?.randomUUID) {
      return `web-${window.crypto.randomUUID()}`;
    }
  } catch (err) {
    console.warn("tracker:uuid", err);
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function saveSession(session) {
  if (!session || !session.id) return;
  const payload = {
    id: session.id,
    createdAt: session.createdAt,
    lastUsed: session.lastUsed,
    expiresAt: session.expiresAt,
  };
  safeSetLocalStorage(STORAGE_KEY, JSON.stringify(payload));
}

function ensureSession() {
  const now = Date.now();
  const stored = loadStoredSession();
  if (stored && stored.id) {
    if (!stored.expiresAt || stored.expiresAt > now) {
      const extended = {
        ...stored,
        lastUsed: now,
        expiresAt: now + SESSION_EXTENSION_MS,
      };
      saveSession(extended);
      return extended;
    }
  }
  const fresh = {
    id: generateSessionId(),
    createdAt: now,
    lastUsed: now,
    expiresAt: now + SESSION_EXTENSION_MS,
  };
  saveSession(fresh);
  return fresh;
}

function parseCartItems(rawCart) {
  if (!Array.isArray(rawCart)) return { items: 0, value: 0 };
  return rawCart.reduce(
    (acc, item) => {
      if (!item) return acc;
      const qty = Number(item.quantity ?? item.qty ?? item.cantidad ?? 0);
      const price = Number(
        item.price ??
          item.price_minorista ??
          item.price_mayorista ??
          item.precio ??
          item.precio_unitario ??
          0,
      );
      if (Number.isFinite(qty) && qty > 0) {
        acc.items += qty;
        if (Number.isFinite(price) && price > 0) {
          acc.value += qty * price;
        }
      }
      return acc;
    },
    { items: 0, value: 0 },
  );
}

function getCartSnapshot() {
  try {
    const raw = safeGetLocalStorage("nerinCart");
    if (!raw) {
      return { items: 0, value: 0 };
    }
    const parsed = JSON.parse(raw);
    const summary = parseCartItems(parsed);
    return {
      items: Number.isFinite(summary.items) ? summary.items : 0,
      value: Number.isFinite(summary.value) ? summary.value : 0,
    };
  } catch (err) {
    console.warn("tracker:cart", err);
    return { items: 0, value: 0 };
  }
}

function inferStep(pathname) {
  if (!pathname) return null;
  const lower = pathname.toLowerCase();
  if (lower.includes("checkout")) return "Checkout";
  if (lower.includes("cart")) return "Carrito";
  if (lower.includes("login")) return "Login";
  if (lower.includes("register")) return "Registro";
  if (lower.includes("account")) return "Cuenta";
  if (lower.includes("shop")) return "Catálogo";
  if (lower.includes("product")) return "Producto";
  if (lower.includes("contact")) return "Contacto";
  if (lower.includes("seguimiento")) return "Seguimiento";
  if (lower === "/" || lower.includes("index")) return "Inicio";
  return null;
}

function buildPayload(base) {
  const session = ensureSession();
  const snapshot = getCartSnapshot();
  const location = typeof window !== "undefined" ? window.location : null;
  const navigatorObj = typeof navigator !== "undefined" ? navigator : null;
  const doc = typeof document !== "undefined" ? document : null;
  const path =
    base.path === null
      ? null
      : base.path ||
        (location
          ? `${location.pathname || ""}${location.search || ""}`
          : null);
  const payload = {
    sessionId: session.id,
    type: base.type || base.event || "ping",
    status: base.status || "active",
    path,
    title: base.title === undefined && doc ? doc.title || null : base.title ?? null,
    referrer:
      base.referrer === undefined && doc ? doc.referrer || null : base.referrer ?? null,
    cartValue:
      base.cartValue === undefined ? Number(snapshot.value || 0) : base.cartValue,
    cartItems:
      base.cartItems === undefined ? Number(snapshot.items || 0) : base.cartItems,
    step:
      base.step === undefined
        ? inferStep(path || (location ? location.pathname : ""))
        : base.step,
    userEmail: base.userEmail ?? safeGetLocalStorage("nerinUserEmail"),
    userName: base.userName ?? safeGetLocalStorage("nerinUserName"),
    locale: base.locale ?? navigatorObj?.language ?? null,
    timezone:
      base.timezone ??
      (typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : null),
    userAgent: base.userAgent ?? navigatorObj?.userAgent ?? null,
    productId: base.productId ?? null,
    productName: base.productName ?? null,
    metadata: base.metadata ?? null,
  };
  if (payload.metadata && typeof payload.metadata === "object") {
    const cleaned = Object.entries(payload.metadata).reduce((acc, [key, value]) => {
      if (!key) return acc;
      if (value === undefined || value === null || value === "") return acc;
      acc[String(key)] = value;
      return acc;
    }, {});
    if (Object.keys(cleaned).length > 0) {
      payload.metadata = cleaned;
    } else {
      delete payload.metadata;
    }
  } else {
    delete payload.metadata;
  }
  if (!payload.productId) delete payload.productId;
  if (!payload.productName) delete payload.productName;
  if (!payload.title) delete payload.title;
  if (!payload.referrer) delete payload.referrer;
  if (!payload.locale) delete payload.locale;
  if (!payload.timezone) delete payload.timezone;
  if (!payload.userAgent) delete payload.userAgent;
  if (!payload.userEmail) delete payload.userEmail;
  if (!payload.userName) delete payload.userName;
  if (!payload.step) delete payload.step;
  if (!payload.path) delete payload.path;
  return payload;
}

function sendPayload(basePayload, options = {}) {
  if (typeof window === "undefined") return;
  const payload = buildPayload(basePayload || {});
  const url = buildApiUrl("/api/analytics/track");
  const body = JSON.stringify(payload);
  const preferBeacon = options.keepAlive !== false;

  if (preferBeacon && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) return;
    } catch (err) {
      console.warn("tracker:beacon", err);
    }
  }

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options.keepAlive !== false,
  }).catch((err) => {
    console.warn("tracker:fetch", err);
  });
}

function handleVisibilityChange() {
  if (typeof document === "undefined") return;
  const status = document.hidden ? "idle" : "active";
  sendPayload({ type: document.hidden ? "session_hidden" : "session_visible", status });
}

function handleBeforeUnload() {
  sendPayload({ type: "session_end", status: "ended" }, { keepAlive: true });
}

function startHeartbeat() {
  if (typeof window === "undefined") return;
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
  }
  heartbeatTimer = window.setInterval(() => {
    const doc = typeof document !== "undefined" ? document : null;
    const status = doc && doc.hidden ? "idle" : "active";
    sendPayload({ type: "session_ping", status }, { keepAlive: false });
  }, HEARTBEAT_INTERVAL_MS);
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  ensureSession();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  window.addEventListener("beforeunload", handleBeforeUnload, { capture: true });
  startHeartbeat();
}

function sendPageView() {
  if (pageViewSent) return;
  pageViewSent = true;
  const location = typeof window !== "undefined" ? window.location : null;
  sendPayload({
    type: "page_view",
    status: "active",
    path: location ? `${location.pathname || ""}${location.search || ""}` : undefined,
  });
}

export function startTracking() {
  ensureInitialized();
  sendPageView();
}

export function trackEvent(type, detail = {}, options = {}) {
  if (!type) return;
  ensureInitialized();
  if (type === "page_view" && !pageViewSent) {
    sendPageView();
    return;
  }
  sendPayload({ type, ...detail }, options);
}

if (typeof window !== "undefined") {
  window.NERIN_TRACK_EVENT = trackEvent;
}
