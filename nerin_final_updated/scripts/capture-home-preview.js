const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const PREVIEW_DIR = path.join(ROOT, 'preview');
const DEFAULT_PORT = 10000;
const HOST = '127.0.0.1';

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

function startStaticServer(port) {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const normalized = requestPath === '/' ? '/index.html' : requestPath;
    const filePath = path.normalize(path.join(FRONTEND_DIR, normalized));

    if (!filePath.startsWith(FRONTEND_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

async function run() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  let port = DEFAULT_PORT;
  let server = null;
  try {
    server = await startStaticServer(port);
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      port = 10001;
      server = await startStaticServer(port);
    } else {
      throw error;
    }
  }
  const homeUrl = `http://${HOST}:${port}/index.html`;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const desktop = await browser.newPage();
    await desktop.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await desktop.goto(homeUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await desktop.screenshot({
      path: path.join(PREVIEW_DIR, 'home-desktop.png'),
      fullPage: true,
      type: 'png',
    });
    await desktop.close();

    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 1200, isMobile: true, deviceScaleFactor: 2 });
    await mobile.goto(homeUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await mobile.screenshot({
      path: path.join(PREVIEW_DIR, 'home-mobile.png'),
      fullPage: true,
      type: 'png',
    });
    await mobile.close();

    console.log(`Preview generated:\n- ${path.join('preview', 'home-desktop.png')}\n- ${path.join('preview', 'home-mobile.png')}\nURL: ${homeUrl}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error('preview:home failed', error);
  process.exitCode = 1;
});
