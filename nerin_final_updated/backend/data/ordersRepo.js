const fs = require('fs');
const path = require('path');
const db = require('../db');
const productsRepo = require('./productsRepo');
const { DATA_DIR: dataDir } = require('../utils/dataDir');
const { mapPaymentStatusCode, localizePaymentStatus } = require('../utils/paymentStatus');

const filePath = path.join(dataDir, 'orders.json');

function normalizePaymentDetails(details) {
  if (!details) return {};
  if (typeof details === 'string') return { note: details };
  if (typeof details === 'object') return { ...details };
  return {};
}

function applyPaymentDefaults(order = {}) {
  const payment_status_code = mapPaymentStatusCode(
    order.payment_status || order.estado_pago || order.payment_status_code,
  );
  const payment_status = order.payment_status
    ? order.payment_status
    : localizePaymentStatus(order.estado_pago || payment_status_code);
  return {
    payment_method: order.payment_method || 'mercado_pago',
    payment_status,
    payment_status_code,
    payment_details: normalizePaymentDetails(order.payment_details),
  };
}

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')).orders || [];
      return data.map((order) => ensureInvoiceStructure(order));
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  return rows.map((order) => ensureInvoiceStructure(order));
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!rows[0]) return null;
  const order = rows[0];
  const items = await pool.query(
    'SELECT product_id, qty, price FROM order_items WHERE order_id=$1',
    [id]
  );
  order.items = items.rows;
  return ensureInvoiceStructure(order);
}

