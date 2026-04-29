#!/usr/bin/env node
const BASE_URL = (process.env.BASE_URL || 'https://nerinparts.com.ar').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_AUTH_EMAIL || 'admin@nerin.com';
const ADMIN_BEARER_TOKEN = process.env.ADMIN_BEARER_TOKEN || Buffer.from(`${ADMIN_EMAIL}:script`).toString('base64');
const RUN_REPAIR = String(process.env.RUN_REPAIR || '').toLowerCase() === 'true';

const adminHeaders = {
  authorization: `Bearer ${ADMIN_BEARER_TOKEN}`,
  'content-type': 'application/json',
};

async function fetchJson(path, options = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, options);
    let body = null;
    try { body = await res.json(); } catch { body = { parseError: true }; }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { networkError: true, message: error?.message || String(error) },
    };
  }
}

function summarize(result) {
  return {
    ok: result.ok,
    status: result.status,
    body: result.body,
  };
}

(async function main() {
  const report = {
    baseUrl: BASE_URL,
    checkedAt: new Date().toISOString(),
    authMode: 'Authorization: Bearer <base64(email:anything)>',
    endpoints: {},
    keyMetrics: {},
    repair: null,
    checks: {},
  };

  const health = await fetchJson('/api/catalog/health');
  const publicityAudit = await fetchJson('/api/catalog/publicity-audit');
  const performance = await fetchJson('/api/catalog/performance-test');
  const publicPage = await fetchJson('/api/products?page=1&pageSize=24');
  const adminPage = await fetchJson('/api/admin/products?page=1&pageSize=100', { headers: adminHeaders });
  const debugGh82 = await fetchJson('/api/catalog/debug-search?search=GH82');
  const debugS25 = await fetchJson('/api/catalog/debug-search?search=s25%20ultra');
  const publicGh82 = await fetchJson('/api/products?page=1&pageSize=24&search=GH82');
  const publicS25 = await fetchJson('/api/products?page=1&pageSize=24&search=s25%20ultra');

  report.endpoints.health = summarize(health);
  report.endpoints.publicityAudit = summarize(publicityAudit);
  report.endpoints.performance = summarize(performance);
  report.endpoints.publicProducts = summarize(publicPage);
  report.endpoints.adminProducts = summarize(adminPage);
  report.endpoints.debugGh82 = summarize(debugGh82);
  report.endpoints.debugS25Ultra = summarize(debugS25);
  report.endpoints.publicGh82 = summarize(publicGh82);
  report.endpoints.publicS25Ultra = summarize(publicS25);

  report.keyMetrics = {
    health: {
      ready: health.body?.ready,
      source: health.body?.source,
      sqliteExists: health.body?.sqliteExists,
      corruptDetected: health.body?.corruptDetected,
      productCount: health.body?.productCount,
      publicProductCount: health.body?.publicProductCount,
    },
    adminTotalItems: adminPage.body?.totalItems,
    adminSource: adminPage.body?.source,
    publicTotalItems: publicPage.body?.totalItems,
    publicSource: publicPage.body?.source,
    rejectedCounts: publicityAudit.body?.rejectedCounts || null,
    gh82: {
      debugDiagnosis: debugGh82.body?.diagnosis,
      debugTotalMatches: debugGh82.body?.totalMatches,
      publicTotalItems: publicGh82.body?.totalItems,
    },
    s25Ultra: {
      debugDiagnosis: debugS25.body?.diagnosis,
      debugTotalMatches: debugS25.body?.totalMatches,
      publicTotalItems: publicS25.body?.totalItems,
    },
  };

  if (RUN_REPAIR) {
    const repair = await fetchJson('/api/admin/catalog/repair-public-flags', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'verify-production-catalog-script' }),
    });
    const postAudit = await fetchJson('/api/catalog/publicity-audit');
    const postPublic = await fetchJson('/api/products?page=1&pageSize=24');
    report.repair = {
      call: summarize(repair),
      postAudit: summarize(postAudit),
      postPublic: summarize(postPublic),
    };
  }

  report.checks = {
    healthReady: health.body?.ready === true,
    healthSourceSqlite: health.body?.source === 'sqlite',
    adminSourceSqlite: adminPage.body?.source === 'sqlite',
    publicSourceSqlite: publicPage.body?.source === 'sqlite',
    adminVsPublicGap: {
      adminTotalItems: adminPage.body?.totalItems,
      publicTotalItems: publicPage.body?.totalItems,
      gap: Number(adminPage.body?.totalItems || 0) - Number(publicPage.body?.totalItems || 0),
    },
  };

  console.log(JSON.stringify(report, null, 2));
})();
