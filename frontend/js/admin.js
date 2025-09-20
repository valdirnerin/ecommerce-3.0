(() => {
  const currentScript = document.currentScript;
  const buildId =
    (currentScript && currentScript.dataset && currentScript.dataset.build) ||
    (typeof window !== 'undefined' && window.__ADMIN_BUILD__) ||
    'dev';
  console.info('admin-js-version', buildId);

  const ARG_TIMEZONE = 'America/Argentina/Buenos_Aires';
  const SEARCH_DEBOUNCE = 250;

  const PAYMENT_STATUS_MAP = {
    pagado: 'approved',
    pago: 'approved',
    pagada: 'approved',
    approved: 'approved',
    paid: 'approved',
    acreditado: 'approved',
    accredited: 'approved',
    pendiente: 'pending',
    pending: 'pending',
    pending_payment: 'pending',
    'in process': 'pending',
    'in_process': 'pending',
    proceso: 'pending',
    rechazado: 'rejected',
    rechazada: 'rejected',
    rejected: 'rejected',
    cancelado: 'rejected',
    cancelada: 'rejected',
    cancelled: 'rejected',
    canceled: 'rejected',
    refunded: 'rejected',
  };

  const PAYMENT_LABELS = {
    approved: { label: 'Pagado', badge: 'is-paid' },
    pending: { label: 'Pendiente', badge: 'is-pending' },
    rejected: { label: 'Rechazado / Cancelado', badge: 'is-rejected' },
  };

  const SHIPPING_STATUS_MAP = {
    pendiente: 'preparing',
    pending: 'preparing',
    preparando: 'preparing',
    'en preparación': 'preparing',
    'en preparacion': 'preparing',
    preparacion: 'preparing',
    preparando_envio: 'preparing',
    preparing: 'preparing',
    listo: 'preparing',
    ready: 'preparing',
    enviado: 'shipped',
    envio: 'shipped',
    shipment: 'shipped',
    shipped: 'shipped',
    despachado: 'shipped',
    entregado: 'delivered',
    entregada: 'delivered',
    delivered: 'delivered',
    finalizado: 'delivered',
    completado: 'delivered',
    cancelado: 'cancelled',
    cancelada: 'cancelled',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  };

  const SHIPPING_LABELS = {
    preparing: { label: 'En preparación', badge: 'is-pending' },
    shipped: { label: 'Enviado', badge: 'is-shipped' },
    delivered: { label: 'Entregado', badge: 'is-delivered' },
    cancelled: { label: 'Cancelado', badge: 'is-cancelled' },
  };

  const elements = {};
  const state = {
    date: '',
    status: '',
    q: '',
    orders: [],
    summary: null,
    selectedId: null,
    selected: null,
  };

  let searchTimer = null;

  function resolveApi(path) {
    const base =
      (typeof window !== 'undefined' && window.API_BASE_URL) || '';
    if (!base) return path;
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${normalizedBase}${path}`;
  }

  function isAbsoluteUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function formatCurrency(value) {
    const number = Number(value ?? 0);
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(number);
  }

  function formatArgentinaDateInput(date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: ARG_TIMEZONE,
    });
    return formatter.format(date instanceof Date ? date : new Date(date));
  }

  function formatDateForQuery(inputValue) {
    if (!inputValue) return '';
    const [year, month, day] = String(inputValue).split('-');
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
  }

  function normalizePaymentStatus(raw) {
    if (raw == null) return 'pending';
    const key = String(raw).trim().toLowerCase();
    return PAYMENT_STATUS_MAP[key] ||
      (key === 'approved' || key === 'pending' || key === 'rejected'
        ? key
        : 'pending');
  }

  function normalizeShippingStatus(raw) {
    if (raw == null) return 'preparing';
    const key = String(raw).trim().toLowerCase();
    return SHIPPING_STATUS_MAP[key] ||
      (key === 'preparing' ||
      key === 'shipped' ||
      key === 'delivered' ||
      key === 'cancelled'
        ? key
        : 'preparing');
  }

  function formatDateTime(value) {
    if (!value && value !== 0) return '—';
    let date;
    if (typeof value === 'string' && value.includes('T')) {
      date = new Date(value);
    } else if (typeof value === 'string' && value.includes('-')) {
      date = new Date(`${value}T00:00:00`);
    } else {
      date = new Date(value);
    }
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-AR', {
      timeZone: ARG_TIMEZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  function getOrderIdentifier(order) {
    if (!order || typeof order !== 'object') return null;
    if (order.id != null && order.id !== '') return String(order.id);
    if (order.order_number) return String(order.order_number);
    if (order.preference_id) return String(order.preference_id);
    if (order.external_reference) return String(order.external_reference);
    return null;
  }

  function getOrderCustomer(order) {
    const customer = order.customer || order.cliente || {};
    const name =
      customer.name ||
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      order.customer_name ||
      order.client_name ||
      '';
    return {
      name: name || '—',
      email: customer.email || order.customer_email || order.user_email || '—',
      phone:
        customer.phone ||
        customer.telefono ||
        order.customer_phone ||
        order.phone ||
        '—',
    };
  }

  function formatAddress(order) {
    const shipping =
      (order.shipping_address && typeof order.shipping_address === 'object'
        ? order.shipping_address
        : {}) || {};
    const rawShippingAddress =
      typeof order.shipping_address === 'string' ? order.shipping_address : '';
    const envio = order.envio || {};
    const cliente = order.customer || order.cliente || {};
    const direccionCliente = cliente.direccion || {};
    const parts = [];
    const street =
      shipping.street ||
      rawShippingAddress ||
      envio.calle ||
      direccionCliente.calle ||
      order.shipping_street ||
      order.address ||
      '';
    const number =
      shipping.number ||
      envio.numero ||
      direccionCliente.numero ||
      order.shipping_number ||
      '';
    const streetLine = [street, number].filter(Boolean).join(' ').trim();
    if (streetLine) parts.push(streetLine);
    const city =
      shipping.city ||
      order.shipping_city ||
      envio.localidad ||
      direccionCliente.localidad ||
      cliente.localidad ||
      '';
    const province =
      shipping.province ||
      order.shipping_province ||
      envio.provincia ||
      direccionCliente.provincia ||
      cliente.provincia ||
      '';
    const cityLine = [city, province].filter(Boolean).join(', ').trim();
    if (cityLine) parts.push(cityLine);
    const zip =
      shipping.zip ||
      order.shipping_zip ||
      envio.cp ||
      direccionCliente.cp ||
      cliente.cp ||
      '';
    if (zip) {
      parts.push(`CP ${zip}`);
    }
    return parts.join(' · ') || '—';
  }

  function getOrderItems(order) {
    if (Array.isArray(order.items) && order.items.length) return order.items;
    if (Array.isArray(order.productos) && order.productos.length) {
      return order.productos.map((item) => ({
        title: item.title || item.titulo || item.descripcion || item.name || '',
        name: item.name || item.titulo || item.descripcion || '',
        quantity: item.quantity || item.qty || item.cantidad || item.cant || 0,
        unit_price: item.unit_price || item.price || item.precio || 0,
      }));
    }
    return [];
  }

  function computeSummary() {
    if (state.summary) return state.summary;
    const summary = { total: 0, paid: 0, pending: 0, canceled: 0 };
    state.orders.forEach((order) => {
      const status = normalizePaymentStatus(order.payment_status || order.status);
      summary.total += 1;
      if (status === 'approved') summary.paid += 1;
      else if (status === 'rejected') summary.canceled += 1;
      else summary.pending += 1;
    });
    return summary;
  }

  function setFetchStatus(message, isError = false) {
    if (!elements.fetchStatus) return;
    elements.fetchStatus.textContent = message || '';
    elements.fetchStatus.style.color = isError ? '#dc2626' : 'var(--text-muted)';
  }

  function setSaveStatus(message, isError = false) {
    if (!elements.saveStatus) return;
    elements.saveStatus.textContent = message || '';
    elements.saveStatus.style.color = isError ? '#dc2626' : 'var(--text-muted)';
  }

  function renderSummary() {
    if (!elements.summary) return;
    const summary = computeSummary();
    elements.summary.innerHTML = '';
    const cards = [
      { label: 'Total pedidos', value: summary.total },
      { label: 'Pagados', value: summary.paid },
      { label: 'Pendientes', value: summary.pending },
      { label: 'Rechazados / Cancelados', value: summary.canceled },
    ];
    cards.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'summary-card';
      const strong = document.createElement('strong');
      strong.textContent = card.value;
      const span = document.createElement('span');
      span.className = 'status-text';
      span.textContent = card.label;
      div.appendChild(strong);
      div.appendChild(span);
      elements.summary.appendChild(div);
    });
  }

  function createBadge(code, labels) {
    const info = labels[code];
    const span = document.createElement('span');
    span.className = `badge ${info ? info.badge : ''}`.trim();
    span.textContent = info ? info.label : code;
    return span;
  }

  function renderOrders() {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = '';
    if (!state.orders.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'empty-state';
      cell.textContent = 'No hay pedidos para los filtros seleccionados.';
      row.appendChild(cell);
      elements.tableBody.appendChild(row);
      return;
    }
    state.orders.forEach((order) => {
      const row = document.createElement('tr');
      const id = getOrderIdentifier(order);
      if (state.selectedId && id && state.selectedId === id) {
        row.classList.add('is-selected');
      }
      if (id) row.dataset.orderId = id;

      const paymentCode = normalizePaymentStatus(order.payment_status || order.status);
      const shippingCode = normalizeShippingStatus(
        order.shipping_status || order.envio_estado,
      );

      const cells = [
        order.order_number || order.numero_orden || order.id || '—',
        formatDateTime(order.created_at || order.order_date || order.date),
        getOrderCustomer(order).name,
        formatCurrency(
          (order.totals && (order.totals.total || order.totals.grand_total)) ||
            order.total_amount ||
            order.total ||
            0,
        ),
      ];
      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      const paymentCell = document.createElement('td');
      paymentCell.appendChild(createBadge(paymentCode, PAYMENT_LABELS));
      row.appendChild(paymentCell);

      const shippingCell = document.createElement('td');
      shippingCell.appendChild(createBadge(shippingCode, SHIPPING_LABELS));
      row.appendChild(shippingCell);

      elements.tableBody.appendChild(row);
    });
  }

  function renderOrderDetail() {
    if (!elements.detail) return;
    if (!state.selected) {
      elements.detail.classList.add('hidden');
      setSaveStatus('Seleccioná un pedido para editar.');
      return;
    }
    elements.detail.classList.remove('hidden');
    setSaveStatus('');

    const detail = state.selected;
    const customer = getOrderCustomer(detail);
    const paymentCode = normalizePaymentStatus(detail.payment_status || detail.status);
    const shippingCode = normalizeShippingStatus(
      detail.shipping_status || detail.envio_estado,
    );
    const items = getOrderItems(detail);

    if (elements.detailNumber) {
      elements.detailNumber.textContent =
        detail.order_number || detail.numero_orden || detail.id || '—';
    }
    if (elements.detailCreatedAt) {
      elements.detailCreatedAt.textContent = formatDateTime(
        detail.created_at || detail.order_date || detail.date,
      );
    }
    if (elements.detailTotal) {
      elements.detailTotal.textContent = formatCurrency(
        (detail.totals && (detail.totals.total || detail.totals.grand_total)) ||
          detail.total_amount ||
          detail.total ||
          0,
      );
    }
    if (elements.detailCustomerName) {
      elements.detailCustomerName.textContent = customer.name || '—';
    }
    if (elements.detailCustomerEmail) {
      elements.detailCustomerEmail.textContent = customer.email || '—';
    }
    if (elements.detailCustomerPhone) {
      elements.detailCustomerPhone.textContent = customer.phone || '—';
    }
    if (elements.detailShippingAddress) {
      elements.detailShippingAddress.textContent = formatAddress(detail);
    }
    const rawShippingInfo = detail.shipping || detail.shipping_info || {};
    const rawEnvioInfo = detail.envio || {};
    if (elements.detailShippingMethod) {
      const method =
        detail.shipping_method ||
        rawShippingInfo.method ||
        rawEnvioInfo.metodo ||
        rawEnvioInfo.metodo_envio ||
        rawEnvioInfo.envio ||
        '';
      elements.detailShippingMethod.textContent = method || '—';
    }
    if (elements.detailItems) {
      elements.detailItems.innerHTML = '';
      if (items.length) {
        items.forEach((item) => {
          const li = document.createElement('li');
          const qty = Number(item.quantity ?? item.qty ?? 0);
          const price = Number(item.unit_price ?? item.price ?? 0);
          li.textContent = `${item.title || item.name || 'Producto'} × ${qty} — ${formatCurrency(
            qty * price || price,
          )}`;
          elements.detailItems.appendChild(li);
        });
      } else if (detail.items_summary) {
        const li = document.createElement('li');
        li.textContent = detail.items_summary;
        elements.detailItems.appendChild(li);
      } else {
        const li = document.createElement('li');
        li.textContent = 'Sin ítems disponibles.';
        elements.detailItems.appendChild(li);
      }
    }

    if (elements.paymentSelect) {
      const value = paymentCode;
      elements.paymentSelect.value =
        value === 'approved' || value === 'pending' || value === 'rejected'
          ? value
          : 'pending';
    }
    if (elements.shippingSelect) {
      const value = shippingCode;
      elements.shippingSelect.value =
        value === 'preparing' || value === 'shipped' || value === 'delivered' || value === 'cancelled'
          ? value
          : 'preparing';
    }
    if (elements.trackingInput) {
      elements.trackingInput.value =
        detail.tracking ||
        detail.tracking_number ||
        detail.shipping_tracking ||
        rawShippingInfo.tracking ||
        rawEnvioInfo.tracking ||
        '';
    }
    if (elements.carrierInput) {
      elements.carrierInput.value =
        detail.carrier || rawShippingInfo.carrier || rawEnvioInfo.carrier || '';
    }
    if (elements.shippingNoteInput) {
      elements.shippingNoteInput.value =
        detail.shipping_note ||
        detail.shipping_notes ||
        detail.shipping_note_text ||
        rawShippingInfo.note ||
        rawShippingInfo.notes ||
        rawEnvioInfo.nota ||
        rawEnvioInfo.notas ||
        '';
    }
  }

  function hydrateSelection() {
    if (!state.selectedId) {
      state.selected = null;
      return;
    }
    const found = state.orders.find(
      (order) => getOrderIdentifier(order) === state.selectedId,
    );
    state.selected = found || null;
    if (!found) {
      state.selectedId = null;
    }
  }

  async function loadOrders() {
    const params = new URLSearchParams();
    if (state.date) {
      params.set('date', formatDateForQuery(state.date));
    }
    if (state.status) {
      params.set('status', state.status);
    }
    if (state.q) {
      params.set('q', state.q);
    }
    const query = params.toString();
    const url = resolveApi(`/api/orders${query ? `?${query}` : ''}`);
    try {
      setFetchStatus('Cargando pedidos...');
      const response = await fetch(url, {
        mode: isAbsoluteUrl(url) ? 'cors' : 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.orders)
        ? data.orders
        : [];
      state.orders = items;
      state.summary = data.summary || null;
      hydrateSelection();
      renderSummary();
      renderOrders();
      renderOrderDetail();
      if (!items.length) {
        setFetchStatus('No hay pedidos para los filtros seleccionados.');
      } else {
        setFetchStatus(`Pedidos cargados (${items.length}).`);
      }
    } catch (error) {
      console.error('Error al cargar pedidos', error);
      state.orders = [];
      state.summary = null;
      state.selectedId = null;
      state.selected = null;
      renderSummary();
      renderOrders();
      renderOrderDetail();
      setFetchStatus('No se pudieron cargar los pedidos. Reintentá más tarde.', true);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!state.selected) return;
    const identifier = state.selectedId || getOrderIdentifier(state.selected);
    if (!identifier) {
      setSaveStatus('No se encontró un identificador para la orden.', true);
      return;
    }
    const payload = {
      payment_status: elements.paymentSelect ? elements.paymentSelect.value : undefined,
      shipping_status: elements.shippingSelect ? elements.shippingSelect.value : undefined,
      tracking: elements.trackingInput ? elements.trackingInput.value.trim() : undefined,
      carrier: elements.carrierInput ? elements.carrierInput.value.trim() : undefined,
      shipping_note: elements.shippingNoteInput
        ? elements.shippingNoteInput.value.trim()
        : undefined,
    };
    if (payload.tracking === '') payload.tracking = null;
    if (payload.carrier === '') payload.carrier = null;
    if (payload.shipping_note === '') payload.shipping_note = null;

    const url = resolveApi(`/api/orders/${encodeURIComponent(identifier)}`);
    try {
      setSaveStatus('Guardando cambios...');
      if (elements.saveBtn) elements.saveBtn.disabled = true;
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: isAbsoluteUrl(url) ? 'cors' : 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || !data.order) {
        throw new Error('Respuesta inválida');
      }
      const updated = data.order;
      const updatedId = getOrderIdentifier(updated) || identifier;
      state.orders = state.orders.map((order) =>
        getOrderIdentifier(order) === updatedId ? updated : order,
      );
      state.summary = data.summary || state.summary;
      state.selectedId = updatedId;
      state.selected = updated;
      renderSummary();
      renderOrders();
      renderOrderDetail();
      setSaveStatus('Cambios guardados correctamente.');
      setFetchStatus('Pedido actualizado correctamente.');
    } catch (error) {
      console.error('Error al guardar pedido', error);
      setSaveStatus('No se pudieron guardar los cambios.', true);
    } finally {
      if (elements.saveBtn) elements.saveBtn.disabled = false;
    }
  }

  function handleRowClick(event) {
    const row = event.target.closest('tr[data-order-id]');
    if (!row) return;
    const id = row.dataset.orderId;
    if (!id) return;
    if (state.selectedId === id) {
      return;
    }
    state.selectedId = id;
    hydrateSelection();
    renderOrders();
    renderOrderDetail();
  }

  function init() {
    elements.fetchStatus = document.getElementById('ordersFetchStatus');
    elements.date = document.getElementById('ordersDate');
    elements.status = document.getElementById('ordersStatus');
    elements.search = document.getElementById('ordersSearch');
    elements.refreshBtn = document.getElementById('ordersRefreshBtn');
    elements.summary = document.getElementById('ordersSummary');
    elements.tableBody = document.getElementById('ordersTableBody');
    elements.detail = document.getElementById('orderDetail');
    elements.detailNumber = document.getElementById('detailOrderNumber');
    elements.detailCreatedAt = document.getElementById('detailCreatedAt');
    elements.detailTotal = document.getElementById('detailTotal');
    elements.detailCustomerName = document.getElementById('detailCustomerName');
    elements.detailCustomerEmail = document.getElementById('detailCustomerEmail');
    elements.detailCustomerPhone = document.getElementById('detailCustomerPhone');
    elements.detailShippingAddress = document.getElementById('detailShippingAddress');
    elements.detailShippingMethod = document.getElementById('detailShippingMethod');
    elements.detailItems = document.getElementById('detailItemsList');
    elements.form = document.getElementById('orderEditForm');
    elements.paymentSelect = document.getElementById('orderPaymentStatus');
    elements.shippingSelect = document.getElementById('orderShippingStatus');
    elements.trackingInput = document.getElementById('orderTracking');
    elements.carrierInput = document.getElementById('orderCarrier');
    elements.shippingNoteInput = document.getElementById('orderShippingNote');
    elements.saveBtn = document.getElementById('orderSaveBtn');
    elements.saveStatus = document.getElementById('orderSaveStatus');

    if (elements.date) {
      const today = formatArgentinaDateInput(new Date());
      state.date = elements.date.value || today;
      elements.date.value = state.date;
      elements.date.addEventListener('change', () => {
        state.date = elements.date.value;
        loadOrders();
      });
    }
    if (!state.date) {
      state.date = formatArgentinaDateInput(new Date());
      if (elements.date) elements.date.value = state.date;
    }

    if (elements.status) {
      elements.status.addEventListener('change', () => {
        state.status = elements.status.value;
        loadOrders();
      });
    }

    if (elements.search) {
      elements.search.addEventListener('input', () => {
        const value = elements.search.value.trim();
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.q = value;
          loadOrders();
        }, SEARCH_DEBOUNCE);
      });
    }

    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', () => {
        loadOrders();
      });
    }

    if (elements.tableBody) {
      elements.tableBody.addEventListener('click', handleRowClick);
    }

    if (elements.form) {
      elements.form.addEventListener('submit', handleSave);
    }

    loadOrders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