async function saveAll(orders) {
  const pool = db.getPool();
  if (!pool) {
    const sanitized = orders.map((order) => ensureInvoiceStructure(order));
    fs.writeFileSync(filePath, JSON.stringify({ orders: sanitized }, null, 2), 'utf8');
    return;
  }
  await pool.query('BEGIN');
  try {
    for (const original of orders) {
      const o = ensureInvoiceStructure(original);
      await pool.query(
        `INSERT INTO orders (id, created_at, customer_email, status, total, invoice_status, invoices)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           customer_email=EXCLUDED.customer_email,
           status=EXCLUDED.status,
           total=EXCLUDED.total,
           invoice_status=COALESCE(EXCLUDED.invoice_status, orders.invoice_status),
           invoices=COALESCE(EXCLUDED.invoices, orders.invoices)` ,
        [
          o.id,
          o.created_at || new Date(),
          o.customer_email || null,
          o.status || 'pendiente',
          o.total || 0,
          o.invoice_status || null,
          JSON.stringify(o.invoices || []),
        ]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

// Devuelve siempre un array de líneas; acepta 'items' o 'productos'.
function normalizeItems(order = {}) {
  const it = Array.isArray(order.items) ? order.items : null;
  if (it && it.length) return it;
  const prods = Array.isArray(order.productos) ? order.productos : [];
  return prods
    .map((p) => ({
      id: p.id ?? p.product_id ?? p.codigo ?? undefined,
      sku: p.sku ?? p.codigo ?? undefined,
      name: p.name ?? p.titulo ?? p.descripcion ?? '',
      qty: Number(p.qty ?? p.quantity ?? p.cantidad ?? p.cant ?? 1),
      price: Number(p.price ?? p.precio ?? 0),
      total:
        Number(
          p.total ??
            Number(p.price ?? p.precio ?? 0) *
              Number(p.qty ?? p.quantity ?? p.cantidad ?? p.cant ?? 1)
        ),
    }))
    .filter((x) => x.qty > 0);
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = normalizeKey(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeCustomer(order = {}) {
  const existing =
    order && typeof order.customer === 'object' && order.customer
      ? { ...order.customer }
      : {};
  const checkoutCustomer =
    (order && order.cliente) ||
    (order && order.customer_info) ||
    (order && order.checkout && order.checkout.customer) ||
    order?.usuario ||
    {};

  const nombreCompuesto =
    checkoutCustomer &&
    [checkoutCustomer.nombre, checkoutCustomer.apellido]
      .filter((p) => normalizeKey(p))
      .join(' ');

  const name = firstNonEmpty([
    existing.name,
    checkoutCustomer?.name,
    nombreCompuesto,
    checkoutCustomer?.nombre,
    order?.customer_name,
    order?.client_name,
    order?.name,
  ]);
  const email = firstNonEmpty([
    existing.email,
    checkoutCustomer?.email,
    checkoutCustomer?.mail,
    checkoutCustomer?.correo,
    order?.customer_email,
    order?.user_email,
    order?.email,
  ]);
  const phone = firstNonEmpty([
    existing.phone,
    checkoutCustomer?.phone,
    checkoutCustomer?.telefono,
    checkoutCustomer?.tel,
    checkoutCustomer?.mobile,
    order?.customer_phone,
    order?.telefono,
    order?.phone,
  ]);

  const result = { ...existing };
  if (name) result.name = name;
  if (email) result.email = email;
  if (phone) result.phone = phone;

  return Object.keys(result).length ? result : null;
}

function normalizeAddress(order = {}) {
  const existing =
    order && typeof order.shipping_address === 'object' && order.shipping_address
      ? { ...order.shipping_address }
      : {};
  const customerAddress = order?.cliente?.direccion || {};
  const customerFlat = order?.cliente || {};
  const combinedCustomer = {
    ...customerAddress,
    calle: customerAddress.calle || customerFlat.calle,
    numero: customerAddress.numero || customerFlat.numero,
    localidad: customerAddress.localidad || customerFlat.localidad,
    provincia: customerAddress.provincia || customerFlat.provincia,
    cp: customerAddress.cp || customerFlat.cp,
    notas: customerAddress.notas || customerFlat.notas,
  };
  const checkoutAddress = order?.shipping || order?.envio || order?.address || {};
  const userAddress = order?.usuario || {};
  const rawCustomer = order?.customer || {};

  const street = firstNonEmpty([
    existing.street,
    checkoutAddress?.street,
    checkoutAddress?.calle,
    combinedCustomer.calle,
    userAddress?.calle,
    rawCustomer?.calle,
    order?.calle,
  ]);
  const number = firstNonEmpty([
    existing.number,
    checkoutAddress?.number,
    checkoutAddress?.numero,
    combinedCustomer.numero,
    userAddress?.numero,
    rawCustomer?.numero,
    order?.numero,
  ]);
  const city = firstNonEmpty([
    existing.city,
    checkoutAddress?.city,
    checkoutAddress?.localidad,
    combinedCustomer.localidad,
    userAddress?.localidad,
    rawCustomer?.localidad,
    order?.city,
    order?.localidad,
  ]);
  const province = firstNonEmpty([
    existing.province,
    checkoutAddress?.province,
    checkoutAddress?.provincia,
    combinedCustomer.provincia,
    userAddress?.provincia,
    rawCustomer?.provincia,
    order?.province,
    order?.provincia_envio,
  ]);
  const zip = firstNonEmpty([
    existing.zip,
    checkoutAddress?.zip,
    checkoutAddress?.cp,
    checkoutAddress?.postal_code,
    combinedCustomer.cp,
    userAddress?.cp,
    rawCustomer?.cp,
    order?.zip,
    order?.cp,
    order?.codigo_postal,
  ]);
  const notes = firstNonEmpty([
    existing.notes,
    checkoutAddress?.notes,
    checkoutAddress?.comentarios,
    combinedCustomer.notas,
    userAddress?.notas,
    rawCustomer?.notas,
    order?.shipping_notes,
    order?.comentarios,
    order?.notas,
  ]);
  const floor = firstNonEmpty([
    existing.floor,
    existing.piso,
    existing.apartment,
    existing.departamento,
    checkoutAddress?.floor,
    checkoutAddress?.piso,
    checkoutAddress?.apartment,
    checkoutAddress?.apartamento,
    checkoutAddress?.departamento,
    combinedCustomer.piso,
    combinedCustomer.apartamento,
    combinedCustomer.departamento,
    userAddress?.piso,
    userAddress?.apartamento,
    userAddress?.departamento,
    rawCustomer?.piso,
    rawCustomer?.apartamento,
    rawCustomer?.departamento,
    order?.floor,
    order?.piso,
    order?.apartment,
    order?.departamento,
  ]);

  const result = { ...existing };
  if (street) result.street = street;
  if (number) result.number = number;
  if (floor) result.floor = floor;
  if (city) result.city = city;
  if (province) result.province = province;
  if (zip) result.zip = zip;
  if (notes) result.notes = notes;

  return Object.keys(result).length ? result : null;
}

function sanitizeInvoiceRecord(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const record = {};
  if (entry.filename != null) {
    const name = String(entry.filename).trim();
    if (name) record.filename = name;
  }
  if (entry.url != null) {
    const url = String(entry.url).trim();
    if (url) record.url = url;
  }
  const uploadedSource =
    entry.uploaded_at ||
    entry.uploadedAt ||
    entry.created_at ||
    entry.fecha ||
    entry.date ||
    null;
  if (uploadedSource) {
    const uploadedDate = new Date(uploadedSource);
    if (!Number.isNaN(uploadedDate.getTime())) {
      record.uploaded_at = uploadedDate.toISOString();
    }
  }
  if (!record.uploaded_at) {
    record.uploaded_at = new Date().toISOString();
  }
  const originalName = entry.original_name || entry.originalName;
  if (originalName) {
    const name = String(originalName).trim();
    if (name) record.original_name = name;
  }
  const deletedSource = entry.deleted_at || entry.deletedAt || null;
  if (deletedSource) {
    const deletedDate = new Date(deletedSource);
    if (!Number.isNaN(deletedDate.getTime())) {
      record.deleted_at = deletedDate.toISOString();
    }
  }
  if (!record.filename && !record.url) return null;
  return record;
}

function normalizeInvoicesList(value) {
  if (!value && value !== 0) return [];
  let raw = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
      else if (parsed && typeof parsed === 'object') raw = [parsed];
    } catch {
      raw = [];
    }
  } else if (typeof value === 'object') {
    raw = [value];
  }
  return raw
    .map((entry) => sanitizeInvoiceRecord(entry))
    .filter(Boolean);
}

function ensureInvoiceStructure(order) {
  if (!order || typeof order !== 'object') return order;
  const draft = { ...order };
  const invoices = normalizeInvoicesList(order.invoices);
  if (!invoices.length) {
    const fallback = sanitizeInvoiceRecord({
      filename: order.invoice_filename || order.invoiceFilename,
      url: order.invoice_url || order.invoiceUrl,
      uploaded_at:
        order.invoice_uploaded_at ||
        order.invoiceUploadedAt ||
        order.invoice_date ||
        order.invoiceDate,
    });
    if (fallback) invoices.push(fallback);
  }
  draft.invoices = invoices;
  const status = normalizeKey(order.invoice_status || order.invoiceStatus);
  if (status) draft.invoice_status = status;
  else if (invoices.some((inv) => !inv.deleted_at)) draft.invoice_status = 'emitida';
  else draft.invoice_status = null;
  const payment = applyPaymentDefaults(order);
  draft.payment_method = payment.payment_method;
  draft.payment_status = payment.payment_status;
  draft.estado_pago = payment.payment_status;
  draft.payment_status_code = payment.payment_status_code;
  draft.payment_details = payment.payment_details;
  return draft;
}

function validateOrder(order) {
  const lines = normalizeItems(order);
  if (!order || lines.length === 0) throw new Error('ORDER_WITHOUT_ITEMS');
}

async function create(order) {
  const draft = { ...order };
  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    const lines = normalizeItems(draft);
    if (lines.length) draft.items = lines;
  }
  validateOrder(draft);

  const normalizedCustomer = normalizeCustomer(draft);
  if (normalizedCustomer) {
    draft.customer = { ...(draft.customer || {}), ...normalizedCustomer };
  }
  const normalizedAddress = normalizeAddress(draft);
  if (normalizedAddress) {
    draft.shipping_address = {
      ...(draft.shipping_address || {}),
      ...normalizedAddress,
    };
  }
  const invoiceData = ensureInvoiceStructure(draft);
  draft.invoices = invoiceData.invoices;
  draft.invoice_status = invoiceData.invoice_status;
  Object.assign(draft, applyPaymentDefaults(draft));
  if (!draft.created_at) {
    draft.created_at = new Date().toISOString();
  }
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    orders.push({ ...draft });
    await saveAll(orders);
    return draft;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total, invoice_status, invoices) VALUES ($1, now(), $2, $3, $4, $5, $6)',
      [
        draft.id,
        draft.customer_email || draft.customer?.email || null,
        draft.status || 'pendiente',
        draft.total || 0,
        draft.invoice_status || null,
        JSON.stringify(draft.invoices || []),
      ]
    );
    for (const it of draft.items || []) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [draft.id, it.product_id, it.qty, it.price]
      );
    }
    await pool.query('COMMIT');
    return draft;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function update(order) {
  const draft = { ...order };
  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    const lines = normalizeItems(draft);
    if (lines.length) draft.items = lines;
  }
  validateOrder(draft);

  const normalizedCustomer = normalizeCustomer(draft);
  if (normalizedCustomer) {
    draft.customer = { ...(draft.customer || {}), ...normalizedCustomer };
  }
  const normalizedAddress = normalizeAddress(draft);
  if (normalizedAddress) {
    draft.shipping_address = {
      ...(draft.shipping_address || {}),
      ...normalizedAddress,
    };
  }
  const invoiceData = ensureInvoiceStructure(draft);
  draft.invoices = invoiceData.invoices;
  draft.invoice_status = invoiceData.invoice_status;
  Object.assign(draft, applyPaymentDefaults(draft));
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex((o) => String(o.id) === String(draft.id));
    if (idx === -1) throw new Error('ORDER_NOT_FOUND');
    const items = Array.isArray(draft.items)
      ? draft.items.map((it) => ({ ...it }))
      : [];
    const next = {
      ...orders[idx],
      ...draft,
      customer: {
        ...(orders[idx].customer || {}),
        ...(draft.customer || {}),
      },
      shipping_address: {
        ...(orders[idx].shipping_address || {}),
        ...(draft.shipping_address || {}),
      },
      items,
    };
    orders[idx] = next;
    await saveAll(orders);
    return next;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'UPDATE orders SET customer_email=$2, status=$3, total=$4, invoice_status=$5, invoices=$6, emails=COALESCE($7, emails) WHERE id=$1',
      [
        draft.id,
        draft.customer_email || draft.customer?.email || null,
        draft.status || 'pendiente',
        draft.total || 0,
        draft.invoice_status || null,
        JSON.stringify(draft.invoices || []),
        draft.emails ? JSON.stringify(draft.emails) : null,
      ]
    );
    await pool.query('DELETE FROM order_items WHERE order_id=$1', [draft.id]);
    for (const it of draft.items) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || it.cantidad || 0);
      if (!pid || !qty) continue;
      const price = Number(it.price || it.unit_price || 0);
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [draft.id, pid, qty, price]
      );
    }
    await pool.query('COMMIT');
    return draft;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr)
    .trim()
    .split('-')
    .map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getOrderDate(order = {}) {
  const candidates = [order.created_at, order.fecha, order.date, order.createdAt];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function matchesStatus(order, status) {
  if (!status) return true;
  const target = String(status).toLowerCase();
  const normalizedTarget = mapPaymentStatusCode(target);
  const candidates = [
    order.status,
    order.payment_status,
    order.estado_pago,
    order.payment_status_code,
  ]
    .map((val) => normalizeKey(val))
    .filter(Boolean);
  if (candidates.some((val) => String(val).toLowerCase() === target)) return true;
  const mapped = candidates.map((val) => mapPaymentStatusCode(val));
  return mapped.some((val) => val === normalizedTarget);
}

function matchesQuery(order, q) {
  const needle = normalizeKey(q);
  if (!needle) return true;
  const lcNeedle = needle.toLowerCase();
  const customer = normalizeCustomer(order) || {};
  const haystack = [
    order.number,
    order.order_number,
    order.external_reference,
    order.id,
    customer.name,
    customer.email,
    customer.phone,
  ];
  return haystack
    .filter((val) => val != null)
    .map((val) => String(val).toLowerCase())
    .some((val) => val.includes(lcNeedle));
}

async function list({ date, status, q, includeDeleted = false } = {}) {
  const baseDate = parseLocalDate(date) || new Date();
  const start = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  const orders = await getAll();
  return orders
    .filter((order) => {
      if (!includeDeleted && order.deleted_at) return false;
      const orderDate = getOrderDate(order);
      if (!orderDate) return false;
      if (orderDate < start || orderDate >= end) return false;
      if (!matchesStatus(order, status)) return false;
      if (!matchesQuery(order, q)) return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = getOrderDate(a);
      const dateB = getOrderDate(b);
      return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
    });
}

async function findById(id) {
  if (!id) return null;
  const orders = await getAll();
  return (
    orders.find((order) => String(order.id) === String(id)) ||
    null
  );
}

async function softDelete(id) {
  if (!id) return false;
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex(
      (order) =>
        String(order.id) === String(id) ||
        String(order.order_number) === String(id) ||
        String(order.external_reference) === String(id),
    );
    if (idx === -1) return false;
    const deletedAt = new Date().toISOString();
    orders[idx] = { ...orders[idx], deleted_at: deletedAt };
    await saveAll(orders);
    return true;
  }
  await pool.query(
    'UPDATE orders SET deleted_at = now() WHERE id=$1 OR order_number=$1 OR external_reference=$1',
    [id],
  );
  return true;
}

