'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { HttpError, readBody, readJson, sendJson, sendBuffer, parseCookies, parseIfMatch } = require('./http');
const { openDb } = require('./db');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { createHub } = require('./hub');
const { createPreviewTokens } = require('./preview-tokens');
const { CATEGORIES, validateDraft } = require('./validate');
const { processImage, hasSharp } = require('./images');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_FILES = {
  '/admin': ['index.html', 'text/html; charset=utf-8'],
  '/admin/': ['index.html', 'text/html; charset=utf-8'],
  '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const MEDIA_RE = /^[a-f0-9]{32}-(?:card|feature|orig)\.(?:webp|jpg|png)$/;
const MEDIA_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

const clampInt = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function createApp(cfg, options = {}) {
  const db = openDb(path.join(cfg.dataDir, 'engine.db'));
  const store = createStore(db);
  const auth = createAuth(cfg, db, options);
  const hub = createHub(store);
  const previewTokens = createPreviewTokens(cfg);
  const siteOrigin = (() => { try { return new URL(cfg.siteUrl).origin; } catch { return ''; } })();
  const ownOrigin = new URL(cfg.publicBaseUrl).origin;

  // ---------- routing table ----------
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    routes.push({ method, re, handler, opts });
  };

  // ---------- helpers ----------
  function corsHeaders(req) {
    const origin = req.headers.origin;
    const base = { 'Access-Control-Expose-Headers': 'ETag', Vary: 'Origin' };
    if (cfg.siteOrigins.length === 0) return { ...base, 'Access-Control-Allow-Origin': '*' };
    if (origin && cfg.siteOrigins.includes(origin)) return { ...base, 'Access-Control-Allow-Origin': origin };
    return base;
  }

  function clientIp(req) {
    if (cfg.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function requireAdmin(req) {
    // 1. Direct Express req.user check if set by your real website's auth middleware (e.g. verifyJWT):
    if (req.user && Number(req.user.userTypeId) === 2) {
      return {
        userId: String(req.user._id || req.user.id || 'admin'),
        username: req.user.userName || req.user.username || 'admin',
        name: req.user.fullName || req.user.name || 'Admin',
        role: 'admin',
        userTypeId: req.user.userTypeId,
        roleId: req.user.roleId,
        source: 'express_req_user',
      };
    }

    const session = auth.read(parseCookies(req.headers.cookie), req.headers);
    if (!session) throw new HttpError(401, 'unauthenticated');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let ok = origin === ownOrigin;
        try { ok = ok || new URL(origin).host === req.headers.host; } catch { ok = false; }
        if (!ok) throw new HttpError(403, 'bad_origin');
      }
      if (!auth.safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) throw new HttpError(403, 'bad_csrf_token');
    }
    return session;
  }

  const adminCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https:",
    "connect-src 'self'",
    `frame-src ${siteOrigin || "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

  // ---------- public API ----------
  const preflight = (req, res) => {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'If-None-Match, Last-Event-ID',
      'Access-Control-Max-Age': '600',
    });
    res.end();
  };
  for (const p of ['/api/v1/posts', '/api/v1/posts/:slug', '/api/v1/stream']) add('OPTIONS', p, ({ req, res }) => preflight(req, res));

  add('GET', '/api/v1/posts', ({ req, res, url }) => {
    const limit = clampInt(url.searchParams.get('limit'), 1, 50, 12);
    const category = url.searchParams.get('category') || undefined;
    if (category && !Object.hasOwn(CATEGORIES, category)) throw new HttpError(400, 'invalid_category');
    const cursor = url.searchParams.get('cursor') || undefined;
    const page = store.listPublic({ limit, cursor, category });
    const body = JSON.stringify({ ...page, seq: store.currentSeq() });
    const etag = `W/"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const headers = { ...corsHeaders(req), ETag: etag, 'Cache-Control': 'public, max-age=10, stale-while-revalidate=60' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });

  add('GET', '/api/v1/posts/:slug', ({ req, res, params }) => {
    const post = store.getPublicBySlug(decodeURIComponent(params.slug));
    if (!post) throw new HttpError(404, 'not_found');
    sendJson(res, 200, post, { ...corsHeaders(req), 'Cache-Control': 'public, max-age=10, stale-while-revalidate=60' });
  });

  add('GET', '/api/v1/stream', ({ req, res, url }) => {
    // Browsers send Last-Event-ID automatically on reconnect; the query param covers the first connect.
    const raw = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId');
    const n = raw === undefined || raw === null || raw === '' ? null : Number.parseInt(raw, 10);
    hub.attach(req, res, corsHeaders(req), Number.isFinite(n) ? n : null);
  });

  // Token-gated draft preview: lets the public site's own blog-live.js render one
  // unpublished post for the person holding the link, without any admin cookie.
  add('OPTIONS', '/api/v1/preview/:id', ({ req, res }) => preflight(req, res));
  add('GET', '/api/v1/preview/:id', ({ req, res, url, params }) => {
    if (!previewTokens.verify(params.id, url.searchParams.get('token'))) throw new HttpError(403, 'invalid_or_expired_token');
    const post = store.getPreview(params.id);
    if (!post) throw new HttpError(404, 'not_found');
    sendJson(res, 200, post, { ...corsHeaders(req), 'Cache-Control': 'no-store' });
  });

  add('GET', '/healthz', ({ res }) => sendJson(res, 200, { ok: true, seq: store.currentSeq(), streams: hub.size() }));

  // ---------- media ----------
  add('GET', '/media/:file', ({ res, params }) => {
    if (!MEDIA_RE.test(params.file)) throw new HttpError(404, 'not_found');
    let buf;
    try { buf = fs.readFileSync(path.join(cfg.uploadsDir, params.file)); } catch { throw new HttpError(404, 'not_found'); }
    sendBuffer(res, 200, buf, {
      'Content-Type': MEDIA_TYPES[params.file.split('.').pop()],
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'",
    });
  });

  // ---------- admin static ----------
  for (const [route, [file, type]] of Object.entries(ADMIN_FILES)) {
    add('GET', route, ({ res }) => {
      let buf;
      try { buf = fs.readFileSync(path.join(ADMIN_DIR, file)); } catch { throw new HttpError(404, 'not_found'); }
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' };
      if (file === 'index.html') headers['Content-Security-Policy'] = adminCsp;
      sendBuffer(res, 200, buf, headers);
    });
  }
  add('GET', '/', ({ res }) => { res.writeHead(302, { Location: '/admin' }); res.end(); });

  // ---------- auth ----------
  add('POST', '/api/v1/auth/login', async ({ req, res }) => {
    const ip = clientIp(req);
    const wait = auth.retryAfter(ip);
    if (wait) throw new HttpError(429, { error: 'too_many_attempts', retryAfter: wait });
    const body = await readJson(req, 4 * 1024);
    const username = body.username || body.userName || body.email || '';
    const user = await auth.verifyCredentials(username, body.password);
    if (!user) {
      auth.recordFailure(ip);
      throw new HttpError(401, { error: 'invalid_credentials', message: 'Invalid username or password.' });
    }
    auth.clearFailures(ip);
    const { token, csrf } = auth.issue(user);
    sendJson(res, 200, { ok: true, csrf, user }, { 'Set-Cookie': auth.setCookie(token) });
  });

  // Single Sign-On (SSO): exchanges your real website's access token for a blog studio session
  add('POST', '/api/v1/auth/sso', async ({ req, res }) => {
    const body = await readJson(req, 4 * 1024);
    const token = body.token || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));
    if (!token) throw new HttpError(400, { error: 'token_required', message: 'Access token is required for SSO.' });
    const user = auth.verifyRealSiteToken(token);
    if (!user) {
      throw new HttpError(403, {
        error: 'invalid_or_unauthorized_token',
        message: 'Invalid access token or user is not an administrator (userTypeId !== 2).',
      });
    }
    const { token: sessionToken, csrf } = auth.issue(user);
    sendJson(res, 200, { ok: true, csrf, user }, { 'Set-Cookie': auth.setCookie(sessionToken) });
  });

  add('GET', '/api/v1/auth/me', ({ req, res }) => {
    const session = auth.read(parseCookies(req.headers.cookie), req.headers);
    sendJson(res, 200, session ? {
      authenticated: true,
      csrf: session.csrf,
      user: {
        id: session.userId,
        username: session.username,
        name: session.name,
        role: session.role,
        userTypeId: session.userTypeId,
      },
    } : { authenticated: false });
  });

  add('POST', '/api/v1/auth/logout', ({ res }) => sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() }));

  // ---------- admin API ----------
  add('GET', '/api/v1/admin/config', ({ res }) => sendJson(res, 200, {
    siteUrl: cfg.siteUrl,
    categories: CATEGORIES,
    maxUploadBytes: cfg.maxUploadBytes,
    imageOptimization: hasSharp(),
  }), { admin: true });

  add('GET', '/api/v1/admin/posts', ({ res, url }) => {
    const status = url.searchParams.get('status') || 'all';
    if (!['all', 'draft', 'published', 'archived'].includes(status)) throw new HttpError(400, 'invalid_status');
    sendJson(res, 200, { items: store.listAdmin(status) });
  }, { admin: true });

  add('GET', '/api/v1/admin/users', ({ res }) => {
    sendJson(res, 200, { users: auth.listUsers() });
  }, { admin: true });

  add('GET', '/api/v1/admin/posts/:id', ({ res, params }) => sendJson(res, 200, store.getAdmin(params.id)), { admin: true });

  add('POST', '/api/v1/admin/posts/:id/preview-token', ({ res, params }) => {
    store.getAdmin(params.id); // 404s if the post doesn't exist
    const token = previewTokens.issue(params.id);
    const sep = cfg.siteUrl.includes('?') ? '&' : '?';
    const url = `${cfg.siteUrl}${sep}preview=${encodeURIComponent(params.id)}&token=${encodeURIComponent(token)}`;
    sendJson(res, 200, { token, url, expiresIn: previewTokens.ttlSeconds });
  }, { admin: true });

  add('POST', '/api/v1/admin/posts', async ({ req, res }) => {
    const content = validateDraft(await readJson(req), cfg);
    sendJson(res, 201, store.createPost(content));
  }, { admin: true });

  add('PATCH', '/api/v1/admin/posts/:id', async ({ req, res, params }) => {
    const expected = parseIfMatch(req);
    const patch = await readJson(req);
    const current = store.getAdmin(params.id).draft;
    const merged = { ...current };
    for (const k of Object.keys(current)) if (Object.hasOwn(patch, k)) merged[k] = patch[k];
    sendJson(res, 200, store.saveDraft(params.id, expected, validateDraft(merged, cfg)));
  }, { admin: true });

  add('POST', '/api/v1/admin/posts/:id/publish', ({ req, res, params }) => {
    const { post, event } = store.publish(params.id, parseIfMatch(req));
    hub.broadcast(event); // after commit, so subscribers never see an event for a rolled-back write
    sendJson(res, 200, post);
  }, { admin: true });

  add('POST', '/api/v1/admin/posts/:id/unpublish', ({ req, res, params }) => {
    const { post, event } = store.unpublish(params.id, parseIfMatch(req));
    hub.broadcast(event);
    sendJson(res, 200, post);
  }, { admin: true });

  add('DELETE', '/api/v1/admin/posts/:id', ({ req, res, params }) => {
    const { post, event } = store.archive(params.id, parseIfMatch(req));
    hub.broadcast(event);
    sendJson(res, 200, post);
  }, { admin: true });

  // Raw image body (Content-Type: image/*) instead of multipart: no parser dependency, and the
  // format is verified from the bytes regardless of what the client claims.
  add('POST', '/api/v1/admin/uploads', async ({ req, res }) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      throw new HttpError(415, { error: 'unsupported_image', message: 'Upload a JPEG, PNG or WebP image.' });
    }
    const buf = await readBody(req, cfg.maxUploadBytes);
    if (!buf.length) throw new HttpError(400, 'empty_upload');
    const out = await processImage(buf, cfg.uploadsDir);
    sendJson(res, 201, {
      imageUrl: cfg.publicBaseUrl + out.card,
      featureUrl: cfg.publicBaseUrl + out.feature,
      optimized: out.optimized,
      bytes: buf.length,
    });
  }, { admin: true });

  // ---------- dispatcher ----------
  async function handle(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      if (r.opts.admin) requireAdmin(req);
      return r.handler({ req, res, url, params: m.groups || {} });
    }

    // If mounted in Express and this URL does not belong to blog engine, pass to next middleware!
    if (typeof next === 'function') {
      return next();
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) {
        const headers = err.status === 429 ? { 'Retry-After': String(err.body.retryAfter || 60) } : {};
        return sendJson(res, err.status, err.body, headers);
      }
      console.error('Unhandled error:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  server.engine = {
    cfg, store, hub, db, handle,
    close() {
      hub.close();
      return new Promise((resolve) => { server.close(() => { db.close(); resolve(); }); server.closeAllConnections?.(); });
    },
  };
  return server;
}

function createBlogMiddleware(options = {}) {
  const { loadConfig } = require('./config');
  const cfg = loadConfig(process.env, options.config || {});
  const app = createApp(cfg, options);

  const middleware = async (req, res, next) => {
    try {
      await app.engine.handle(req, res, next);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        const headers = err.status === 429 ? { 'Retry-After': String(err.body.retryAfter || 60) } : {};
        return sendJson(res, err.status, err.body, headers);
      }
      if (typeof next === 'function') return next(err);
      console.error('Blog engine error:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
  };

  middleware.engine = app.engine;
  return middleware;
}

module.exports = { createApp, createBlogMiddleware };
