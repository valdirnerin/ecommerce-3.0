const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'config.json');

console.log('email-config', {
  hasKey: !!process.env.RESEND_API_KEY,
  fromNoReply: process.env.FROM_EMAIL_NO_REPLY,
  fromVentas: process.env.FROM_EMAIL_VENTAS,
  fromContacto: process.env.FROM_EMAIL_CONTACTO,
});

let cachedConfig = null;

function readConfigFile() {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cachedConfig = JSON.parse(raw);
  } catch (error) {
    cachedConfig = {};
  }
  return cachedConfig;
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

function normalizeEmailList(value) {
  if (!value && value !== 0) return [];
  const base = Array.isArray(value)
    ? value
    : String(value)
        .split(/[,;\n]+/)
        .map((item) => item.trim());
  return base
    .map((item) => normalizeString(item)?.toLowerCase())
    .filter(Boolean);
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
        `${order.customer.nombre} ${order.customer.apellido || ''}`.trim(),
    ) ||
    normalizeString(order.cliente?.name) ||
    normalizeString(
      order.cliente?.nombre &&
        `${order.cliente.nombre} ${order.cliente.apellido || ''}`.trim(),
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
            ${
              formattedTotal
                ? `<p style="font-size: 14px; line-height: 20px; margin: 0 0 12px; color: #475569;">Total: <strong>${formattedTotal}</strong></p>`
                : ''
            }
            ${footer}
          </td>
        </tr>
      </table>
    </div>
  `;
}

function sanitizeFrom(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function getFrom(type = 'no-reply') {
  const key = typeof type === 'string' ? type : 'no-reply';
  const map = {
    'no-reply': sanitizeFrom(process.env.FROM_EMAIL_NO_REPLY),
    ventas: sanitizeFrom(process.env.FROM_EMAIL_VENTAS),
    contacto: sanitizeFrom(process.env.FROM_EMAIL_CONTACTO),
  };
  const requested = map[key];
  const fallback = map['no-reply'];
  const resolved = requested || fallback || Object.values(map).find(Boolean);
  if (resolved) return resolved;
  throw new Error('FROM_EMAIL not configured');
}

function getEmailConfig() {
  const envKey = sanitizeFrom(process.env.RESEND_API_KEY);
  const envSupport = sanitizeFrom(process.env.SUPPORT_EMAIL);
  if (envKey) {
    return { apiKey: envKey, replyTo: envSupport || null };
  }
  const cfg = readConfigFile();
  const fileKey = sanitizeFrom(cfg?.resendApiKey);
  const fileSupport = sanitizeFrom(cfg?.supportEmail);
  return {
    apiKey: fileKey || null,
    replyTo: envSupport || fileSupport || null,
  };
}

function getSupportEmail() {
  const { replyTo } = getEmailConfig();
  return replyTo || null;
}

function getWholesaleNotificationRecipients() {
  const envList = normalizeEmailList(process.env.WHOLESALE_NOTIFICATION_EMAILS);
  if (envList.length) return envList;
  const cfg = readConfigFile();
  const cfgList = normalizeEmailList(
    cfg?.wholesaleNotificationEmails || cfg?.wholesaleNotifications,
  );
  if (cfgList.length) return cfgList;
  const supportFallback = normalizeEmailList(process.env.SUPPORT_EMAIL);
  if (supportFallback.length) return supportFallback;
  const configSupport = normalizeEmailList(cfg?.supportEmail);
  if (configSupport.length) return configSupport;
  return [];
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, html, type = 'no-reply', replyTo } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const { Resend } = require('resend');
  const { apiKey, replyTo: support } = getEmailConfig();
  if (!apiKey) throw new Error('email service not configured');
  const from = getFrom(type);
  if (!from) throw new Error('FROM_EMAIL not configured');
  const client = new Resend(apiKey);
  try {
    return await client.emails.send({
      from,
      to: recipients,
      subject,
      html,
      reply_to: replyTo || support || undefined,
    });
  } catch (error) {
    throw error?.response?.data || error?.message || error;
  }
}

async function sendOrderConfirmed({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás ayuda, escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `¡Gracias por tu compra, ${customer}!`,
    message:
      'Tu pago fue acreditado correctamente y comenzaremos a preparar tu pedido en breve.',
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Confirmación de compra #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendPaymentPending({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Ante cualquier consulta, respondé este correo o escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Tu pago está en proceso, ${customer}`,
    message:
      'Estamos esperando la confirmación de Mercado Pago. Te avisaremos apenas se acredite.',
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Pago pendiente - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendPaymentRejected({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si creés que es un error, contactanos en <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Necesitamos que revises tu pago, ${customer}`,
    message:
      'El intento de pago fue rechazado. Podés volver a intentar con otra tarjeta o medio de pago en tu cuenta de Mercado Pago.',
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Pago rechazado - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendOrderPreparing({ to, order } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás más información, escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Estamos preparando tu pedido, ${customer}`,
    message:
      'Ya estamos armando tu compra con mucho cuidado. Te avisaremos apenas salga a despacho.',
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Tu pedido está en preparación - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendOrderShipped({
  to,
  order,
  carrier,
  tracking,
  trackingUrl,
  statusUrl,
} = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const normalizedCarrier = normalizeString(carrier)
    || normalizeString(order?.carrier)
    || normalizeString(order?.transportista);
  const normalizedTracking = normalizeString(tracking)
    || normalizeString(order?.tracking)
    || normalizeString(order?.seguimiento)
    || normalizeString(order?.tracking_number)
    || normalizeString(order?.trackingNumber);
  const links = [];
  if (trackingUrl) {
    links.push(
      `<a href="${escapeHtml(trackingUrl)}" style="color: #2563eb;">Seguir envío</a>`,
    );
  }
  if (statusUrl) {
    links.push(
      `<a href="${escapeHtml(statusUrl)}" style="color: #2563eb;">Ver estado del pedido</a>`,
    );
  }
  const extra = [];
  if (normalizedCarrier) {
    extra.push(
      `Transporte: <strong>${escapeHtml(normalizedCarrier)}</strong>`,
    );
  }
  if (normalizedTracking) {
    extra.push(
      `Número de seguimiento: <strong>${escapeHtml(normalizedTracking)}</strong>`,
    );
  }
  let message = 'Ya despachamos tu compra y está en camino.';
  if (extra.length) {
    message += `<br /><br />${extra.join('<br />')}`;
  }
  if (links.length) {
    message += `<br /><br />${links.join('<br />')}`;
  }
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás ayuda con el envío, escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Tu pedido está en camino, ${customer}`,
    message,
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Tu pedido fue despachado - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendOrderDelivered({
  to,
  order,
  statusUrl,
  trackingUrl,
} = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const links = [];
  if (statusUrl) {
    links.push(
      `<a href="${escapeHtml(statusUrl)}" style="color: #2563eb;">Ver estado del pedido</a>`,
    );
  }
  if (trackingUrl) {
    links.push(
      `<a href="${escapeHtml(trackingUrl)}" style="color: #2563eb;">Ver seguimiento</a>`,
    );
  }
  let message = '¡Buenas noticias! Confirmamos que tu pedido ya fue entregado.';
  if (links.length) {
    message += `<br /><br />${links.join('<br />')}`;
  }
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si tenés alguna consulta, respondé este correo o escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Tu pedido ya llegó, ${customer}`,
    message,
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Tu pedido ya fue entregado - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendInvoiceUploaded({
  to,
  order,
  invoiceUrl,
  statusUrl,
} = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const customer = resolveCustomerName(order);
  const orderNumber = resolveOrderNumber(order);
  const supportEmail = getSupportEmail();
  const links = [];
  if (invoiceUrl) {
    links.push(
      `<a href="${escapeHtml(invoiceUrl)}" style="color: #2563eb;">Descargar factura</a>`,
    );
  }
  if (statusUrl) {
    links.push(
      `<a href="${escapeHtml(statusUrl)}" style="color: #2563eb;">Ver estado del pedido</a>`,
    );
  }
  let message = 'Ya podés acceder a la factura de tu compra.';
  if (links.length) {
    message += `<br /><br />${links.join('<br />')}`;
  }
  const footer = supportEmail
    ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Si necesitás otra copia o tenés dudas sobre tu comprobante, escribinos a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    : '';
  const html = buildHtmlTemplate({
    heading: `Factura disponible, ${customer}`,
    message,
    footer,
    order,
  });
  return sendEmail({
    to: recipients,
    subject: `Factura disponible - Orden #${orderNumber}`,
    html,
    type: 'no-reply',
  });
}

async function sendWholesaleVerificationEmail({ to, code, contactName } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const normalizedName = normalizeString(contactName);
  const greeting = normalizedName ? `Hola ${normalizedName},` : 'Hola,';
  const html = `
    <p>${greeting}</p>
    <p>Gracias por solicitar acceso mayorista en NERIN Parts.</p>
    <p>Tu código de verificación es:</p>
    <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${code}</p>
    <p>Ingresalo en el formulario dentro de los próximos 30 minutos para continuar con la solicitud.</p>
    <p>Si no solicitaste este código podés ignorar este mensaje.</p>
  `;
  return sendEmail({
    to: recipients,
    subject: 'Código de verificación mayorista – NERIN Parts',
    html,
    type: 'no-reply',
  });
}

async function sendWholesaleApplicationReceived({ to, contactName } = {}) {
  const recipients = ensureArray(to);
  if (!recipients.length) return null;
  const normalizedName = normalizeString(contactName);
  const greeting = normalizedName ? `Hola ${normalizedName},` : 'Hola,';
  const html = `
    <p>${greeting}</p>
    <p>Recibimos tu solicitud para acceder a nuestra tienda mayorista.</p>
    <p>En un plazo de 24 a 48 hs hábiles nuestro equipo validará la información y te responderá por correo.</p>
    <p>Gracias por confiar en NERIN Parts.</p>
  `;
  return sendEmail({
    to: recipients,
    subject: 'Solicitud mayorista recibida – NERIN Parts',
    html,
    type: 'no-reply',
  });
}

async function sendWholesaleInternalNotification({ request, baseUrl } = {}) {
  const recipients = getWholesaleNotificationRecipients();
  if (!recipients.length) return null;
  if (!request || typeof request !== 'object') return null;
  const normalized = { ...request };
  const contact = normalizeString(normalized.contactName);
  const legalName = normalizeString(normalized.legalName);
  const taxId = normalizeString(normalized.taxId);
  const email = normalizeString(normalized.email);
  const phone = normalizeString(normalized.phone);
  const province = normalizeString(normalized.province);
  const website = normalizeString(normalized.website);
  const companyType = normalizeString(normalized.companyType);
  const salesChannel = normalizeString(normalized.salesChannel);
  const monthlyVolume = normalizeString(normalized.monthlyVolume);
  const systems = normalizeString(normalized.systems);
  const notes = normalizeString(normalized.notes);
  const submittedAt = normalizeString(normalized.submittedAt || normalized.createdAt);
  const formattedDate = submittedAt
    ? new Date(submittedAt).toLocaleString('es-AR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const displayName = legalName || contact || email || 'Nueva solicitud mayorista';
  const details = [
    ['Razón social', legalName],
    ['Contacto', contact],
    ['Correo', email],
    ['Teléfono', phone],
    ['CUIT', taxId],
    ['Provincia', province],
    ['Sitio web', website],
    ['Tipo de empresa', companyType],
    ['Canal de ventas', salesChannel],
    ['Volumen mensual', monthlyVolume],
    ['Sistemas', systems],
    ['Notas', notes],
    ['Enviado', formattedDate],
  ].filter(([, value]) => Boolean(value));

  const manageLink = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/admin.html`
    : null;

  const rows = details
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 4px 8px; font-weight: 600; color: #0f172a; white-space: nowrap;">${escapeHtml(
            label,
          )}</td>
          <td style="padding: 4px 8px; color: #334155;">${escapeHtml(value)}</td>
        </tr>
      `,
    )
    .join('');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; background: #f8fafc; padding: 24px; color: #0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
        <tr>
          <td style="padding: 32px;">
            <h1 style="font-size: 20px; margin: 0 0 16px;">Nueva solicitud mayorista</h1>
            <p style="font-size: 16px; line-height: 24px; margin: 0 0 16px;">Se recibió una nueva solicitud para acceder a la tienda mayorista.</p>
            <p style="font-size: 15px; line-height: 22px; margin: 0 0 16px; color: #475569;"><strong>${escapeHtml(
              displayName,
            )}</strong></p>
            ${
              rows
                ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px;">${rows}</table>`
                : ''
            }
            ${
              manageLink
                ? `<p style="font-size: 14px; line-height: 20px; margin: 16px 0 0;">Gestioná la solicitud desde el <a href="${escapeHtml(
                    manageLink,
                  )}" style="color: #2563eb;">panel de administración</a>.</p>`
                : ''
            }
          </td>
        </tr>
      </table>
    </div>
  `;

  const subject = `Nueva solicitud mayorista – ${displayName}`;

  return sendEmail({
    to: recipients,
    subject,
    html,
    type: 'contacto',
  });
}

module.exports = {
  getFrom,
  getEmailConfig,
  sendEmail,
  sendOrderConfirmed,
  sendPaymentPending,
  sendPaymentRejected,
  sendOrderPreparing,
  sendOrderShipped,
  sendOrderDelivered,
  sendInvoiceUploaded,
  sendWholesaleVerificationEmail,
  sendWholesaleApplicationReceived,
  sendWholesaleInternalNotification,
};
