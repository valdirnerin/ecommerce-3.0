const { Resend } = require('resend');

const resendApiKey = process.env.RESEND_API_KEY || '';
const FROM = process.env.FROM_EMAIL || 'NERIN <no-reply@nerin.com.ar>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || '';

const resend = resendApiKey ? new Resend(resendApiKey) : null;

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeString(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function resolveOrderNumber(order = {}) {
  return (
    normalizeString(order.order_number) ||
    normalizeString(order.orderNumber) ||
    normalizeString(order.external_reference) ||
    normalizeString(order.externalReference) ||
    normalizeString(order.preference_id) ||
    normalizeString(order.id) ||
    'pedido'
  );
}

function resolveCustomerName(order = {}) {
  return (
    normalizeString(order.customer?.name) ||
    normalizeString(order.customer?.fullName) ||
    normalizeString(order.customer?.nombre &&
      `${order.customer.nombre} ${order.customer.apellido || ''}`) ||
    normalizeString(order.cliente?.name) ||
    normalizeString(order.cliente?.nombre &&
      `${order.cliente.nombre} ${order.cliente.apellido || ''}`) ||
    normalizeString(order.customer_name) ||
    normalizeString(order.client_name) ||
    normalizeString(order.nombre) ||
    normalizeString(order.name) ||
    'cliente'
  );
}

function computeOrderTotal(order = {}) {
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

  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length) {
    return items.reduce((acc, item) => {
      const price = Number(
        item.price ??
          item.unit_price ??
          item.unitPrice ??
          item.precio ??
          item.amount ??
          0,
      );
      const qty = Number(
        item.quantity ??
          item.qty ??
          item.cantidad ??
          item.cant ??
          item.count ??
          0,
      );
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return acc;
      return acc + price * qty;
    }, 0);
  }

  return 0;
}

function formatCurrency(amount) {
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildHtmlTemplate({ heading, message, footer, order }) {
  const orderNumber = resolveOrderNumber(order);
  const total = computeOrderTotal(order);
  const formattedTotal = total ? formatCurrency(total) : null;
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #f8fafc; padding: 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
        <tr>
          <td style="padding: 32px;">
            <h1 style="font-size: 20px; margin: 0 0 16px;">${heading}</h1>
            <p style="font-size: 16px; line-height: 24px; margin: 0 0 16px;">${message}</p>
            <p style="font-size: 14px; line-height: 20px; margin: 0 0 12px; color: #475569;">Número de pedido: <strong>${orderNumber}</strong></p>
            ${formattedTotal ? `<p style="font-size: 14px; line-height: 20px; margin: 0 0 12px; color: #475569;">Total: <strong>${formattedTotal}</strong></p>` : ''}
            ${footer}
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function sendEmail({ to, subject, heading, message, footer, order }) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  if (!resend) {
    console.info('email service not configured, skipping send', { subject });
    return null;
  }
  const html = buildHtmlTemplate({ heading, message, footer, order });
  try {
    return await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
      reply_to: SUPPORT_EMAIL || undefined,
    });
  } catch (error) {
    throw error;
  }
}

async function sendOrderConfirmed({ to, order } = {}) {
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  return sendEmail({
    to,
    order,
    subject: `Confirmación de compra #${orderNumber}`,
    heading: `¡Gracias por tu compra, ${customer}!`,
    message:
      'Tu pago fue acreditado correctamente y comenzaremos a preparar tu pedido en breve.',
    footer:
      SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás ayuda, escribinos a <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`
        : '',
  });
}

async function sendPaymentPending({ to, order } = {}) {
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  return sendEmail({
    to,
    order,
    subject: `Pago pendiente - Orden #${orderNumber}`,
    heading: `Tu pago está en proceso, ${customer}`,
    message:
      'Estamos esperando la confirmación de Mercado Pago. Te avisaremos apenas se acredite.',
    footer:
      SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Ante cualquier consulta, respondé este correo o escribinos a <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`
        : '',
  });
}

async function sendPaymentRejected({ to, order } = {}) {
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  return sendEmail({
    to,
    order,
    subject: `Pago rechazado - Orden #${orderNumber}`,
    heading: `Necesitamos que revises tu pago, ${customer}`,
    message:
      'El intento de pago fue rechazado. Podés volver a intentar con otra tarjeta o medio de pago en tu cuenta de Mercado Pago.',
    footer:
      SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si creés que es un error, contactanos en <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`
        : '',
  });
}

module.exports = {
  sendOrderConfirmed,
  sendPaymentPending,
  sendPaymentRejected,
};
