const fs = require('fs');
const path = require('path');
const { DATA_DIR: dataDir } = require('../utils/dataDir');

const filePath = path.join(dataDir, 'emailLogs.json');

function nowIso() {
  return new Date().toISOString();
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const logs = Array.isArray(parsed?.logs) ? parsed.logs : [];
    return { logs };
  } catch {
    return { logs: [] };
  }
}

function saveStore(store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function safeString(value, maxLen = 500) {
  if (value == null) return null;
  const out = String(value).trim();
  if (!out) return null;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) continue;
    const lk = String(key).toLowerCase();
    if (lk.includes('token') || lk.includes('secret') || lk.includes('apikey') || lk.includes('api_key')) continue;
    if (typeof value === 'object') continue;
    out[key] = safeString(value, 200);
  }
  return out;
}

function normalizeEmailRecipient(email) {
  const normalized = safeString(email, 320);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(lower) ? lower : null;
}

function buildEmailLogicalKey(type, entityId) {
  const t = safeString(type, 80) || 'generic';
  const id = safeString(entityId, 160) || 'unknown';
  return `${t}:${id}`;
}

function createEmailLog(data = {}) {
  const store = readStore();
  const timestamp = nowIso();
  const record = {
    id: `elog_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    logicalKey: safeString(data.logicalKey, 200),
    emailType: safeString(data.emailType, 80) || 'generic',
    to: normalizeEmailRecipient(data.to) || safeString(data.to, 320),
    subject: safeString(data.subject, 200),
    provider: safeString(data.provider, 40) || 'resend',
    providerMessageId: safeString(data.providerMessageId, 160),
    status: safeString(data.status, 40) || 'pending',
    dryRun: Boolean(data.dryRun),
    skipped: Boolean(data.skipped),
    errorMessage: safeString(data.errorMessage, 500),
    orderId: safeString(data.orderId, 120),
    customerId: safeString(data.customerId, 120),
    userId: safeString(data.userId, 120),
    wholesaleRequestId: safeString(data.wholesaleRequestId, 120),
    metadata: sanitizeMetadata(data.metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.logs.push(record);
  saveStore(store);
  return record;
}

function updateEmailLog(id, patch = {}) {
  const store = readStore();
  const idx = store.logs.findIndex((log) => log.id === id);
  if (idx === -1) return null;
  const current = store.logs[idx];
  const next = {
    ...current,
    status: safeString(patch.status, 40) || current.status,
    providerMessageId: safeString(patch.providerMessageId, 160) || current.providerMessageId,
    errorMessage: safeString(patch.errorMessage, 500) || current.errorMessage,
    dryRun: patch.dryRun !== undefined ? Boolean(patch.dryRun) : current.dryRun,
    skipped: patch.skipped !== undefined ? Boolean(patch.skipped) : current.skipped,
    to: patch.to ? (normalizeEmailRecipient(patch.to) || safeString(patch.to, 320)) : current.to,
    metadata: patch.metadata ? { ...current.metadata, ...sanitizeMetadata(patch.metadata) } : current.metadata,
    updatedAt: nowIso(),
  };
  store.logs[idx] = next;
  saveStore(store);
  return next;
}

function findSentEmailByLogicalKey(logicalKey) {
  const key = safeString(logicalKey, 200);
  if (!key) return null;
  const store = readStore();
  return store.logs.find((log) => log.logicalKey === key && log.status === 'sent') || null;
}

function recordSkippedDuplicate(logicalKey, data = {}) {
  return createEmailLog({ ...data, logicalKey, status: 'skipped_duplicate', skipped: true });
}

module.exports = {
  createEmailLog,
  updateEmailLog,
  findSentEmailByLogicalKey,
  recordSkippedDuplicate,
  normalizeEmailRecipient,
  buildEmailLogicalKey,
  _internal: { readStore, saveStore, sanitizeMetadata },
};
