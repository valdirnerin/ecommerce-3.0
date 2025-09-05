#!/usr/bin/env node
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));
const PORT = process.env.PORT || 3000;
const base = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const target = `${base}/api/webhooks/mp`;
const secret = process.env.MP_WEBHOOK_SECRET || '';
const hasRealSecret = secret && secret !== 'dummy';
const insecure = process.env.MP_PROBE_INSECURE === '1';
const sshHost = process.env.MP_PROBE_SSH || '';

async function main() {
  const bodyObj = { type: 'test', id: Date.now() };
  const body = JSON.stringify(bodyObj);
  let signature = '';
  if (hasRealSecret) {
    signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (signature) headers['x-signature'] = signature;

  if (sshHost) {
    const cmd = [
      'curl',
      '-s',
      '-w', '\nHTTP_STATUS:%{http_code}',
      '-X', 'POST', target,
      '-H', 'Content-Type: application/json',
      ...(signature ? ['-H', `x-signature: ${signature}`] : []),
      '-d', `'${body.replace(/'/g, "'\\''")}'`
    ];
    const res = spawnSync('ssh', [sshHost, cmd.join(' ')], { encoding: 'utf8' });
    if (res.error) {
      console.error('Webhook probe ssh failed', res.error.message);
      process.exit(1);
    }
    const out = res.stdout || '';
    const err = res.stderr || '';
    if (err.trim()) console.error('ssh stderr:', err.trim());
    const match = out.match(/HTTP_STATUS:(\d+)/);
    const status = match ? Number(match[1]) : 0;
    console.log(out.replace(/\n?HTTP_STATUS:\d+/, '').trim());
    console.log('Webhook response status:', status);
    console.log(
      'signature_valid=',
      hasRealSecret ? 'true' : 'false',
      'reason=',
      hasRealSecret ? 'sent' : secret ? 'placeholder' : 'missing',
    );
    if (status >= 200 && status < 300) {
      console.log('OK');
      return;
    }
    console.error('Webhook probe failed', 'HTTP', status);
    process.exit(1);
  }

  try {
    const opts = { method: 'POST', headers, body };
    if (insecure) {
      opts.agent = new https.Agent({ rejectUnauthorized: false });
    }
    const res = await fetchFn(target, opts);
    console.log('Webhook response status:', res.status);
    const text = await res.text().catch(() => '');
    if (text) console.log('Body:', text);
    console.log(
      'signature_valid=',
      hasRealSecret ? 'true' : 'false',
      'reason=',
      hasRealSecret ? 'sent' : secret ? 'placeholder' : 'missing',
    );
    if (!res.ok) process.exit(1);
    console.log('OK');
  } catch (e) {
    console.log(
      'signature_valid=',
      hasRealSecret ? 'true' : 'false',
      'reason=',
      hasRealSecret ? 'sent' : secret ? 'placeholder' : 'missing',
    );
    const cause = (e && (e.cause?.code || e.cause?.errno)) || e.code || '';
    console.error('Webhook probe failed', e.message, cause);
    process.exit(1);
  }
}
main();
