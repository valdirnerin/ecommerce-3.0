(function initStatusBadges(global) {
  const ICONS = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12.5 2.5 2.5 4.5-5"></path></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6"></path><path d="m15 9-6 6"></path></svg>',
    ban: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m6.5 17.5 11-11"></path></svg>',
    truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v8H3z"></path><path d="M14 10h3l3 3v2h-6z"></path><circle cx="7" cy="17" r="1.7"></circle><circle cx="17" cy="17" r="1.7"></circle></svg>',
    package: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 6v12l8 4 8-4V6z"></path><path d="M4 6l8 4 8-4"></path><path d="M12 10v12"></path></svg>',
    receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"></path><path d="M9 8h6"></path><path d="M9 12h6"></path></svg>',
    userCheck: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path><path d="m15.5 11.5 2 2 3-3"></path></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>'
  };

  const STATUS_MAP = {
    payment: {
      pending: { label: 'Pago pendiente', tone: 'warning', icon: 'clock' },
      approved: { label: 'Pago aprobado', tone: 'success', icon: 'check' },
      rejected: { label: 'Pago rechazado', tone: 'danger', icon: 'x' },
      cancelled: { label: 'Pago cancelado', tone: 'neutral', icon: 'ban' }
    },
    order: {
      pending_payment: { label: 'Pendiente de pago', tone: 'warning', icon: 'clock' },
      payment_approved: { label: 'Pago aprobado', tone: 'info', icon: 'check' },
      preparing: { label: 'Preparando', tone: 'info', icon: 'package' },
      ready_to_ship: { label: 'Listo para enviar', tone: 'purple', icon: 'package' },
      shipped: { label: 'Enviado', tone: 'info', icon: 'truck' },
      delivered: { label: 'Entregado', tone: 'success', icon: 'check' },
      cancelled: { label: 'Cancelado', tone: 'neutral', icon: 'ban' },
      refunded: { label: 'Reintegrado', tone: 'neutral', icon: 'refresh' }
    },
    shipment: {
      not_created: { label: 'Envío no creado', tone: 'warning', icon: 'clock' },
      created: { label: 'Envío creado', tone: 'info', icon: 'package' },
      label_generated: { label: 'Etiqueta generada', tone: 'purple', icon: 'receipt' },
      in_transit: { label: 'En camino', tone: 'info', icon: 'truck' },
      delivered: { label: 'Entregado', tone: 'success', icon: 'check' },
      failed: { label: 'Envío fallido', tone: 'danger', icon: 'x' },
      returned: { label: 'Devuelto', tone: 'neutral', icon: 'refresh' }
    },
    invoice: {
      pending: { label: 'Factura pendiente', tone: 'warning', icon: 'clock' },
      available: { label: 'Factura disponible', tone: 'success', icon: 'receipt' }
    },
    wholesale: {
      pending: { label: 'Pendiente de aprobación', tone: 'warning', icon: 'clock' },
      approved: { label: 'Mayorista aprobado', tone: 'success', icon: 'userCheck' },
      rejected: { label: 'Mayorista rechazado', tone: 'danger', icon: 'x' }
    }
  };

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveStatusMeta(status, type) {
    const kind = normalizeKey(type);
    const state = normalizeKey(status);
    const kindMap = STATUS_MAP[kind] || null;
    if (!kindMap) {
      return { label: 'Estado desconocido', tone: 'neutral', icon: 'clock', state, kind };
    }
    const meta = kindMap[state] || null;
    if (meta) return { ...meta, state, kind };
    return {
      label: state ? state.replace(/_/g, ' ') : 'Estado desconocido',
      tone: 'neutral',
      icon: 'clock',
      state,
      kind
    };
  }

  function renderStatusBadge(status, type) {
    const meta = resolveStatusMeta(status, type);
    const iconSvg = ICONS[meta.icon] || ICONS.clock;
    return (
      '<span class="np-status-badge"' +
      ' data-type="' + escapeHtml(meta.kind || '') + '"' +
      ' data-status="' + escapeHtml(meta.state || '') + '"' +
      ' data-tone="' + escapeHtml(meta.tone) + '">' +
      '<span class="np-status-badge__icon">' + iconSvg + '</span>' +
      '<span class="np-status-badge__label">' + escapeHtml(meta.label) + '</span>' +
      '</span>'
    );
  }

  global.NERIN_STATUS_BADGES = {
    renderStatusBadge,
    resolveStatusMeta
  };
})(typeof window !== 'undefined' ? window : globalThis);
