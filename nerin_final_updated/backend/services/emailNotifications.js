const { Resend } = require('resend');

let fileConfig = null;
try {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  fileConfig = require('../../data/config.json');
} catch (err) {
  fileConfig = null;
}

const apiKey = process.env.RESEND_API_KEY || fileConfig?.resendApiKey || null;

function getFrom(type = 'no-reply') {
  const key = typeof type === 'string' ? type.trim().toLowerCase() : 'no-reply';
  const { FROM_EMAIL_NO_REPLY, FROM_EMAIL_VENTAS, FROM_EMAIL_CONTACTO } =
    process.env;

  let from;
  if (key === 'no-reply') {
    from = FROM_EMAIL_NO_REPLY;
  } else if (key === 'ventas') {
    from = FROM_EMAIL_VENTAS;
  } else if (key === 'contacto') {
    from = FROM_EMAIL_CONTACTO;
  }

  if (!from) {
    from = FROM_EMAIL_NO_REPLY;
  }

  if (!from) {
    throw new Error('FROM_EMAIL not configured');
  }

  return from;
}

let defaultFrom;
try {
  defaultFrom = getFrom('no-reply');
} catch (err) {
  defaultFrom = null;
}

console.log('email-config', { hasKey: !!apiKey, from: defaultFrom });

async function sendEmail({ to, subject, html, type = 'no-reply', replyTo }) {
  if (!apiKey) {
    throw new Error('email service not configured');
  }

  const client = new Resend(apiKey);
  const from = getFrom(type);
  const reply_to = replyTo || process.env.SUPPORT_EMAIL;

  try {
    return await client.emails.send({ from, to, subject, html, reply_to });
  } catch (e) {
    throw e.response?.data || e.message;
  }
}

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
    normalizeString(
      order.customer?.nombre &&
        `${order.customer.nombre} ${order.customer.apellido || ''}`,
    ) ||
    normalizeString(order.cliente?.name) ||
    normalizeString(
      order.cliente?.nombre &&
        `${order.cliente.nombre} ${order.cliente.apellido || ''}`,
    ) ||
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

async function sendOrderConfirmed({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const html = buildHtmlTemplate({
    heading: `¡Gracias por tu compra, ${customer}!`,
    message:
      'Tu pago fue acreditado correctamente y comenzaremos a preparar tu pedido en breve.',
    footer:
      process.env.SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás ayuda, escribinos a <a href="mailto:${process.env.SUPPORT_EMAIL}">${process.env.SUPPORT_EMAIL}</a>.</p>`
        : '',
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Confirmación de compra #${orderNumber}`,
    html,
    replyTo: process.env.SUPPORT_EMAIL,
  });
}

async function sendPaymentPending({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const html = buildHtmlTemplate({
    heading: `Tu pago está en proceso, ${customer}`,
    message:
      'Estamos esperando la confirmación de Mercado Pago. Te avisaremos apenas se acredite.',
    footer:
      process.env.SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Ante cualquier consulta, respondé este correo o escribinos a <a href="mailto:${process.env.SUPPORT_EMAIL}">${process.env.SUPPORT_EMAIL}</a>.</p>`
        : '',
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Pago pendiente - Orden #${orderNumber}`,
    html,
    replyTo: process.env.SUPPORT_EMAIL,
  });
}

async function sendPaymentRejected({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const html = buildHtmlTemplate({
    heading: `Necesitamos que revises tu pago, ${customer}`,
    message:
      'El intento de pago fue rechazado. Podés volver a intentar con otra tarjeta o medio de pago en tu cuenta de Mercado Pago.',
    footer:
      process.env.SUPPORT_EMAIL
        ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si creés que es un error, contactanos en <a href="mailto:${process.env.SUPPORT_EMAIL}">${process.env.SUPPORT_EMAIL}</a>.</p>`
        : '',
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Pago rechazado - Orden #${orderNumber}`,
    html,
    replyTo: process.env.SUPPORT_EMAIL,
  });
}

module.exports = {
  getFrom,
  sendEmail,
  sendOrderConfirmed,
  sendPaymentPending,
  sendPaymentRejected,
};