async function restore(id) {
  if (!id) return false;
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex(
      (order) =>
        String(order.id) === String(id) ||
        String(order.order_number) === String(id) ||
        String(order.external_reference) === String(id),
    );
    if (idx === -1) return false;
    orders[idx] = { ...orders[idx], deleted_at: null };
    await saveAll(orders);
    return true;
  }
  await pool.query(
    'UPDATE orders SET deleted_at = null WHERE id=$1 OR order_number=$1 OR external_reference=$1',
    [id],
  );
  return true;
}

function normalizeKey(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function normalizePaymentIdentifiers({
  payment_id,
  preference_id,
  external_reference,
} = {}) {
  const normalizedPaymentId = normalizeKey(payment_id);
  const normalizedPreferenceId = normalizeKey(preference_id);
  const normalizedExternalRef = normalizeKey(external_reference);
  const key =
    normalizedPaymentId || normalizedPreferenceId || normalizedExternalRef;
  return {
    payment_id: normalizedPaymentId,
    preference_id: normalizedPreferenceId,
    external_reference: normalizedExternalRef,
    key,
  };
}

function orderMatches(order, candidate) {
  if (!order || !candidate) return false;
  const values = [
    order.id,
    order.order_id,
    order.orderId,
    order.order_number,
    order.orderNumber,
    order.external_reference,
    order.externalReference,
    order.preference_id,
    order.preferenceId,
    order.payment_id,
    order.paymentId,
    order.metadata?.order_id,
  ];
  return values.some((val) => normalizeKey(val) === candidate);
}

async function findByKey(key, identifiers = {}) {
  const candidates = new Set();
  const keys = [
    key,
    identifiers.payment_id,
    identifiers.preference_id,
    identifiers.external_reference,
  ];
  for (const value of keys) {
    const normalized = normalizeKey(value);
    if (normalized) candidates.add(normalized);
  }
  if (!candidates.size) return null;

  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    for (const candidate of candidates) {
      const match = orders.find((o) => orderMatches(o, candidate));
      if (match) return match;
    }
    return null;
  }

  for (const candidate of candidates) {
    const found = await getById(candidate);
    if (found) return found;
  }
  return null;
}

