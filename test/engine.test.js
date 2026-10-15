'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');

const { loadConfig } = require('../server/config');
const { createApp } = require('../server/app');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server, base, csrf, cookie;

function makeJwt(payload, secret = 'test-real-site-secret') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function call(method, url, { body, headers = {}, auth = true, raw } = {}) {
  const h = { ...headers };
  if (auth && cookie) { h.Cookie = cookie; if (method !== 'GET') h['X-CSRF-Token'] = csrf; }
  let payload = raw;
  if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, headers: res.headers };
}

const good = (over = {}) => ({
  title: 'Testing the engine',
  description: 'A description that is long enough to publish.',
  category: 'dev',
  author: 'Test Author',
  imageUrl: 'https://images.unsplash.com/photo-1?w=500&h=300&fit=crop',
  imageAlt: 'alt',
  ...over,
});

before(async () => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-engine-'));
  const cfg = loadConfig({
    PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: 'correct horse', SESSION_SECRET: 'x'.repeat(32),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, SITE_URL: 'http://127.0.0.1:5500/blog.html',
    REAL_SITE_JWT_SECRET: 'test-real-site-secret',
  });
  server = createApp(cfg);
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});

after(async () => { await server.engine.close(); });

test('admin routes require a session', async () => {
  const r = await call('GET', '/api/v1/admin/posts', { auth: false });
  assert.equal(r.status, 401);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await call('POST', '/api/v1/auth/login', { body: { password: 'nope' }, auth: false });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/v1/auth/login', { body: { password: 'correct horse' }, auth: false });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  csrf = ok.data.csrf;
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/);
});

test('login supports database username and email credentials', async () => {
  const badUser = await call('POST', '/api/v1/auth/login', { body: { username: 'wronguser', password: 'correct horse' }, auth: false });
  assert.equal(badUser.status, 401);

  const byUsername = await call('POST', '/api/v1/auth/login', { body: { username: 'admin', password: 'correct horse' }, auth: false });
  assert.equal(byUsername.status, 200);
  assert.equal(byUsername.data.user.username, 'admin');
  assert.equal(byUsername.data.user.role, 'admin');

  const byEmail = await call('POST', '/api/v1/auth/login', { body: { email: 'admin@setunxt.com', password: 'correct horse' }, auth: false });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.data.user.email, 'admin@setunxt.com');

  const me = await call('GET', '/api/v1/auth/me', { headers: { Cookie: byUsername.headers.get('set-cookie').split(';')[0] }, auth: false });
  assert.equal(me.status, 200);
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.user.username, 'admin');

  const users = await call('GET', '/api/v1/admin/users', { headers: { Cookie: byUsername.headers.get('set-cookie').split(';')[0] } });
  assert.equal(users.status, 200);
  assert.equal(users.data.users.length, 1);
  assert.equal(users.data.users[0].username, 'admin');
  assert.equal(users.data.users[0].password_hash, undefined); // ensures no hash leak
});

