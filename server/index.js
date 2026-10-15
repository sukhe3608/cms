'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependency). Real environment variables win.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv(path.join(process.cwd(), '.env'));

const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { hasSharp } = require('./images');

const cfg = loadConfig();
const server = createApp(cfg);

server.listen(cfg.port, () => {
  console.log(`Blog engine listening on ${cfg.publicBaseUrl}`);
  console.log(`  Admin:      ${cfg.publicBaseUrl}/admin`);
  console.log(`  Public API: ${cfg.publicBaseUrl}/api/v1/posts`);
  console.log(`  Images:     ${hasSharp() ? 'optimized with sharp (WebP, EXIF stripped)' : 'stored as uploaded (install sharp for resizing and metadata stripping)'}`);
  console.log(`  Admin User: ${cfg.adminUsername} (${cfg.adminEmail})`);
  if (cfg.generatedPassword) {
    console.log(`\n  No ADMIN_PASSWORD set. Generated credentials for ${cfg.adminUsername}: ${cfg.adminPassword}\n`);
  }
});

function shutdown() {
  console.log('Shutting down...');
  server.engine.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