function computeOrderTotal(order) {
  const total = Number(order?.total);
  if (!Number.isFinite(total) || total <= 0) {
    if (Array.isArray(order?.items)) {
      return order.items.reduce((acc, it) => {
        const price = Number(it.price || it.unit_price || 0);
        const qty = Number(it.qty || it.quantity || it.cantidad || 0);
        return acc + price * qty;
      }, 0);
    }
    return 0;
  }
  return total;
}

function getOrderCurrency(order) {
  if (!order) return null;
  const itemWithCurrency = Array.isArray(order.items)
    ? order.items.find((it) => it.currency || it.currency_id)
    : null;
  return (
    order.currency ||
    order.currency_id ||
    order.currencyId ||
    order.moneda ||
    order.paid_currency ||
    (itemWithCurrency ? itemWithCurrency.currency || itemWithCurrency.currency_id : null)
  );
}

async function upsertByPayment({
  payment_id,
  preference_id,
  external_reference,
  patch = {},
  amount,
  currency,
}) {
  const identifiers = normalizePaymentIdentifiers({
    payment_id,
    preference_id,
    external_reference,
  });
  if (!identifiers.key) return null;

  const existing = await findByKey(identifiers.key, identifiers);
  if (!existing) return null;

  if (typeof amount === 'number' && Number.isFinite(amount)) {
    const total = computeOrderTotal(existing);
    if (Number.isFinite(total) && Math.abs(total - amount) > 0.01) {
      const err = new Error('AMOUNT_MISMATCH');
      err.code = 'AMOUNT_MISMATCH';
      throw err;
    }
  }

  if (currency) {
    const orderCurrency = getOrderCurrency(existing);
    if (orderCurrency && String(orderCurrency) !== String(currency)) {
      const err = new Error('CURRENCY_MISMATCH');
      err.code = 'CURRENCY_MISMATCH';
      throw err;
    }
  }

  const merged = {
    ...existing,
    ...patch,
  };
  if (identifiers.payment_id) merged.payment_id = identifiers.payment_id;
  if (identifiers.preference_id) merged.preference_id = identifiers.preference_id;
  if (identifiers.external_reference) {
    merged.external_reference = identifiers.external_reference;
    if (!merged.id) merged.id = identifiers.external_reference;
  }
  if (!Array.isArray(merged.items) || merged.items.length === 0) {
    const lines = normalizeItems(existing);
    if (lines.length) merged.items = lines;
  }

  return update(merged);
}

