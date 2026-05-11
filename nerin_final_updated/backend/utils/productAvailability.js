function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveProductAvailability(product = {}) {
  const stockLocal = toFiniteNumber(product.stock, 0);
  const hasLocalStock = stockLocal > 0;
  const textSignals = [product.name, product.description, product.category, product.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const explicitMode = String(product.stock_mode || product.fulfillment_mode || "").trim().toLowerCase();
  const remoteStock = toFiniteNumber(product.remote_stock, 0);
  const minLead = toFiniteNumber(product.remote_lead_min_days || product.remote_lead_days, 0);
  const maxLead = toFiniteNumber(product.remote_lead_max_days || product.remote_lead_days, 0);
  const hasRemoteSignal = /stock remoto|a pedido|bajo pedido|encargo/.test(textSignals);
  const isRemote = explicitMode === "remote" || explicitMode === "remoto" || remoteStock > 0 || minLead > 0 || maxLead > 0 || hasRemoteSignal;
  const hasRemoteStock = isRemote && (remoteStock > 0 || minLead > 0 || maxLead > 0 || hasRemoteSignal);

  if (hasLocalStock) {
    return {
      stockLocal,
      hasLocalStock,
      isRemote,
      hasRemoteStock,
      isSellable: true,
      availabilityLabel: "En stock",
      availabilityBadge: "in_stock",
      deliveryLabel: "Entrega rápida",
      checkoutAllowed: true,
      seoAvailability: "https://schema.org/InStock",
      leadMinDays: minLead,
      leadMaxDays: maxLead,
    };
  }

  if (hasRemoteStock) {
    const leadStart = minLead > 0 ? minLead : 20;
    const leadEnd = maxLead > 0 ? maxLead : Math.max(leadStart, 30);
    return {
      stockLocal,
      hasLocalStock,
      isRemote: true,
      hasRemoteStock: true,
      isSellable: true,
      availabilityLabel: "Disponible a pedido",
      availabilityBadge: "remote_available",
      deliveryLabel: `Entrega estimada en ${leadStart} a ${leadEnd} días`,
      checkoutAllowed: true,
      seoAvailability: "https://schema.org/PreOrder",
      leadMinDays: leadStart,
      leadMaxDays: leadEnd,
    };
  }

  const priceValue = Number(product.price || product.precio || product.price_minorista || product.precio_minorista || product.precio_final || 0);
  if (Number.isFinite(priceValue) && priceValue > 0) {
    return {
      stockLocal,
      hasLocalStock: false,
      isRemote: true,
      hasRemoteStock: true,
      isSellable: true,
      availabilityLabel: "Disponible a pedido",
      availabilityBadge: "remote_available",
      deliveryLabel: "Entrega estimada en 20 a 30 días",
      checkoutAllowed: true,
      seoAvailability: "https://schema.org/PreOrder",
      leadMinDays: 20,
      leadMaxDays: 30,
    };
  }

  return {
    stockLocal,
    hasLocalStock: false,
    isRemote: false,
    hasRemoteStock: false,
    isSellable: false,
    availabilityLabel: "Sin stock",
    availabilityBadge: "out_of_stock",
    deliveryLabel: "Consultá disponibilidad",
    checkoutAllowed: false,
    seoAvailability: "https://schema.org/OutOfStock",
    leadMinDays: 0,
    leadMaxDays: 0,
  };
}

module.exports = { resolveProductAvailability };
