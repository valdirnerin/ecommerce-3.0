function normalizeEmail(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function matchEmail(a, b) {
  const left = normalizeEmail(a);
  const right = normalizeEmail(b);
  if (!left || !right) return false;
  return left === right;
}

function resolveOrderEmail(order = {}) {
  return (
    order.customer_email ||
    order.user_email ||
    order.email ||
    order.customer?.email ||
    order.cliente?.email ||
    ""
  );
}

function validatePurchaseReview({ tokenRecord, order, orderItems = [], email, productId }) {
  if (!tokenRecord || tokenRecord.scope !== "purchase") {
    return { ok: false, error: "scope" };
  }
  if (!order) return { ok: false, error: "order" };
  if (tokenRecord.recipient_email && !matchEmail(tokenRecord.recipient_email, email)) {
    return { ok: false, error: "email" };
  }
  const orderEmail = resolveOrderEmail(order);
  if (orderEmail && !matchEmail(orderEmail, email)) {
    return { ok: false, error: "email" };
  }
  let selectedProduct = productId || null;
  if (selectedProduct) {
    const match = orderItems.some((item) =>
      String(item.id || item.product_id || item.sku) === String(selectedProduct),
    );
    if (!match) return { ok: false, error: "product" };
  } else if (orderItems.length === 1) {
    selectedProduct = String(orderItems[0].id || orderItems[0].product_id || orderItems[0].sku || "");
  }
  return { ok: true, productId: selectedProduct || null };
}

function validateServiceReview({ tokenRecord, referral, partner, email }) {
  if (!tokenRecord || tokenRecord.scope !== "service") {
    return { ok: false, error: "scope" };
  }
  if (!referral) return { ok: false, error: "referral" };
  if (referral.status !== "CLOSED") return { ok: false, error: "referral_status" };
  if (tokenRecord.recipient_email && !matchEmail(tokenRecord.recipient_email, email)) {
    return { ok: false, error: "email" };
  }
  if (referral.customer_email && !matchEmail(referral.customer_email, email)) {
    return { ok: false, error: "email" };
  }
  if (!partner || partner.status !== "APPROVED") {
    return { ok: false, error: "partner" };
  }
  return { ok: true, partnerId: partner.id };
}

module.exports = {
  validatePurchaseReview,
  validateServiceReview,
  normalizeEmail,
};