async function findByPaymentIdentifiers(params = {}) {
  const identifiers = normalizePaymentIdentifiers(params);
  if (!identifiers.key) return null;
  return findByKey(identifiers.key, identifiers);
}

function getNormalizedItems(order = {}) {
  return normalizeItems(order);
}

async function appendInvoice(orderId, invoice = {}) {
  const id = normalizeKey(orderId);
  if (!id) throw new Error('ORDER_ID_REQUIRED');
  const record = sanitizeInvoiceRecord(invoice);
  if (!record) {
    const err = new Error('INVALID_INVOICE');
    err.code = 'INVALID_INVOICE';
    throw err;
  }
  const order = await getById(id);
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  const current = normalizeInvoicesList(order.invoices);
  const filtered = record.filename
    ? current.filter((inv) => normalizeKey(inv.filename) !== normalizeKey(record.filename))
    : current;
  filtered.push(record);
  const next = {
    ...order,
    invoices: filtered,
    invoice_status: 'emitida',
  };
  return update(next);
}

async function listInvoices(orderId, { includeDeleted = false } = {}) {
  const id = normalizeKey(orderId);
  if (!id) return [];
  const order = await getById(id);
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  const invoices = normalizeInvoicesList(order.invoices);
  if (includeDeleted) return invoices;
  return invoices.filter((inv) => !inv.deleted_at);
}

