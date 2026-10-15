'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function loadConfig(env = process.env, overrides = {}) {
  const port = Number(env.PORT || 8787);
  const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const dataDir = path.resolve(env.DATA_DIR || './data');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  let secret = env.SESSION_SECRET;
  if (!secret) {
    const file = path.join(dataDir, '.session-secret');
    if (fs.existsSync(file)) secret = fs.readFileSync(file, 'utf8').trim();
    else {
      secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }

  let adminPassword = env.ADMIN_PASSWORD;
  let generatedPassword = false;
  if (!adminPassword) {
    adminPassword = crypto.randomBytes(9).toString('base64url');
    generatedPassword = true;
  }

  const adminUsername = (env.ADMIN_USERNAME || 'admin').trim();
  const adminName = (env.ADMIN_NAME || 'Admin').trim();
  const adminEmail = (env.ADMIN_EMAIL || 'admin@setunxt.com').trim();

  const realSiteJwtSecret = (env.REAL_SITE_JWT_SECRET || env.ACCESS_TOKEN_SECRET || '').trim();
  const realSiteAuthUrl = (env.REAL_SITE_AUTH_URL || '').trim();
  const realSiteAdminUserTypeId = Number(env.REAL_SITE_ADMIN_USER_TYPE_ID || 2);

  return {
    port,
    publicBaseUrl,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    siteUrl: env.SITE_URL || 'http://localhost:5500/blog.html',
    siteOrigins: list(env.SITE_ORIGINS),
    imageHosts: list(env.IMAGE_HOSTS || 'images.unsplash.com'),
    maxUploadBytes: Math.round(Number(env.MAX_UPLOAD_MB || 5) * 1024 * 1024),
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: publicBaseUrl.startsWith('https://'),
    secret,
    adminUsername,
    adminName,
    adminEmail,
    adminPassword,
    generatedPassword,
    realSiteJwtSecret,
    realSiteAuthUrl,
    realSiteAdminUserTypeId,
    ...overrides,
  };
}

module.exports = { loadConfig };
