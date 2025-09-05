const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3100;

const server = spawn('node', [path.join(__dirname, '..', 'index.js')], {
  env: { ...process.env, NODE_ENV: 'test', PORT: PORT.toString() },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function shutdown(code) {
  server.kill();
  setTimeout(() => process.exit(code), 100);
}

function check(retries = 10) {
  http
    .get(`http://localhost:${PORT}/css/overrides.css`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`Expected status 200, got ${res.statusCode}`);
          return shutdown(1);
        }
        if (!/\.product-card/.test(data)) {
          console.error('overrides.css missing .product-card rule');
          return shutdown(1);
        }
        console.log('overrides.css served with .product-card rule');
        shutdown(0);
      });
    })
    .on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => check(retries - 1), 500);
      } else {
        console.error('Request failed', err.message);
        shutdown(1);
      }
    });
}

setTimeout(() => check(), 1000);