async function softDeleteInvoice(orderId, filename) {
  const id = normalizeKey(orderId);
  const target = normalizeKey(filename);
  if (!id || !target) throw new Error('INVOICE_NOT_FOUND');
  const order = await getById(id);
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  const invoices = normalizeInvoicesList(order.invoices);
  let changed = false;
  const nextInvoices = invoices.map((inv) => {
    if (normalizeKey(inv.filename) === target && !inv.deleted_at) {
      changed = true;
      return { ...inv, deleted_at: new Date().toISOString() };
    }
    return inv;
  });
  if (!changed) {
    const err = new Error('INVOICE_NOT_FOUND');
    err.code = 'INVOICE_NOT_FOUND';
    throw err;
  }
  const next = { ...order, invoices: nextInvoices };
  if (!nextInvoices.some((inv) => !inv.deleted_at)) {
    next.invoice_status = 'pendiente';
  }
  return update(next);
}

async function createOrder({ id, customer_email, items }) {
  const pool = db.getPool();
  const total = (items || []).reduce(
    (t, it) => t + Number(it.price) * Number(it.qty || it.quantity || 0),
    0
  );
  if (!pool) {
    const orders = await getAll();
    const existing = orders.find((o) => String(o.id) === String(id));
    if (existing) return existing;
    const order = {
      id,
      customer_email,
      status: 'approved',
      total,
      created_at: new Date().toISOString(),
      items,
    };
    orders.push(order);
    await saveAll(orders);
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      if (pid && qty) {
        await productsRepo.adjustStock(pid, -qty, 'order', id);
      }
    }
    return order;
  }
  await pool.query('BEGIN');
  try {
    // Upsert primero, para evitar doble inserción en concurrencia
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total, inventory_applied) ' +
      'VALUES ($1, now(), $2, $3, $4, false) ' +
      'ON CONFLICT (id) DO NOTHING',
      [id, customer_email || null, 'approved', total]
    );
    // Ahora si: tomar lock de la fila
    const { rows } = await pool.query(
      'SELECT inventory_applied FROM orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    const alreadyApplied = !!(rows[0] && rows[0].inventory_applied);
    if (alreadyApplied) {
      await pool.query(
        'UPDATE orders SET customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
        [id, customer_email || null, total]
      );
      await pool.query('COMMIT');
      return { id, customer_email, status: 'approved', total };
    }
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      const price = Number(it.price || 0);
      if (!pid || !qty) continue;
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id, product_id) DO NOTHING',
        [id, pid, qty, price]
      );
      await pool.query(
        'UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at=now() WHERE id=$2',
        [qty, pid]
      );
      await pool.query(
        'INSERT INTO stock_movements(product_id, delta, reason, ref_id) VALUES ($1,$2,$3,$4)',
        [pid, -qty, 'order', id]
      );
    }
    await pool.query(
      'UPDATE orders SET inventory_applied=true, customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
      [id, customer_email || null, total]
    );
    await pool.query('COMMIT');
    return { id, customer_email, status: 'approved', total };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function markInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return; // JSON mode not used
  await pool.query('UPDATE orders SET inventory_applied = true WHERE id=$1', [id]);
}

