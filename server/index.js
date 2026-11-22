'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependency). Real environment variables win.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)?\1$/, '$2');
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
    console.log('');
    console.log('  WARNING: ADMIN_PASSWORD is not set in .env');
    console.log(`  Stable fallback password for "${cfg.adminUsername}": ${cfg.adminPassword}`);
    console.log('');
    console.log('  Set a permanent password in your .env file:');
    console.log('    ADMIN_PASSWORD=your-secure-password-here');
    console.log('');
    console.log('  The fallback is derived from SESSION_SECRET and stays');
    console.log('  consistent across restarts as long as SESSION_SECRET is unchanged.');
    console.log('');
  }
});

function shutdown() {
  console.log('Shutting down...');
  server.engine.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
