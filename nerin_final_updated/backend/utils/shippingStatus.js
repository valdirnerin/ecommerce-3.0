const SHIPPING_STATUS_LABELS = {
  received: "Pendiente",
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  canceled: "Cancelado",
};

const SHIPPING_STATUS_CODE_MAP = {
  pendiente: "received",
  pending: "received",
  recibido: "received",
  recibida: "received",
  received: "received",
  preparing: "preparing",
  preparando: "preparing",
  "en preparación": "preparing",
  "en preparacion": "preparing",
  preparacion: "preparing",
  preparándose: "preparing",
  preparandose: "preparing",
  listo: "preparing",
  lista: "preparing",
  ready: "preparing",
  armado: "preparing",
  armado_envio: "preparing",
  envio: "shipped",
  envío: "shipped",
  enviando: "shipped",
  enviado: "shipped",
  enviada: "shipped",
  despachado: "shipped",
  despachada: "shipped",
  shipped: "shipped",
  entregado: "delivered",
  entregada: "delivered",
  delivered: "delivered",
  finalizado: "delivered",
  finalizada: "delivered",
  completado: "delivered",
  completada: "delivered",
  complete: "delivered",
  cancelado: "canceled",
  cancelada: "canceled",
  cancelled: "canceled",
  canceled: "canceled",
  anulada: "canceled",
  anulada_envio: "canceled",
  anulada_envío: "canceled",
};

function normalizeShipping(status = "") {
  if (status == null) return null;
  const raw = String(status).trim();
  if (!raw) return null;
  const key = raw.toLowerCase().normalize("NFKD");
  if (SHIPPING_STATUS_CODE_MAP[key]) return SHIPPING_STATUS_CODE_MAP[key];
  if (key.includes("prepar")) return "preparing";
  if (key.includes("enviado")) return "shipped";
  if (key.includes("entregado")) return "delivered";
  if (key.includes("cancel")) return "canceled";
  if (key.includes("recibi")) return "received";
  return null;
}

function mapShippingStatusCode(status) {
  const normalized = normalizeShipping(status);
  return normalized || "received";
}

function localizeShippingStatus(status) {
  const code = mapShippingStatusCode(status);
  if (SHIPPING_STATUS_LABELS[code]) return SHIPPING_STATUS_LABELS[code];
  return status ? String(status) : "";
}

module.exports = {
  SHIPPING_STATUS_LABELS,
  mapShippingStatusCode,
  localizeShippingStatus,
  normalizeShipping,
};
