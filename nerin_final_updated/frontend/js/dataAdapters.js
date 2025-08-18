// Normalizadores y formateadores seguros para toda la UI

export function toNumberSafe(v, def = 0) {
  // CODEXFIX: limpieza de precios "$ 1.234,56"
  if (v === null || v === undefined) return def;
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  if (typeof v === 'string') {
    const cleaned = v
      .replace(/[^0-9.,-]/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : def;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function formatCurrencyARS(v) {
  const n = toNumberSafe(v, 0);
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

export function asProduct(api) {
  // Acepta shapes viejos y nuevos
  return {
    id: String(api.id ?? api._id ?? api.slug ?? api.sku ?? ''),
    sku: String(api.sku ?? api.SKU ?? api.codigo ?? ''),
    name: String(api.name ?? api.nombre ?? ''),
    brand: String(api.brand ?? api.marca ?? ''),
    model: String(api.model ?? api.modelo ?? ''),
    category: String(api.category ?? api.categoria ?? ''),
    stock: toNumberSafe(api.stock ?? api.qty ?? api.cantidad ?? 0, 0),
    price: toNumberSafe(
      api.price ?? api.precio ?? api.precio_min ?? api.precioMinorista ?? 0,
      0
    ),
    image_url: api.image_url ?? api.imagen ?? null,
    updated_at: api.updated_at ?? api.updatedAt ?? null,
  };
}

export function asClient(api) {
  return {
    email: String(api.email ?? ''),
    name: String(api.name ?? api.nombre ?? ''),
    phone: String(api.phone ?? api.telefono ?? ''),
    address: String(api.address ?? api.direccion ?? ''),
    balance: toNumberSafe(api.balance ?? api.saldo ?? 0, 0),
    credit_limit: toNumberSafe(api.credit_limit ?? api.limite ?? 0, 0),
  };
}

export function asOrder(api) {
  return {
    id: String(api.id ?? api.order_number ?? api.nrn ?? ''),
    date: api.created_at ?? api.date ?? null,
    client: String(api.client ?? api.cliente ?? api.email ?? ''),
    status: String(api.status ?? api.payment_status ?? 'pending'),
    total: toNumberSafe(api.total ?? 0, 0),
    items: Array.isArray(api.items) ? api.items : [],
    shipping_province: String(api.shipping_province ?? api.provincia_envio ?? ''),
  };
}

export function asSupplier(api) {
  return {
    id: String(api.id ?? ''),
    name: String(api.name ?? api.nombre ?? ''),
    contact: String(api.contact ?? api.contacto ?? ''),
    email: String(api.email ?? ''),
    phone: String(api.phone ?? ''),
    address: String(api.address ?? ''),
    payment_terms: String(api.payment_terms ?? api.terminos ?? ''),
    rating: toNumberSafe(api.rating ?? 0, 0),
  };
}

export function asShippingRow(api) {
  return {
    province: String(api.province ?? api.provincia ?? ''),
    cost: toNumberSafe(api.cost ?? api.costo ?? 0, 0),
  };
}