async function clearInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return;
  await pool.query('UPDATE orders SET inventory_applied=false WHERE id=$1', [id]);
}

async function markEmailSent(orderId, flagName, value = true) {
  const id = normalizeKey(orderId);
  const flag = normalizeKey(flagName);
  if (!id) throw new Error('ORDER_ID_REQUIRED');
  if (!flag) throw new Error('FLAG_NAME_REQUIRED');
  const nextValue = value === true;

  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex((order) => orderMatches(order, id));
    if (idx === -1) return null;
    const current = orders[idx].emails || {};
    if (current[flag] === nextValue) return orders[idx];
    const updated = {
      ...orders[idx],
      emails: { ...current, [flag]: nextValue },
    };
    orders[idx] = updated;
    await saveAll(orders);
    return updated;
  }

  const payload = JSON.stringify({ [flag]: nextValue });
  const { rows } = await pool.query(
    "UPDATE orders SET emails = COALESCE(emails, '{}'::jsonb) || $2::jsonb WHERE id=$1 OR order_number=$1 OR external_reference=$1 RETURNING *",
    [id, payload],
  );
  if (!rows[0]) return null;
  return ensureInvoiceStructure(rows[0]);
}

module.exports = {
  getAll,
  getById,
  saveAll,
  create,
  update,
  list,
  findById,
  softDelete,
  restore,
  createOrder,
  markInventoryApplied,
  clearInventoryApplied,
  markEmailSent,
  upsertByPayment,
  findByPaymentIdentifiers,
  getNormalizedItems,
  normalizeItems,
  normalizeCustomer,
  normalizeAddress,
  appendInvoice,
  listInvoices,
  softDeleteInvoice,
};
