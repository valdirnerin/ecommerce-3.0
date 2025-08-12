const fs = require('fs');
const path = require('path');
const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);
const merchantClient = new MerchantOrder(mpClient);

function mapStatus(mpStatus) {
  return mpStatus === 'approved'
    ? 'approved'
    : mpStatus === 'rejected'
    ? 'rejected'
    : 'pending';
}

function ordersPath() {
  return path.join(__dirname, '../../data/orders.json');
}

function getOrders() {
  try {
    const file = fs.readFileSync(ordersPath(), 'utf8');
    return JSON.parse(file).orders || [];
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ordersPath(), JSON.stringify({ orders }, null, 2), 'utf8');
}

async function processNotification(topic, id) {
  try {
    let paymentId = null;
    let merchantOrder;
    let preferenceId = null;
    let externalRef = null;
    let status = 'pending';

    if (topic === 'merchant_order') {
      merchantOrder = await merchantClient.get({ id });
      const payments = merchantOrder.payments || [];
      preferenceId = merchantOrder.preference_id || null;
      externalRef = merchantOrder.external_reference || null;
      if (!payments.length) {
        const identifier = preferenceId || externalRef;
        if (identifier) {
          const orders = getOrders();
          const idx = orders.findIndex(
            (o) =>
              o.id === identifier ||
              o.external_reference === identifier ||
              o.order_number === identifier ||
              String(o.preference_id) === String(identifier)
          );
          if (idx !== -1) {
            orders[idx].payment_status = 'pending';
            orders[idx].estado_pago = 'pending';
          } else {
            orders.push({
              id: identifier,
              preference_id: preferenceId,
              payment_status: 'pending',
              estado_pago: 'pending',
            });
          }
          saveOrders(orders);
        }
        console.log(
          `mp-webhook OK paymentId=null externalRef=${externalRef} prefId=${preferenceId} status=pending`
        );
        return;
      }
      paymentId = payments[0].id;
    } else {
      paymentId = id;
    }

    const payment = await paymentClient.get({ id: paymentId });
    status = mapStatus(payment.status);
    externalRef = payment.external_reference || externalRef;

    if (payment.order && payment.order.id) {
      merchantOrder = await merchantClient.get({ id: payment.order.id });
      preferenceId = merchantOrder.preference_id || preferenceId;
      externalRef = externalRef || merchantOrder.external_reference || null;
    }

    const identifier = preferenceId || externalRef;
    if (!identifier) {
      console.error('No se pudieron determinar identificadores del pago');
      return;
    }

    const orders = getOrders();
    const idx = orders.findIndex(
      (o) =>
        o.id === identifier ||
        o.external_reference === identifier ||
        o.order_number === identifier ||
        String(o.preference_id) === String(identifier)
    );

    if (idx !== -1) {
      const row = orders[idx];
      row.payment_id = String(paymentId);
      row.payment_status = status;
      row.estado_pago = status;
      row.preference_id = preferenceId || row.preference_id;
    } else {
      orders.push({
        id: externalRef || preferenceId,
        preference_id: preferenceId,
        payment_status: status,
        estado_pago: status,
        payment_id: String(paymentId),
      });
    }
    saveOrders(orders);

    console.log(
      `mp-webhook OK paymentId=${paymentId} externalRef=${externalRef} prefId=${preferenceId} status=${status}`
    );
  } catch (error) {
    console.error(`Error al procesar webhook: ${error.message}`);
  }
}

module.exports = { processNotification };
