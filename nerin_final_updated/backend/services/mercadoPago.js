const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

async function fetchPayment(id) {
  if (!id) throw new Error('payment id requerido');
  const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`payment fetch ${res.status}`);
  return res.json();
}

async function fetchMerchantOrder(id) {
  if (!id) throw new Error('merchant order id requerido');
  const res = await fetchFn(
    `https://api.mercadopago.com/merchant_orders/${id}`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`mo fetch ${res.status}`);
  return res.json();
}

function mapItems(mpItems = []) {
  return mpItems.map((it) => ({
    sku: it.sku || it.id || '',
    name: it.name || it.title || '',
    price: Number(it.price || it.unit_price || 0),
    qty: Number(it.qty || it.quantity || 0),
  }));
}

async function resolveFromWebhook({ topic, id, body = {}, query = {} }) {
  const resource = query.resource || body.resource;
  const info = {
    externalRef: null,
    preferenceId: null,
    paymentId: null,
    merchantOrderId: null,
    status: null,
    items: null,
    email: null,
    source: null,
  };

  try {
    if (resource && /\/v1\/payments\//.test(resource)) {
      id = resource.split('/').pop();
      topic = 'payment';
    } else if (resource && /merchant_orders\//.test(resource)) {
      id = resource.split('/').pop();
      topic = 'merchant_order';
    }

    if (topic === 'payment' || /^[0-9]+$/.test(String(id))) {
      info.paymentId = id;
      const p = await fetchPayment(id);
      info.status = p.status || null;
      info.externalRef = p.external_reference || null;
      info.preferenceId = p.preference_id || null;
      info.merchantOrderId = p.order?.id || null;
      info.items = mapItems(
        p.metadata?.items ||
          p.additional_info?.items ||
          p.items ||
          []
      );
      info.email = p.metadata?.email || p.payer?.email || null;
      if (!info.items?.length && info.merchantOrderId) {
        try {
          const mo = await fetchMerchantOrder(info.merchantOrderId);
          info.items = mapItems(mo.items || []);
          info.source = 'mo';
        } catch {}
      } else {
        info.source = 'metadata';
      }
      return info;
    }

    if (topic === 'merchant_order') {
      info.merchantOrderId = id;
      const mo = await fetchMerchantOrder(id);
      info.preferenceId = mo.preference_id || null;
      info.externalRef = mo.external_reference || null;
      info.items = mapItems(mo.items || []);
      info.source = 'mo';
      const pay = mo.payments?.[0];
      if (pay) {
        info.paymentId = pay.id;
        info.status = pay.status || null;
      }
      if (!info.status && info.paymentId) {
        try {
          const p = await fetchPayment(info.paymentId);
          info.status = p.status || null;
          if (!info.externalRef)
            info.externalRef = p.external_reference || null;
        } catch {}
      }
      return info;
    }
  } catch (e) {
    return info;
  }
  return info;
}

module.exports = { fetchPayment, fetchMerchantOrder, resolveFromWebhook };
