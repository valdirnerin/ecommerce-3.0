const express = require("express");

let sendersPromise;
const loadSenders = async () => {
  if (!sendersPromise) {
    sendersPromise = import("../services/send-email.js");
  }
  return sendersPromise;
};

const router = express.Router();

router.use((req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    return next();
  }

  const providedKey = req.query?.key;
  if (typeof providedKey === "string" && providedKey === process.env.ENV_TEST_KEY) {
    return next();
  }

  return res.status(403).json({ ok: false, error: "Unauthorized" });
});

const buildTestOrder = () => ({
  orderNumber: "DEV-TEST-1001",
  customer: { name: "Juan Pérez" },
  total: 185000,
  items: [
    { name: "Pantalla OLED iPhone 13", quantity: 1, price: 150000 },
    { name: "Pegamento B-7000", quantity: 2, price: 17500 },
  ],
});

const normalizeRecipients = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

router.get("/", async (req, res) => {
  const { to, type } = req.query;
  const recipients = normalizeRecipients(to);

  if (!recipients.length) {
    return res.status(400).json({ ok: false, error: "Missing 'to' query" });
  }

  const { sendOrderConfirmed, sendPaymentPending, sendPaymentRejected } =
    await loadSenders();
  const senderMap = {
    confirmed: sendOrderConfirmed,
    pending: sendPaymentPending,
    rejected: sendPaymentRejected,
  };

  const sender = typeof type === "string" ? senderMap[type] : null;
  if (!sender) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid 'type' query. Use confirmed|pending|rejected." });
  }

  try {
    const order = buildTestOrder();
    await sender({ to: recipients, order });
    return res.json({ ok: true });
  } catch (error) {
    console.error("test-email route failed", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to send test email",
    });
  }
});

module.exports = router;
