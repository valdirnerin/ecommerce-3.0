const SHIPPING_STATUS_LABELS = {
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const SHIPPING_STATUS_CODE_MAP = {
  pendiente: "preparing",
  pending: "preparing",
  preparando: "preparing",
  "en preparación": "preparing",
  "en preparacion": "preparing",
  preparacion: "preparing",
  preparing: "preparing",
  listo: "preparing",
  lista: "preparing",
  ready: "preparing",
  armado: "preparing",
  armado_envio: "preparing",
  enviando: "shipped",
  envio: "shipped",
  enviado: "shipped",
  despachado: "shipped",
  despachada: "shipped",
  shipped: "shipped",
  entregado: "delivered",
  entregada: "delivered",
  delivered: "delivered",
  finalizado: "delivered",
  completado: "delivered",
  complete: "delivered",
  cancelado: "cancelled",
  cancelada: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
  anulada: "cancelled",
  anulada_envio: "cancelled",
};

function mapShippingStatusCode(status) {
  if (status == null) return "preparing";
  const key = String(status).trim().toLowerCase();
  if (SHIPPING_STATUS_CODE_MAP[key]) return SHIPPING_STATUS_CODE_MAP[key];
  if (key === "canceled") return "cancelled";
  if (Object.prototype.hasOwnProperty.call(SHIPPING_STATUS_LABELS, key)) {
    return key;
  }
  return "preparing";
}

function localizeShippingStatus(status) {
  const code = mapShippingStatusCode(status);
  return SHIPPING_STATUS_LABELS[code] || (status ? String(status) : "");
}

module.exports = {
  SHIPPING_STATUS_LABELS,
  mapShippingStatusCode,
  localizeShippingStatus,
};
