const path = require('path');
const fs = require('fs');
const express = require('express');
const { chromium, webkit } = require('playwright');

(async () => {
  const app = express();
  const port = process.env.PORT || 3000;
  const root = path.join(__dirname, '..', 'frontend');
  app.use(express.static(root));
  const server = app.listen(port);

  const pages = ['index', 'shop', 'product', 'checkout', 'success', 'failure', 'admin'];
  const viewports = [360, 768, 1024, 1280];
  const devices = [
    { name: 'android-chrome', browserType: chromium, ua: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.0.0 Mobile Safari/537.36' },
    { name: 'ios-safari', browserType: webkit, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' }
  ];

  for (const device of devices) {
    for (const width of viewports) {
      const browser = await device.browserType.launch();
      const context = await browser.newContext({
        userAgent: device.ua,
        viewport: { width, height: 800 },
        deviceScaleFactor: 1
      });

      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(`http://localhost:${port}/`)) return route.continue();
        return route.fulfill({ status: 204, body: '' });
      });
      await context.route('**/api/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });
      await context.route('**/api/products**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await context.route('**/js/admin.js', (route) => {
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      });

      for (const pageName of pages) {
        const page = await context.newPage();
        const url = `http://localhost:${port}/${pageName}.html`;
        page.on('pageerror', (err) => console.error(`${device.name} ${width} ${pageName} pageerror:`, err));
        page.on('console', (msg) => {
          if (
            msg.type() === 'error' &&
            !msg.text().includes('Failed to load resource') &&
            !msg.text().includes('Failed to fetch')
          ) {
            console.error(`${device.name} ${width} ${pageName} console error:`, msg.text());
          }
        });
        try {
          await page.goto(url, { waitUntil: 'networkidle' });
          const dir = path.join(__dirname, '..', 'qa', device.name, String(width));
          await fs.promises.mkdir(dir, { recursive: true });
          const file = path.join(dir, `${pageName}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log('Captured', file);
        } catch (e) {
          console.error(`${device.name} ${width} ${pageName} navigation error:`, e);
        }
        await page.close();
      }
      await context.close();
      await browser.close();
    }
  }

  server.close();
})();
