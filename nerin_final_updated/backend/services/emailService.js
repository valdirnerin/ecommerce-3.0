const { Resend } = require('resend');
const emailLogsRepo = require('../data/emailLogsRepo');

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrencyARS(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatByMap(value, map, fallback = '—') {
  const normalized = normalizeString(value).toLowerCase().replace(/[-\s]+/g, '_');
  if (!normalized) return fallback;
  return map[normalized] || value || fallback;
}

function formatPaymentMethod(value) {
  return formatByMap(value, {
    mercado_pago: 'Mercado Pago',
    mp: 'Mercado Pago',
    bank_transfer: 'Transferencia bancaria',
    transferencia: 'Transferencia bancaria',
    cash: 'Efectivo',
    efectivo: 'Efectivo',
    card: 'Tarjeta',
  });
}

function formatPaymentStatus(value) {
  return formatByMap(value, {
    pending: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
    paid: 'Pago aprobado',
    payment_approved: 'Pago aprobado',
    in_process: 'En proceso',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
  });
}

function formatOrderStatus(value) {
  return formatByMap(value, {
    pending: 'Pendiente',
    paid: 'Pago aprobado',
    preparing: 'En preparación',
    shipped: 'Enviado',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
  });
}

function formatShippingStatus(value) {
  return formatByMap(value, {
    pending: 'Pendiente',
    preparing: 'En preparación',
    shipped: 'Enviado',
    delivered: 'Entregado',
    ready_for_pickup: 'Listo para retiro',
  });
}

function formatInvoiceStatus(value) {
  return formatByMap(value, {
    pending: 'Factura pendiente',
    invoice_pending: 'Factura pendiente',
    emitida: 'Factura disponible',
    available: 'Factura disponible',
    invoice_available: 'Factura disponible',
  });
}

function formatCustomerName(value) {
  const name = normalizeString(value);
  return name || 'Cliente';
}

function formatOrderNumber(value) {
  const orderNumber = normalizeString(value);
  return orderNumber || '—';
}

function resolveBaseUrl() {
  return (
    normalizeString(process.env.APP_BASE_URL) ||
    normalizeString(process.env.PUBLIC_BASE_URL) ||
    normalizeString(process.env.FRONTEND_BASE_URL) ||
    ''
  ).replace(/\/+$/, '');
}

function resolveTrackingUrl(order = {}, customer = {}) {
  const base = resolveBaseUrl();
  if (!base) return null;
  const orderId = normalizeString(order.order_number || order.orderNumber || order.id);
  const email = normalizeString(customer.email || order.customer_email || order.user_email);
  if (!orderId) return `${base}/seguimiento.html`;
  const params = new URLSearchParams();
  params.set('order', orderId);
  if (email) params.set('email', email);
  return `${base}/seguimiento.html?${params.toString()}`;
}

function splitEmailList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveAdminSalesRecipients() {
  const direct = splitEmailList(process.env.ADMIN_SALES_EMAIL);
  const list = splitEmailList(process.env.ADMIN_SALES_EMAILS);
  const merged = [...direct, ...list];
  return Array.from(new Set(merged)).filter((email) => emailLogsRepo.normalizeEmailRecipient(email));
}

function buildLayout({ title, preheader, intro, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return {
    html: `
      <div style="background:#f5f7fb;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr><td style="padding:24px 28px;background:#0f172a;color:#ffffff;font-size:14px;font-weight:700;letter-spacing:.4px;">NERIN Parts</td></tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 10px;font-size:13px;color:#64748b;">${escapeHtml(preheader || '')}</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(intro)}</p>
              ${bodyHtml}
              ${cta}
              <p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.5;">${escapeHtml(footerNote || 'Equipo NERIN Parts')}</p>
            </td>
          </tr>
        </table>
      </div>
    `,
    text: `${title}\n\n${intro}\n\n${footerNote || 'Equipo NERIN Parts'}`,
  };
}

function keyValueCard(rows = []) {
  const items = rows
    .filter((row) => row && row.label)
    .map((row) => `
      <tr>
        <td style="padding:8px 0;color:#64748b;font-size:13px;width:42%;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(row.value || '—')}</td>
      </tr>
    `)
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">${items}</table>`;
}

function buildOrderContext(order = {}, customer = {}) {
  const customerName = formatCustomerName(customer.name || order.customer_name || order.first_name);
  const orderNumber = formatOrderNumber(order.order_number || order.orderNumber || order.id);
  const total = formatCurrencyARS(order.total_amount || order.total || order.amount);
  const paymentMethod = formatPaymentMethod(order.payment_method || order.paymentMethod);
  const trackingUrl = resolveTrackingUrl(order, customer);
  const whatsappUrl = normalizeString(process.env.WHATSAPP_URL);
  return { customerName, orderNumber, total, paymentMethod, trackingUrl, whatsappUrl };
}

function createEmailBuilders() {
  return {
    orderReceived: (order, customer) => {
      const ctx = buildOrderContext(order, customer);
      return buildLayout({
        title: `Recibimos tu pedido #${ctx.orderNumber}`,
        preheader: 'Confirmación de pedido',
        intro: `Hola ${ctx.customerName}, recibimos tu pedido y ya está en revisión interna.`,
        bodyHtml: keyValueCard([
          { label: 'Número de pedido', value: ctx.orderNumber },
          { label: 'Total', value: ctx.total },
          { label: 'Método de pago', value: ctx.paymentMethod },
        ]),
        ctaLabel: 'Ver seguimiento',
        ctaUrl: ctx.trackingUrl,
        footerNote: ctx.whatsappUrl ? `Soporte por WhatsApp: ${ctx.whatsappUrl}` : 'Equipo NERIN Parts',
      });
    },
    paymentApproved: (order, customer) => {
      const ctx = buildOrderContext(order, customer);
      return buildLayout({
        title: `Pago aprobado para tu pedido #${ctx.orderNumber}`,
        preheader: 'Pago confirmado',
        intro: `Hola ${ctx.customerName}, tu pago fue aprobado. Ahora avanzamos con la preparación.`,
        bodyHtml: keyValueCard([
          { label: 'Número de pedido', value: ctx.orderNumber },
          { label: 'Monto acreditado', value: ctx.total },
          { label: 'Método de pago', value: ctx.paymentMethod },
          { label: 'Estado de pago', value: formatPaymentStatus(order.payment_status || order.paymentStatus || 'approved') },
        ]),
        ctaLabel: 'Seguir pedido',
        ctaUrl: ctx.trackingUrl,
      });
    },
    orderPreparing: (order, customer) => {
      const ctx = buildOrderContext(order, customer);
      return buildLayout({
        title: `Tu pedido #${ctx.orderNumber} está en preparación`,
        preheader: 'Pedido en preparación',
        intro: `Hola ${ctx.customerName}, ya estamos preparando tu compra para despacho.`,
        bodyHtml: keyValueCard([
          { label: 'Número de pedido', value: ctx.orderNumber },
          { label: 'Estado', value: formatShippingStatus('preparing') },
        ]),
        ctaLabel: 'Ver estado del pedido',
        ctaUrl: ctx.trackingUrl,
      });
    },
    orderShipped: (order, customer) => {
      const ctx = buildOrderContext(order, customer);
      const carrier = normalizeString(order.carrier || order.transportista);
      const tracking = normalizeString(order.tracking || order.tracking_number || order.seguimiento);
      return buildLayout({
        title: `Tu pedido #${ctx.orderNumber} fue enviado`,
        preheader: 'Pedido despachado',
        intro: `Hola ${ctx.customerName}, despachamos tu pedido y está en camino.`,
        bodyHtml: keyValueCard([
          { label: 'Número de pedido', value: ctx.orderNumber },
          { label: 'Empresa de envío', value: carrier || 'Se informará a la brevedad' },
          { label: 'Tracking', value: tracking || 'Aún no disponible' },
          { label: 'Estado', value: formatShippingStatus('shipped') },
        ]),
        ctaLabel: 'Seguir envío',
        ctaUrl: ctx.trackingUrl,
      });
    },
    invoiceAvailable: (order, customer) => {
      const ctx = buildOrderContext(order, customer);
      const invoiceUrl = normalizeString(order.invoiceUrl || order.invoice_url || order.invoice_link);
      return buildLayout({
        title: `Factura disponible para el pedido #${ctx.orderNumber}`,
        preheader: 'Factura emitida',
        intro: `Hola ${ctx.customerName}, ya podés descargar la factura de tu compra.`,
        bodyHtml: keyValueCard([
          { label: 'Número de pedido', value: ctx.orderNumber },
          { label: 'Estado de factura', value: formatInvoiceStatus('invoice_available') },
        ]),
        ctaLabel: invoiceUrl ? 'Descargar factura' : 'Ver pedido',
        ctaUrl: invoiceUrl || ctx.trackingUrl,
      });
    },
    wholesaleRequestReceived: (request = {}) => buildLayout({
      title: 'Recibimos tu solicitud mayorista',
      preheader: 'Solicitud en revisión',
      intro: `Hola ${formatCustomerName(request.contactName || request.legalName)}, recibimos tu solicitud y la estamos revisando.`,
      bodyHtml: keyValueCard([
        { label: 'Razón social', value: normalizeString(request.legalName) || '—' },
        { label: 'CUIT', value: normalizeString(request.taxId) || '—' },
        { label: 'Fecha de recepción', value: formatDate(new Date()) },
      ]),
    }),
    wholesaleApproved: (request = {}) => {
      const base = resolveBaseUrl();
      return buildLayout({
        title: 'Tu cuenta mayorista fue aprobada',
        preheader: 'Acceso habilitado',
        intro: `Hola ${formatCustomerName(request.contactName || request.legalName)}, ya podés ingresar al portal mayorista.`,
        bodyHtml: keyValueCard([
          { label: 'Estado', value: 'Aprobada' },
          { label: 'Próximo paso', value: 'Ingresar al portal y validar datos de cuenta' },
        ]),
        ctaLabel: 'Ingresar al portal',
        ctaUrl: base ? `${base}/login.html` : null,
      });
    },
    wholesaleRejected: (request = {}) => buildLayout({
      title: 'Actualización de tu solicitud mayorista',
      preheader: 'Solicitud no aprobada',
      intro: `Hola ${formatCustomerName(request.contactName || request.legalName)}, por el momento no pudimos aprobar tu solicitud.`,
      bodyHtml: keyValueCard([
        { label: 'Estado', value: 'Requiere revisión' },
        { label: 'Siguiente paso', value: 'Contactanos para corregir datos y reintentar' },
      ]),
    }),
    passwordReset: (user = {}, resetLink) => buildLayout({
      title: 'Recuperación de contraseña',
      preheader: 'Acceso a tu cuenta',
      intro: `Hola ${formatCustomerName(user.name || user.email)}, recibimos un pedido para recuperar tu contraseña.`,
      bodyHtml: keyValueCard([{ label: 'Enlace de recuperación', value: resetLink || 'No disponible' }]),
      ctaLabel: resetLink ? 'Recuperar acceso' : null,
      ctaUrl: resetLink || null,
    }),
    contactForm: (data = {}) => buildLayout({
      title: 'Recibimos tu consulta',
      preheader: 'Formulario de contacto',
      intro: `Hola ${formatCustomerName(data.name)}, gracias por escribirnos. Nuestro equipo te responderá pronto.`,
      bodyHtml: keyValueCard([
        { label: 'Nombre', value: normalizeString(data.name) || '—' },
        { label: 'Canal', value: normalizeString(data.channel) || 'Formulario web' },
        { label: 'Mensaje', value: normalizeString(data.message) || '—' },
      ]),
    }),
    adminSaleNotification: (order = {}) => {
      const customer = order?.customer || order?.cliente || {};
      const customerEmail = normalizeString(customer.email || order.user_email || order.customer_email);
      const customerName = formatCustomerName(
        customer.name ||
          customer.nombre ||
          `${customer.nombre || ''} ${customer.apellido || ''}`.trim(),
      );
      const customerPhone = normalizeString(customer.phone || customer.telefono || customer.whatsapp);
      const shippingAddress = normalizeString(
        customer.address ||
          customer.direccion ||
          order.shipping_address ||
          order.shippingAddress,
      );
      const orderNumber = formatOrderNumber(order.order_number || order.id);
      const createdAt = formatDate(order.created_at || order.fecha || new Date());
      const paymentMethod = formatPaymentMethod(order.payment_method || order.metodo_pago);
      const rawPaymentStatus =
        order.payment_status || order.estado_pago || order.payment_status_code;
      const paymentStatus = formatPaymentStatus(rawPaymentStatus);
      const normalizedPayment = normalizeString(rawPaymentStatus).toLowerCase();
      const paymentClarification =
        normalizedPayment === "approved" || normalizedPayment === "aprobado" || normalizedPayment === "paid"
          ? "Pago aprobado."
          : "Pago pendiente / a confirmar.";
      const shippingStatus = formatShippingStatus(order.shipping_status || order.estado_envio);
      const shippingMethod = normalizeString(order.shipping_method || order.metodo_envio || order.metodo);
      const carrier = normalizeString(order.carrier || order.transportista);
      const tracking = normalizeString(order.tracking || order.seguimiento);
      const labelUrl = normalizeString(order.andreani_label_url || order.shipping_label_url);
      const orderTotal = formatCurrencyARS(order.total || order.total_amount || order.amount);
      const items = Array.isArray(order.items) ? order.items : Array.isArray(order.productos) ? order.productos : [];
      const itemsRows = items
        .map((item) => {
          const qty = Number(item.quantity ?? item.qty ?? item.cantidad ?? 0) || 0;
          const unit = Number(item.price ?? item.unit_price ?? item.precio ?? 0) || 0;
          const subtotal = qty * unit;
          return `<tr><td style="padding:6px 0;">${escapeHtml(item.name || item.title || 'Producto')}</td><td style="padding:6px 0;">${escapeHtml(item.sku || item.code || item.id || '—')}</td><td style="padding:6px 0;">${escapeHtml(item.model || item.modelo || '—')}</td><td style="padding:6px 0;">${qty || '—'}</td><td style="padding:6px 0;">${formatCurrencyARS(unit)}</td><td style="padding:6px 0;">${formatCurrencyARS(subtotal)}</td></tr>`;
        })
        .join('');
      const trackingLabel = tracking || "Etiqueta Andreani: pendiente de generar";
      const adminUrl = resolveBaseUrl() ? `${resolveBaseUrl()}/admin.html` : null;
      const trackingUrl = resolveTrackingUrl(order, { email: customerEmail });
      const whatsappLink = customerPhone
        ? `https://wa.me/${customerPhone.replace(/[^\d]/g, '')}`
        : null;
      return buildLayout({
        title: `Nuevo pedido recibido en NERIN Parts — Pedido #${orderNumber}`,
        preheader: `Nuevo pedido web — Total ${orderTotal}`,
        intro: `Se generó un nuevo pedido desde la web. Estado del pago: ${paymentStatus}. ${paymentClarification}`,
        bodyHtml: `
          ${keyValueCard([
            { label: 'Pedido', value: orderNumber },
            { label: 'Fecha', value: createdAt },
            { label: 'Total', value: orderTotal },
            { label: 'Moneda', value: 'ARS' },
          ])}
          <h3 style="margin:18px 0 8px;">Cliente</h3>
          ${keyValueCard([
            { label: 'Nombre', value: customerName },
            { label: 'Email', value: customerEmail || '—' },
            { label: 'Teléfono', value: customerPhone || '—' },
          ])}
          <h3 style="margin:18px 0 8px;">Productos vendidos</h3>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse;">
            <tr><th align="left">Producto</th><th align="left">SKU</th><th align="left">Modelo</th><th align="left">Cant.</th><th align="left">Unitario</th><th align="left">Subtotal</th></tr>
            ${itemsRows || '<tr><td colspan="6">Sin detalle de items</td></tr>'}
          </table>
          <h3 style="margin:18px 0 8px;">Pago</h3>
          ${keyValueCard([
            { label: 'Método', value: paymentMethod },
            { label: 'Estado', value: paymentStatus },
            { label: 'Total', value: orderTotal },
          ])}
          <h3 style="margin:18px 0 8px;">Envío</h3>
          ${keyValueCard([
            { label: 'Método', value: shippingMethod || '—' },
            { label: 'Empresa', value: carrier || '—' },
            { label: 'Estado', value: shippingStatus },
            { label: 'Dirección', value: shippingAddress || '—' },
            { label: 'Tracking', value: trackingLabel },
            { label: 'Etiqueta', value: labelUrl || 'Etiqueta Andreani: pendiente de generar' },
          ])}
          <h3 style="margin:18px 0 8px;">Acciones</h3>
          <p style="margin:0;">
            ${adminUrl ? `<a href="${escapeHtml(adminUrl)}">Ver pedido en admin</a><br/>` : ''}
            ${trackingUrl ? `<a href="${escapeHtml(trackingUrl)}">Ver seguimiento del pedido</a><br/>` : ''}
            ${whatsappLink ? `<a href="${escapeHtml(whatsappLink)}">Contactar cliente por WhatsApp</a><br/>` : ''}
            ${labelUrl ? `<a href="${escapeHtml(labelUrl)}">Ver/descargar etiqueta</a>` : 'Crear/imprimir etiqueta: pendiente'}
          </p>
        `,
      });
    },
  };
}

function getEmailRuntimeConfig() {
  return {
    apiKey: normalizeString(process.env.RESEND_API_KEY),
    from:
      normalizeString(process.env.RESEND_FROM_EMAIL) ||
      normalizeString(process.env.EMAIL_FROM) ||
      normalizeString(process.env.FROM_EMAIL_NO_REPLY),
    replyTo:
      normalizeString(process.env.RESEND_REPLY_TO) ||
      normalizeString(process.env.EMAIL_REPLY_TO) ||
      normalizeString(process.env.SUPPORT_EMAIL),
    emailsEnabled: normalizeString(process.env.EMAILS_ENABLED).toLowerCase() !== 'false',
    testMode: normalizeString(process.env.EMAIL_TEST_MODE).toLowerCase() === 'true',
    testRecipient: normalizeString(process.env.EMAIL_TEST_RECIPIENT),
    nodeEnv: normalizeString(process.env.NODE_ENV) || 'development',
  };
}

async function sendTransactionalEmail({ to, subject, html, text, replyTo, metadata, testMode } = {}) {
  const cfg = getEmailRuntimeConfig();
  const destination = normalizeString(to);
  const safeSubject = normalizeString(subject);
  const safeHtml = normalizeString(html);
  const safeText = normalizeString(text);
  const forcedTestMode = Boolean(testMode);
  const runtimeTestMode = forcedTestMode || cfg.testMode || cfg.nodeEnv !== 'production';

  if (!destination || !safeSubject || (!safeHtml && !safeText)) {
    return { ok: false, skipped: true, dryRun: true, provider: 'resend', error: 'invalid-email-payload' };
  }

  if (!cfg.emailsEnabled) {
    return { ok: true, skipped: true, dryRun: true, provider: 'resend', error: null };
  }

  if (!cfg.from) {
    return { ok: false, skipped: true, dryRun: true, provider: 'resend', error: 'missing-from-email' };
  }

  if (!cfg.apiKey) {
    return { ok: true, skipped: true, dryRun: true, provider: 'resend', error: 'missing-resend-api-key' };
  }

  const realTo = runtimeTestMode ? (cfg.testRecipient || '') : destination;
  if (!realTo) {
    return { ok: true, skipped: true, dryRun: true, provider: 'resend', error: 'missing-test-recipient' };
  }

  const client = new Resend(cfg.apiKey);
  try {
    const result = await client.emails.send({
      from: cfg.from,
      to: [realTo],
      subject: runtimeTestMode ? `[TEST] ${safeSubject}` : safeSubject,
      html: safeHtml || undefined,
      text: safeText || undefined,
      reply_to: normalizeString(replyTo) || cfg.replyTo || undefined,
      headers: runtimeTestMode ? { 'X-NERIN-Email-Test-Mode': 'true' } : undefined,
      tags: metadata && typeof metadata === 'object'
        ? Object.entries(metadata)
            .filter(([, value]) => value != null)
            .slice(0, 5)
            .map(([name, value]) => ({ name: normalizeString(name), value: normalizeString(value) }))
        : undefined,
    });
    return {
      ok: true,
      skipped: false,
      dryRun: runtimeTestMode,
      provider: 'resend',
      providerMessageId: result?.data?.id || result?.id || null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      dryRun: runtimeTestMode,
      provider: 'resend',
      providerMessageId: null,
      error: error?.message || 'send-failed',
    };
  }
}


function extractStatusFromSendResult(result = {}) {
  if (result?.error === 'missing-resend-api-key') return 'dry_run';
  if (result?.error === 'missing-test-recipient') return 'dry_run';
  if (result?.error === 'missing-from-email') return 'failed';
  if (result?.error === 'invalid-email-payload') return 'failed';
  if (result?.skipped && result?.dryRun) return 'dry_run';
  if (result?.ok) return 'sent';
  return 'failed';
}

async function sendTransactionalEmailOnce(options = {}) {
  const logicalKey = emailLogsRepo.buildEmailLogicalKey(options.emailType || 'generic', options.logicalEntityId || options.logicalKey || 'unknown');
  const explicitLogicalKey = normalizeString(options.logicalKey) || logicalKey;
  const normalizedTo = emailLogsRepo.normalizeEmailRecipient(options.to);

  const duplicate = emailLogsRepo.findSentEmailByLogicalKey(explicitLogicalKey);
  if (duplicate) {
    emailLogsRepo.recordSkippedDuplicate(explicitLogicalKey, {
      emailType: options.emailType,
      to: normalizedTo || options.to,
      subject: options.subject,
      provider: 'resend',
      metadata: options.metadata,
      orderId: options.orderId,
      customerId: options.customerId,
      userId: options.userId,
      wholesaleRequestId: options.wholesaleRequestId,
    });
    return { ok: true, skipped: true, reason: 'duplicate', status: 'skipped_duplicate', provider: 'resend' };
  }

  if (!normalizedTo) {
    emailLogsRepo.createEmailLog({
      logicalKey: explicitLogicalKey,
      emailType: options.emailType,
      to: options.to,
      subject: options.subject,
      provider: 'resend',
      status: 'invalid_recipient',
      dryRun: true,
      skipped: true,
      errorMessage: 'invalid-recipient',
      metadata: options.metadata,
      orderId: options.orderId,
      customerId: options.customerId,
      userId: options.userId,
      wholesaleRequestId: options.wholesaleRequestId,
    });
    return { ok: false, skipped: true, reason: 'invalid_recipient', status: 'invalid_recipient', provider: 'resend' };
  }

  const pending = emailLogsRepo.createEmailLog({
    logicalKey: explicitLogicalKey,
    emailType: options.emailType,
    to: normalizedTo,
    subject: options.subject,
    provider: 'resend',
    status: 'pending',
    metadata: options.metadata,
    orderId: options.orderId,
    customerId: options.customerId,
    userId: options.userId,
    wholesaleRequestId: options.wholesaleRequestId,
  });

  const result = await sendTransactionalEmail({
    to: normalizedTo,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
    metadata: {
      ...(options.metadata || {}),
      logicalKey: explicitLogicalKey,
      emailType: options.emailType || 'generic',
      idempotencyKey: `email:${explicitLogicalKey}`,
    },
    testMode: options.testMode,
  });

  const status = result?.error === null && result?.skipped && result?.dryRun
    ? 'disabled'
    : extractStatusFromSendResult(result);

  emailLogsRepo.updateEmailLog(pending.id, {
    status,
    providerMessageId: result?.providerMessageId || null,
    dryRun: Boolean(result?.dryRun),
    skipped: Boolean(result?.skipped),
    errorMessage: result?.error || null,
    metadata: {
      ...(options.metadata || {}),
      wasTestMode: Boolean(result?.dryRun),
      attemptedTo: normalizedTo,
    },
  });

  return {
    ...result,
    status,
    logicalKey: explicitLogicalKey,
    idempotencyKey: `email:${explicitLogicalKey}`,
  };
}

const templates = createEmailBuilders();

async function sendOrderReceivedEmail(order = {}, customer = {}, options = {}) {
  const tpl = templates.orderReceived(order, customer);
  return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: order?.id || order?.order_number, emailType: 'order_received', to: customer?.email || order?.customer_email, subject: `Pedido recibido #${formatOrderNumber(order.order_number || order.id)}`, html: tpl.html, text: tpl.text, metadata: { type: 'order_received' }, orderId: order?.id || order?.order_number, ...options });
}
async function sendPaymentApprovedEmail(order = {}, customer = {}, options = {}) { const tpl = templates.paymentApproved(order, customer); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: order?.id || order?.order_number, emailType: 'payment_approved', to: customer?.email || order?.customer_email, subject: `Pago aprobado #${formatOrderNumber(order.order_number || order.id)}`, html: tpl.html, text: tpl.text, metadata: { type: 'payment_approved' }, orderId: order?.id || order?.order_number, ...options }); }
async function sendOrderPreparingEmail(order = {}, customer = {}, options = {}) { const tpl = templates.orderPreparing(order, customer); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: order?.id || order?.order_number, emailType: 'order_preparing', to: customer?.email || order?.customer_email, subject: `Pedido en preparación #${formatOrderNumber(order.order_number || order.id)}`, html: tpl.html, text: tpl.text, metadata: { type: 'order_preparing' }, orderId: order?.id || order?.order_number, ...options }); }
async function sendOrderShippedEmail(order = {}, customer = {}, options = {}) { const tpl = templates.orderShipped(order, customer); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: order?.id || order?.order_number, emailType: 'order_shipped', to: customer?.email || order?.customer_email, subject: `Pedido enviado #${formatOrderNumber(order.order_number || order.id)}`, html: tpl.html, text: tpl.text, metadata: { type: 'order_shipped' }, orderId: order?.id || order?.order_number, ...options }); }
async function sendInvoiceAvailableEmail(order = {}, customer = {}, options = {}) { const tpl = templates.invoiceAvailable(order, customer); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: order?.id || order?.order_number, emailType: 'invoice_available', to: customer?.email || order?.customer_email, subject: `Factura disponible #${formatOrderNumber(order.order_number || order.id)}`, html: tpl.html, text: tpl.text, metadata: { type: 'invoice_available' }, orderId: order?.id || order?.order_number, ...options }); }
async function sendWholesaleRequestReceivedEmail(request = {}, options = {}) { const tpl = templates.wholesaleRequestReceived(request); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: request?.id || request?.email, emailType: 'wholesale_request_received', to: request?.email, subject: 'Solicitud mayorista recibida', html: tpl.html, text: tpl.text, metadata: { type: 'wholesale_received' }, wholesaleRequestId: request?.id || null, ...options }); }
async function sendWholesaleApprovedEmail(request = {}, options = {}) { const tpl = templates.wholesaleApproved(request); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: request?.id || request?.email, emailType: 'wholesale_approved', to: request?.email, subject: 'Cuenta mayorista aprobada', html: tpl.html, text: tpl.text, metadata: { type: 'wholesale_approved' }, wholesaleRequestId: request?.id || null, ...options }); }
async function sendWholesaleRejectedEmail(request = {}, options = {}) { const tpl = templates.wholesaleRejected(request); return sendTransactionalEmailOnce({ logicalKey: options.logicalKey, logicalEntityId: request?.id || request?.email, emailType: 'wholesale_rejected', to: request?.email, subject: 'Actualización de solicitud mayorista', html: tpl.html, text: tpl.text, metadata: { type: 'wholesale_rejected' }, wholesaleRequestId: request?.id || null, ...options }); }
async function sendPasswordResetEmail(user = {}, resetLink = '', options = {}) { const tpl = templates.passwordReset(user, resetLink); return sendTransactionalEmail({ to: user?.email, subject: 'Recuperación de contraseña', html: tpl.html, text: tpl.text, metadata: { type: 'password_reset' }, ...options }); }
async function sendContactFormEmail(data = {}, options = {}) { const tpl = templates.contactForm(data); return sendTransactionalEmail({ to: data?.email, subject: 'Recibimos tu consulta', html: tpl.html, text: tpl.text, metadata: { type: 'contact_form' }, ...options }); }
async function sendAdminSaleNotificationEmail(order = {}, options = {}) {
  const recipients = resolveAdminSalesRecipients();
  if (!recipients.length) {
    return { ok: true, skipped: true, dryRun: true, provider: 'resend', status: 'disabled', reason: 'missing-admin-sales-email' };
  }
  const recipient = recipients[0];
  const orderId = formatOrderNumber(order.order_number || order.id);
  const total = formatCurrencyARS(order.total || order.total_amount || order.amount);
  const tpl = templates.adminSaleNotification(order);
  return sendTransactionalEmailOnce({
    logicalKey: options.logicalKey || `admin_order_received_notification:${orderId}`,
    logicalEntityId: orderId,
    emailType: 'admin_order_received_notification',
    to: recipient,
    subject: `Nuevo pedido recibido en NERIN Parts — Pedido #${orderId} — ${total}`,
    html: tpl.html,
    text: tpl.text,
    orderId,
    metadata: { type: 'admin_order_received_notification', recipientCount: recipients.length, ...(options.metadata || {}) },
    ...options,
  });
}
async function sendAdminSalePaidNotificationEmail(order = {}, options = {}) {
  const recipients = resolveAdminSalesRecipients();
  if (!recipients.length) {
    return { ok: true, skipped: true, dryRun: true, provider: 'resend', status: 'disabled', reason: 'missing-admin-sales-email' };
  }
  const recipient = recipients[0];
  const orderId = formatOrderNumber(order.order_number || order.id);
  const total = formatCurrencyARS(order.total || order.total_amount || order.amount);
  const paidOrder = {
    ...order,
    payment_status: order.payment_status || order.estado_pago || 'approved',
    payment_status_code: order.payment_status_code || 'approved',
  };
  const base = templates.adminSaleNotification(paidOrder);
  const html = base.html
    .replace('Nuevo pedido recibido en NERIN Parts', 'Vendiste en NERIN Parts — Pago aprobado')
    .replace('Se generó un nuevo pedido desde la web.', 'Vendiste a través de la web NERIN Parts.');
  return sendTransactionalEmailOnce({
    logicalKey: options.logicalKey || `admin_sale_paid_notification:${orderId}`,
    logicalEntityId: orderId,
    emailType: 'admin_sale_paid_notification',
    to: recipient,
    subject: `Vendiste en NERIN Parts — Pago aprobado — Pedido #${orderId} — ${total}`,
    html,
    text: base.text,
    orderId,
    metadata: { type: 'admin_sale_paid_notification', recipientCount: recipients.length, ...(options.metadata || {}) },
    ...options,
  });
}

module.exports = {
  escapeHtml,
  formatCurrencyARS,
  formatDate,
  formatPaymentMethod,
  formatPaymentStatus,
  formatOrderStatus,
  formatShippingStatus,
  formatInvoiceStatus,
  formatCustomerName,
  formatOrderNumber,
  getEmailRuntimeConfig,
  sendTransactionalEmail,
  sendTransactionalEmailOnce,
  sendOrderReceivedEmail,
  sendPaymentApprovedEmail,
  sendOrderPreparingEmail,
  sendOrderShippedEmail,
  sendInvoiceAvailableEmail,
  sendWholesaleRequestReceivedEmail,
  sendWholesaleApprovedEmail,
  sendWholesaleRejectedEmail,
  sendPasswordResetEmail,
  sendContactFormEmail,
  sendAdminSaleNotificationEmail,
  sendAdminSalePaidNotificationEmail,
  buildEmailLogicalKey: emailLogsRepo.buildEmailLogicalKey,
  normalizeEmailRecipient: emailLogsRepo.normalizeEmailRecipient,
};
