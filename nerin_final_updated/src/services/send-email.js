import React from "react";
import { resend, FROM } from "../lib/resend.js";
import OrderConfirmedEmail from "../emails/OrderConfirmedEmail.tsx";
import PaymentPendingEmail from "../emails/PaymentPendingEmail.tsx";
import PaymentRejectedEmail from "../emails/PaymentRejectedEmail.tsx";

const RETRIABLE_STATUS = new Set([429, 500, 502, 503]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extractStatus = (error) => {
  if (!error) return null;
  const candidates = [
    error.status,
    error.statusCode,
    error.code,
    error.response?.status,
    error.res?.status,
    error.data?.statusCode,
    error.data?.status,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
};

const normalizeString = (value) => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const pickFirst = (...values) => {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
};

const normalizeItems = (order = {}) => {
  const source = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.productos)
    ? order.productos
    : [];

  return source
    .map((item = {}) => {
      const quantity = Number(
        item.quantity ??
          item.qty ??
          item.cantidad ??
          item.cant ??
          item.count ??
          0,
      );
      const price = Number(
        item.price ??
          item.unit_price ??
          item.unitPrice ??
          item.precio ??
          item.amount ??
          0,
      );
      const name =
        pickFirst(
          item.name,
          item.title,
          item.titulo,
          item.descripcion,
          item.description,
          item.product_name,
          item.productName,
          item.product_title,
          item.productTitle,
        ) || "Producto";

      return {
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
        price: Number.isFinite(price) && price >= 0 ? price : 0,
      };
    })
    .filter((item) => item.quantity > 0);
};

const computeOrderTotal = (order = {}, items = []) => {
  const candidates = [
    order.total,
    order.total_amount,
    order.amount,
    order.amount_total,
    order.items_total,
    order.totalAmount,
    order.payment?.total,
    order.payment?.total_paid_amount,
    order.summary?.total,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  if (items.length) {
    return items.reduce((acc, item) => acc + Number(item.price || 0) * item.quantity, 0);
  }

  return 0;
};

const resolveOrderNumber = (order = {}) =>
  pickFirst(
    order.orderNumber,
    order.order_number,
    order.id,
    order.order_id,
    order.orderId,
    order.external_reference,
    order.externalReference,
  ) || "sin-número";

const resolveCustomerName = (order = {}) =>
  pickFirst(
    order.customer?.name,
    order.customer?.fullName,
    order.customer?.nombre,
    order.customer?.first_name &&
      `${order.customer.first_name} ${order.customer.last_name || ""}`,
    order.cliente?.name,
    order.cliente?.nombre &&
      `${order.cliente.nombre} ${order.cliente.apellido || ""}`,
    order.customer_name,
    order.client_name,
    order.nombre,
    order.name,
  ) || "cliente";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  const normalized = normalizeString(value);
  return normalized ? [normalized] : [];
};

const ensureSendResult = (result) => {
  if (result?.error) {
    const status = extractStatus(result.error);
    const err = new Error(result.error.message || "Email send failed");
    if (status) err.status = status;
    err.cause = result.error;
    throw err;
  }
  return result;
};

export async function withRetries(fn, { retries = 3, base = 500 } = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("withRetries requires a function as the first argument");
  }

  let attempt = 0;
  let delay = Math.max(0, Number(base) || 0);

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      const status = extractStatus(error);
      const shouldRetry = attempt <= retries && RETRIABLE_STATUS.has(status);
      if (!shouldRetry) {
        const statusCode =
          error?.statusCode ?? error?.status ?? error?.response?.status ?? status ?? null;
        console.error("[send-email] Email send failed", {
          attempt,
          statusCode,
          error: error?.message || error,
        });
      }
      if (!shouldRetry) {
        throw error;
      }

      const jitter = Math.random() * (Math.max(1, delay) || 1);
      await sleep(delay + jitter);
      delay = delay ? delay * 2 : Math.max(1, base || 1) * 2 ** attempt;
    }
  }
}

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL;

export const sendOrderConfirmed = async ({ to, order } = {}) => {
  const recipients = ensureArray(to);
  const items = normalizeItems(order);
  const total = computeOrderTotal(order, items);
  const orderNumber = resolveOrderNumber(order);
  const customerName = resolveCustomerName(order);

  console.info("[send-email] Preparing to send order-confirmed email", {
    to: recipients,
    orderNumber: order?.number ?? orderNumber,
  });

  return withRetries(async () =>
    ensureSendResult(
      await resend.emails.send({
        from: FROM,
        to: recipients,
        subject: `Confirmación de compra #${orderNumber}`,
        react: (
          <OrderConfirmedEmail
            orderNumber={orderNumber}
            customerName={customerName}
            total={total}
            items={items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            }))}
            supportEmail={SUPPORT_EMAIL || "soporte@nerin.com"}
          />
        ),
        replyTo: SUPPORT_EMAIL,
      }),
    ),
  );
};

export const sendPaymentPending = async ({ to, order } = {}) => {
  const recipients = ensureArray(to);
  const orderNumber = resolveOrderNumber(order);
  const customerName = resolveCustomerName(order);

  console.info("[send-email] Preparing to send payment-pending email", {
    to: recipients,
    orderNumber: order?.number ?? orderNumber,
  });

  return withRetries(async () =>
    ensureSendResult(
      await resend.emails.send({
        from: FROM,
        to: recipients,
        subject: `Pago pendiente - Orden #${orderNumber}`,
        react: (
          <PaymentPendingEmail
            orderNumber={orderNumber}
            customerName={customerName}
            supportEmail={SUPPORT_EMAIL || "soporte@nerin.com"}
          />
        ),
        replyTo: SUPPORT_EMAIL,
      }),
    ),
  );
};

export const sendPaymentRejected = async ({ to, order } = {}) => {
  const recipients = ensureArray(to);
  const orderNumber = resolveOrderNumber(order);
  const customerName = resolveCustomerName(order);

  console.info("[send-email] Preparing to send payment-rejected email", {
    to: recipients,
    orderNumber: order?.number ?? orderNumber,
  });

  return withRetries(async () =>
    ensureSendResult(
      await resend.emails.send({
        from: FROM,
        to: recipients,
        subject: `Pago rechazado - Orden #${orderNumber}`,
        react: (
          <PaymentRejectedEmail
            orderNumber={orderNumber}
            customerName={customerName}
            supportEmail={SUPPORT_EMAIL || "soporte@nerin.com"}
          />
        ),
        replyTo: SUPPORT_EMAIL,
      }),
    ),
  );
};