test('SSO verifies real-site JWT: allows userTypeId 2 (admin) and rejects other roles', async () => {
  // 1. Valid real-site admin token
  const adminToken = makeJwt({
    _id: 'mongo-id-123',
    email: 'admin@realsite.com',
    userName: 'superadmin',
    fullName: 'Super Administrator',
    userTypeId: 2,
    roleId: 1,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const ok = await call('POST', '/api/v1/auth/sso', { body: { token: adminToken }, auth: false });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, 'superadmin');
  assert.equal(ok.data.user.name, 'Super Administrator');
  assert.equal(ok.data.user.userTypeId, 2);
  assert.match(ok.headers.get('set-cookie'), /be_session/);

  // 2. Client role (userTypeId: 0) should be forbidden
  const clientToken = makeJwt({
    _id: 'mongo-id-456',
    email: 'client@realsite.com',
    userName: 'clientuser',
    fullName: 'Client User',
    userTypeId: 0,
    roleId: 2,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const forbidden = await call('POST', '/api/v1/auth/sso', { body: { token: clientToken }, auth: false });
  assert.equal(forbidden.status, 403);

  // 3. Expired admin token should be forbidden
  const expiredToken = makeJwt({
    _id: 'mongo-id-789',
    email: 'expired@realsite.com',
    userName: 'expiredadmin',
    userTypeId: 2,
    exp: Math.floor(Date.now() / 1000) - 100,
  });
  const expired = await call('POST', '/api/v1/auth/sso', { body: { token: expiredToken }, auth: false });
  assert.equal(expired.status, 403);

  // 4. Tampered signature should be forbidden
  const tampered = await call('POST', '/api/v1/auth/sso', { body: { token: adminToken + 'x' }, auth: false });
  assert.equal(tampered.status, 403);
});

test('mutating admin requests need the CSRF token', async () => {
  const r = await call('POST', '/api/v1/admin/posts', { body: good(), headers: { Cookie: cookie }, auth: false });
  assert.equal(r.status, 403);
});

test('cross-site Origin is rejected even with a valid session', async () => {
  const r = await call('POST', '/api/v1/admin/posts', { body: good(), headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'bad_origin');
});

let post;
test('drafts are created but invisible to the public API', async () => {
  const r = await call('POST', '/api/v1/admin/posts', { body: good() });
  assert.equal(r.status, 201);
  post = r.data;
  assert.equal(post.status, 'draft');
  assert.equal(post.version, 1);
  const pub = await call('GET', '/api/v1/posts', { auth: false });
  assert.equal(pub.data.items.length, 0);
  const bySlug = await call('GET', `/api/v1/posts/${post.slug}`, { auth: false });
  assert.equal(bySlug.status, 404);
});

test('validation rejects bad input with per-field messages', async () => {
  const badHost = await call('POST', '/api/v1/admin/posts', { body: good({ imageUrl: 'https://evil.example/x.png' }) });
  assert.equal(badHost.status, 422);
  assert.ok(badHost.data.fields.imageUrl);
  const badCat = await call('POST', '/api/v1/admin/posts', { body: good({ category: 'nope', title: 'x' }) });
  assert.ok(badCat.data.fields.category && badCat.data.fields.title);
  const js = await call('POST', '/api/v1/admin/posts', { body: good({ imageUrl: 'javascript:alert(1)' }) });
  assert.equal(js.status, 422);
});

test('publishing requires a description and an image', async () => {
  const d = await call('POST', '/api/v1/admin/posts', { body: good({ description: '', imageUrl: '' }) });
  const r = await call('POST', `/api/v1/admin/posts/${d.data.id}/publish`, { headers: { 'If-Match': String(d.data.version) } });
  assert.equal(r.status, 422);
  assert.ok(r.data.fields.description && r.data.fields.imageUrl);
});

test('creating an initial blank draft succeeds and publishing requires title', async () => {
  const blank = await call('POST', '/api/v1/admin/posts', {
    body: { title: '', description: '', category: 'rcs', author: 'SetuNxt Team', imageUrl: '', imageAlt: '' },
  });
  assert.equal(blank.status, 201);
  assert.equal(blank.data.draft.title, '');
  assert.equal(blank.data.status, 'draft');

  const pub = await call('POST', `/api/v1/admin/posts/${blank.data.id}/publish`, {
    headers: { 'If-Match': String(blank.data.version) },
  });
  assert.equal(pub.status, 422);
  assert.ok(pub.data.fields.title);
});

test('updates need If-Match and stale versions get 409 with the current copy', async () => {
  const noHeader = await call('PATCH', `/api/v1/admin/posts/${post.id}`, { body: { title: 'New title here' } });
  assert.equal(noHeader.status, 428);
  const ok = await call('PATCH', `/api/v1/admin/posts/${post.id}`, { body: { title: 'New title here' }, headers: { 'If-Match': '1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.version, 2);
  const stale = await call('PATCH', `/api/v1/admin/posts/${post.id}`, { body: { title: 'Stale write' }, headers: { 'If-Match': '1' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'version_conflict');
  assert.equal(stale.data.current.draft.title, 'New title here');
  post = ok.data;
});

test('publish makes the post public and pushes an event; unpublished edits stay private', async () => {
  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/v1/stream`, { signal: ctrl.signal });
  assert.equal(stream.headers.get('content-type').split(';')[0], 'text/event-stream');
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let seen = '';
  const waitFor = async (needle) => {
    while (!seen.includes(needle)) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); }
  };

  const pub = await call('POST', `/api/v1/admin/posts/${post.id}/publish`, { headers: { 'If-Match': String(post.version) } });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.status, 'published');
  await waitFor('event: post.published');
  assert.match(seen, /"title":"New title here"/);
  post = pub.data;

  // Edit after publishing: draft changes, live copy does not.
  const edit = await call('PATCH', `/api/v1/admin/posts/${post.id}`, { body: { title: 'Secret draft title' }, headers: { 'If-Match': String(post.version) } });
  assert.equal(edit.data.hasUnpublishedChanges, true);
  post = edit.data;
  const list = await call('GET', '/api/v1/posts', { auth: false });
  assert.equal(list.data.items[0].title, 'New title here');
  assert.ok(!JSON.stringify(list.data).includes('Secret draft title'));
  assert.ok(!seen.includes('Secret draft title'));

  // Publishing the changes emits post.updated with a higher version.
  const again = await call('POST', `/api/v1/admin/posts/${post.id}/publish`, { headers: { 'If-Match': String(post.version) } });
  await waitFor('event: post.updated');
  assert.match(seen, /"title":"Secret draft title"/);
  post = again.data;
  const nothing = await call('POST', `/api/v1/admin/posts/${post.id}/publish`, { headers: { 'If-Match': String(post.version) } });
  assert.equal(nothing.status, 409);
  assert.equal(nothing.data.error, 'nothing_to_publish');
  ctrl.abort();
});

test('public list is cacheable with ETag and CORS', async () => {
  const a = await call('GET', '/api/v1/posts', { auth: false });
  assert.equal(a.headers.get('access-control-allow-origin'), '*');
  const etag = a.headers.get('etag');
  assert.ok(etag);
  const b = await call('GET', '/api/v1/posts', { auth: false, headers: { 'If-None-Match': etag } });
  assert.equal(b.status, 304);
  assert.equal(a.data.items[0].author.name, 'Test Author');
  assert.equal(a.data.items[0].categoryLabel, 'API & Dev');
});

test('SSE replays missed events with Last-Event-ID and asks for resync when out of range', async () => {
  const seq = (await call('GET', '/api/v1/posts', { auth: false })).data.seq;
  assert.ok(seq >= 2);
  const readSome = async (headers) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/stream`, { headers, signal: ctrl.signal });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    let text = new TextDecoder().decode(value);
    // first chunk may only contain `retry:`; read one more if needed
    if (!text.includes('event:')) { const n = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({}), 300))]); if (n.value) text += new TextDecoder().decode(n.value); }
    ctrl.abort();
    return text;
  };
  const replay = await readSome({ 'Last-Event-ID': String(seq - 1) });
  assert.match(replay, new RegExp(`id: ${seq}\\n`));
  const ahead = await readSome({ 'Last-Event-ID': String(seq + 500) });
  assert.match(ahead, /event: resync/);
});

test('unpublish removes the post from the public API and emits an event', async () => {
  const r = await call('POST', `/api/v1/admin/posts/${post.id}/unpublish`, { headers: { 'If-Match': String(post.version) } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'draft');
  const list = await call('GET', '/api/v1/posts', { auth: false });
  assert.equal(list.data.items.length, 0);
  post = r.data;
});

test('archive is a soft delete and blocks further edits', async () => {
  const r = await call('DELETE', `/api/v1/admin/posts/${post.id}`, { headers: { 'If-Match': String(post.version) } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'archived');
  const edit = await call('PATCH', `/api/v1/admin/posts/${post.id}`, { body: { title: 'Nope nope' }, headers: { 'If-Match': String(r.data.version) } });
  assert.equal(edit.status, 409);
});

test('pagination walks through all published posts without duplicates', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const d = await call('POST', '/api/v1/admin/posts', { body: good({ title: `Paged post ${i}` }) });
    const p = await call('POST', `/api/v1/admin/posts/${d.data.id}/publish`, { headers: { 'If-Match': String(d.data.version) } });
    ids.push(p.data.id);
  }
  const seen = [];
  let cursor = '';
  for (let guard = 0; guard < 10; guard++) {
    const page = await call('GET', `/api/v1/posts?limit=2${cursor}`, { auth: false });
    seen.push(...page.data.items.map((i) => i.id));
    if (!page.data.nextCursor) break;
    cursor = `&cursor=${page.data.nextCursor}`;
  }
  assert.equal(new Set(seen).size, 5);
  assert.equal(seen.length, 5);
  const bad = await call('GET', '/api/v1/posts?cursor=garbage', { auth: false });
  assert.equal(bad.status, 400);
});

test('uploads verify real image bytes, not the declared type', async () => {
  const fake = await call('POST', '/api/v1/admin/uploads', { raw: Buffer.from('<script>alert(1)</script> not an image at all'), headers: { 'Content-Type': 'image/png' } });
  assert.equal(fake.status, 415);
  const wrongType = await call('POST', '/api/v1/admin/uploads', { raw: PNG_1X1, headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal(wrongType.status, 415);
  const ok = await call('POST', '/api/v1/admin/uploads', { raw: PNG_1X1, headers: { 'Content-Type': 'image/png' } });
  assert.equal(ok.status, 201);
  assert.match(ok.data.imageUrl, /\/media\/[a-f0-9]{32}-(card\.webp|orig\.png)$/);

  const img = await fetch(ok.data.imageUrl);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.match(img.headers.get('cache-control'), /immutable/);

  // Uploaded images are accepted as post images; path traversal is not served.
  const withImg = await call('POST', '/api/v1/admin/posts', { body: good({ imageUrl: ok.data.imageUrl }) });
  assert.equal(withImg.status, 201);
  const trav = await fetch(`${base}/media/..%2F..%2Fpackage.json`);
  assert.equal(trav.status, 404);
});

test('oversized uploads are rejected', async () => {
  const big = Buffer.concat([PNG_1X1, Buffer.alloc(6 * 1024 * 1024)]);
  const r = await call('POST', '/api/v1/admin/uploads', { raw: big, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 413);
});

test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/v1/auth/login', { body: { password: 'wrong' }, auth: false });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});

test('preview tokens gate a single draft without needing a session', async () => {
  const d = await call('POST', '/api/v1/admin/posts', { body: good({ title: 'Unpublished preview draft' }) });
  const noAuth = await call('POST', `/api/v1/admin/posts/${d.data.id}/preview-token`, { auth: false });
  assert.equal(noAuth.status, 401);

  const issued = await call('POST', `/api/v1/admin/posts/${d.data.id}/preview-token`);
  assert.equal(issued.status, 200);
  assert.ok(issued.data.token);
  assert.match(issued.data.url, new RegExp(`preview=${d.data.id}&token=`));

  const ok = await call('GET', `/api/v1/preview/${d.data.id}?token=${issued.data.token}`, { auth: false });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.title, 'Unpublished preview draft');
  assert.equal(ok.data.status, 'preview');

  const wrongPost = await call('POST', '/api/v1/admin/posts', { body: good({ title: 'Someone else' }) });
  const mismatched = await call('GET', `/api/v1/preview/${wrongPost.data.id}?token=${issued.data.token}`, { auth: false });
  assert.equal(mismatched.status, 403);

  const tampered = await call('GET', `/api/v1/preview/${d.data.id}?token=${issued.data.token}x`, { auth: false });
  assert.equal(tampered.status, 403);

  const missing = await call('POST', '/api/v1/admin/posts/does-not-exist/preview-token');
  assert.equal(missing.status, 404);
});

test('admin page is served with a strict CSP and is not frameable', async () => {
  const res = await fetch(`${base}/admin`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('Express middleware integration: mounts on Express, calls next() for non-blog routes, and authenticates via Mongoose User model', async () => {
  const { createBlogMiddleware } = require('../index');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-express-'));

  // Mock Mongoose User model matching the user's schema
  const mockUsers = [
    {
      _id: 'mongo-admin-1',
      userName: 'realadmin',
      email: 'admin@realsite.com',
      fullName: 'Real Website Administrator',
      password: 'mypassword123',
      userTypeId: 2, // Admin
      roleId: 2,
      status: 1,
      isPasswordCorrect: async (pw) => pw === 'mypassword123',
    },
    {
      _id: 'mongo-client-1',
      userName: 'realclient',
      email: 'client@realsite.com',
      fullName: 'Real Client User',
      password: 'clientpassword',
      userTypeId: 0, // Client
      roleId: 0,
      status: 1,
      isPasswordCorrect: async (pw) => pw === 'clientpassword',
    }
  ];

  const mockUserModel = {
    findOne: async (query) => {
      const q = query.$or[0].userName;
      return mockUsers.find((u) => (u.userName === q || u.email === q) && u.userTypeId === query.userTypeId && u.status === query.status) || null;
    }
  };

  const middleware = createBlogMiddleware({
    config: { DATA_DIR: tempDir, SESSION_SECRET: 'y'.repeat(32) },
    userModel: mockUserModel,
  });

  // 1. Verify non-blog route calls next()
  let nextCalled = false;
  const mockReq = { method: 'GET', url: '/some/unrelated/real-site/route', headers: {} };
  const mockRes = { setHeader: () => {} };
  await middleware(mockReq, mockRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'Non-blog route should pass through via next()');

  // 2. Start small HTTP server with the middleware
  const port = await freePort();
  const srv = http.createServer((req, res) => {
    // Simulate Express app.use(middleware)
    middleware(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'real_site_404' }));
    });
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  const ep = `http://127.0.0.1:${port}`;

  try {
    // 3. Client login attempt (userTypeId: 0) should fail
    const clientLogin = await fetch(`${ep}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'realclient', password: 'clientpassword' }),
    });
    assert.equal(clientLogin.status, 401);

    // 4. Admin login attempt (userTypeId: 2) should succeed
    const adminLogin = await fetch(`${ep}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'realadmin', password: 'mypassword123' }),
    });
    assert.equal(adminLogin.status, 200);
    const loginData = await adminLogin.json();
    assert.equal(loginData.user.username, 'realadmin');
    assert.equal(loginData.user.name, 'Real Website Administrator');
    assert.equal(loginData.user.userTypeId, 2);

    // 5. Existing Express auth middleware integration (req.user already set)
    let preAuthCalled = false;
    const reqWithUser = {
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {},
      user: { _id: 'mongo-admin-1', userName: 'realadmin', fullName: 'Real Admin', userTypeId: 2 },
    };
    const resMock = {
      setHeader: () => {},
      writeHead: (st) => { assert.equal(st, 200); preAuthCalled = true; },
      end: (b) => {
        const d = JSON.parse(b);
        assert.equal(d.authenticated, true);
        assert.equal(d.user.username, 'realadmin');
      }
    };
    await middleware(reqWithUser, resMock, () => {});
    assert.equal(preAuthCalled, true);
  } finally {
    await middleware.engine.close();
    await new Promise((r) => srv.close(r));
  }
});
