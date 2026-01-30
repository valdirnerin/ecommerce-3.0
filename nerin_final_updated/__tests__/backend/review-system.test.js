const fs = require("fs");
const os = require("os");
const path = require("path");

describe("review token security", () => {
  test("hashing and compare", () => {
    const { generateSalt, hashToken, verifyToken } = require("../../backend/utils/security");
    const salt = generateSalt();
    const token = "sample-token";
    const hash = hashToken(token, salt);
    expect(hash).toBeTruthy();
    expect(verifyToken(token, salt, hash)).toBe(true);
    expect(verifyToken("wrong", salt, hash)).toBe(false);
  });

  test("single-use enforcement", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nerin-review-"));
    process.env.DATA_DIR = tempDir;
    jest.resetModules();
    const reviewTokensRepo = require("../../backend/data/reviewTokensRepo");
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const { token, record } = await reviewTokensRepo.issueToken({
      scope: "purchase",
      orderId: "order-1",
      recipientEmail: "cliente@nerin.com",
      expiresAt,
    });

    const [first, second] = await Promise.all([
      reviewTokensRepo.consumeToken({ id: record.id, tokenPlain: token }),
      reviewTokensRepo.consumeToken({ id: record.id, tokenPlain: token }),
    ]);

    expect([first.ok, second.ok].filter(Boolean).length).toBe(1);
  });
});

describe("review validation", () => {
  const {
    validatePurchaseReview,
    validateServiceReview,
  } = require("../../backend/utils/reviewValidation");

  test("purchase validation ensures product and email", () => {
    const tokenRecord = { scope: "purchase", recipient_email: "buyer@nerin.com" };
    const order = { customer_email: "buyer@nerin.com" };
    const orderItems = [{ id: "prod-1" }];
    const result = validatePurchaseReview({
      tokenRecord,
      order,
      orderItems,
      email: "buyer@nerin.com",
    });
    expect(result.ok).toBe(true);
    expect(result.productId).toBe("prod-1");
  });

  test("service validation requires closed referral and approved partner", () => {
    const tokenRecord = { scope: "service", recipient_email: "buyer@nerin.com" };
    const referral = { status: "CLOSED", customer_email: "buyer@nerin.com" };
    const partner = { id: "partner-1", status: "APPROVED" };
    const result = validateServiceReview({
      tokenRecord,
      referral,
      partner,
      email: "buyer@nerin.com",
    });
    expect(result.ok).toBe(true);
    expect(result.partnerId).toBe("partner-1");
  });
});
