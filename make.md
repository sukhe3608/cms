# Blog Engine — Make / Developer Reference

> Everything you need to build, run, seed, test, and extend the engine locally.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 22.5 (uses `node:sqlite`, `node:test`) |
| npm | Ships with Node |
| sharp *(optional)* | Auto-detected — enables WebP resize |

No Docker, no external database, no build step required.

---

## 1. First-Time Setup

```bash
# 1. Clone / enter the project
cd blog-engine

# 2. Copy the example env file and edit it
cp .env.example .env

# 3. Install optional dependency (image resizing)
npm install          # installs sharp if your platform supports it

# 4. Seed the database with existing static posts
npm run seed

# 5. Start the dev server (auto-restarts on file changes)
npm run dev
```

Open `http://localhost:8787/admin` — log in with the password from `.env` (or the one printed to stdout if you left `ADMIN_PASSWORD` blank).

---

## 2. npm Scripts

| Script | Command | What it does |
|---|---|---|
| `npm start` | `node server/index.js` | Production start — no file watching |
| `npm run dev` | `node --watch server/index.js` | Dev start — restarts on any server file change |
| `npm run seed` | `node server/seed.js` | Imports existing hardcoded blog posts into SQLite |
| `npm test` | `node --test "test/*.test.js"` | Runs all integration tests (real HTTP, temp DB) |

---

## 3. Environment Variables

All variables are optional for local development. Copy `.env.example` → `.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | Port the engine listens on |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Full public URL of this engine (used to build `/media/` image URLs) |
| `ADMIN_PASSWORD` | *(auto-generated)* | Login password. A random one is printed on first start if unset |
| `ADMIN_USERNAME` | `admin` | Username for the default admin account |
| `ADMIN_NAME` | `Admin` | Display name for the default admin account |
| `ADMIN_EMAIL` | `admin@setunxt.com` | Email for the default admin account |
| `SESSION_SECRET` | *(auto-saved to DATA_DIR)* | HMAC key for session cookies |
| `SITE_URL` | `http://localhost:5500/blog.html` | Your public blog page URL (used for preview iframe) |
| `SITE_ORIGINS` | *(empty = any)* | Comma-separated origins allowed to call the public API |
| `IMAGE_HOSTS` | `images.unsplash.com` | Extra HTTPS hosts allowed in post image URLs |
| `DATA_DIR` | `./data` | Where `engine.db` and `uploads/` are stored |
| `MAX_UPLOAD_MB` | `5` | Maximum image upload size in megabytes |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy to trust `X-Forwarded-For` |
| `REAL_SITE_JWT_SECRET` | *(empty)* | JWT secret from your main site (enables SSO + direct JWT auth) |
| `REAL_SITE_AUTH_URL` | *(empty)* | Your main site's login endpoint (enables API-delegated auth) |
| `REAL_SITE_ADMIN_USER_TYPE_ID` | `2` | `userTypeId` value that qualifies as admin in your main site |

---

## 4. Project Layout

```
blog-engine/
├── index.js              ← Library entry point (Express middleware)
├── package.json
├── .env.example
│
├── server/               ← All backend code
│   ├── index.js          ← Standalone process entry point
│   ├── app.js            ← Router + all HTTP handlers
│   ├── config.js         ← Env parsing, secret bootstrap
│   ├── db.js             ← SQLite schema + open helper
│   ├── store.js          ← Post CRUD, event log, pagination
│   ├── auth.js           ← Session, HMAC, rate limit, JWT SSO
│   ├── hub.js            ← SSE broadcast hub
│   ├── images.js         ← Image sniff + sharp pipeline
│   ├── validate.js       ← Field validation + publish checks
│   ├── preview-tokens.js ← Short-lived HMAC preview tokens
│   ├── http.js           ← Shared HTTP utilities (HttpError etc.)
│   └── seed.js           ← DB seeder (run once)
│
├── admin/                ← Admin SPA (served at /admin)
│   ├── index.html
│   ├── app.js
│   └── app.css
│
├── client/               ← Ships to your public blog site
│   └── blog-live.js
│
├── site-patches/         ← Instructions for patching blog.html / blog.js
│   ├── blog.html.patch.md
│   ├── blog.js           ← Patched copy of your site's blog.js
│   └── CHANGES.md
│
├── test/
│   └── engine.test.js    ← 19 integration tests
│
└── data/                 ← Runtime data (git-ignored)
    ├── engine.db
    ├── engine.db-shm
    ├── engine.db-wal
    ├── .session-secret
    └── uploads/
```

---

## 5. Running Tests

```bash
npm test
```

Tests spin up a **real HTTP server** on a random port against a **temporary in-memory SQLite** database — no mocks, no stubs.

Test suite covers:
- Unauthenticated access to admin routes (→ 401)
- Login / logout / session expiry
- CSRF protection on all mutating endpoints
- Post create → save draft → publish → update → unpublish → archive lifecycle
- Optimistic concurrency (`If-Match` / `409` conflicts)
- Image upload (format validation, size limit, content-type enforcement)
- Public listing (ETag, cursor pagination, category filter)
- Per-slug public lookup
- SSE stream connect, event replay, keep-alive
- Preview token issue, verify, expiry
- `/healthz` endpoint

Re-run any time. Each run starts clean.

---

## 6. Seeding the Database

```bash
npm run seed
```

`server/seed.js` reads the existing hardcoded `<article>` cards from your `blog.html`, converts them to post records, and inserts them as published posts. Safe to run multiple times — duplicate slugs are skipped.

---

## 7. Adding a New API Route

Routes are registered in `server/app.js` using a simple helper:

```js
// add(method, pattern, handler, opts)
add('GET', '/api/v1/admin/stats', ({ res }) => {
  requireAdmin(req);        // already called automatically if opts.admin = true
  sendJson(res, 200, { total: store.listAdmin('all').length });
}, { admin: true });
```

- `pattern` supports named params: `:id`, `:slug`, etc.
- `opts.admin = true` triggers `requireAdmin()` before the handler runs.
- Throw `new HttpError(status, body)` from any handler — the dispatcher catches it and sends the right JSON error.

---

## 8. Adding a New Validated Field

1. Add the field name to `FIELDS` in `server/validate.js`.
2. Add the cleaned value to the `out` object in `validateDraft()`.
3. Add any length/format constraints below.
4. Add `publishProblems()` checks if the field is required before going live.
5. Update the Admin SPA (`admin/app.js`) to send and render the field.
6. Update `toPublic()` in `store.js` if visitors should receive it.

---

## 9. Deploying

### Simple VM / container

```bash
# 1. Copy project files to server (excluding data/)
# 2. Set env vars or write .env
# 3. Run under a process manager
pm2 start npm --name blog-engine -- start
# or
systemctl start blog-engine
```

### Reverse proxy (Caddy — recommended)

```
blog-api.setunxt.com {
  reverse_proxy localhost:8787
}
```

Caddy handles TLS automatically. Set `PUBLIC_BASE_URL=https://blog-api.setunxt.com` and `TRUST_PROXY=1`.

### Backup

Back up `DATA_DIR` (default `./data/`):

```bash
# SQLite online backup — safe while the server is running
sqlite3 data/engine.db ".backup data/engine.db.bak"

# Or simply rsync the whole data/ directory
rsync -av data/ backups/blog-engine-$(date +%Y%m%d)/
```

---

## 10. Embedding as Express Middleware

```js
// In your existing Express app:
const { createBlogMiddleware } = require('./path/to/blog-engine');

const blogEngine = createBlogMiddleware({
  config: {
    // override any config key here
    siteUrl: 'https://yoursite.com/blog.html',
  },
  // Optional: pass your Mongoose User model for auth delegation
  userModel: require('./models/User'),
});

app.use(blogEngine);

// Access the engine internals if needed:
// blogEngine.engine.store, blogEngine.engine.hub, etc.
```

Admin routes honour `req.user` if your existing JWT middleware has already set it (checks `req.user.userTypeId === 2`). This means admins logged into your main site can access the blog admin without a separate login.

---

## 11. Multi-Instance Notes

The SSE hub (`server/hub.js`) stores connected browser sockets in one process's memory. Running two instances behind a load balancer means:

- **Publish on instance A** → SSE push reaches only browsers connected to A.
- **Browsers on instance B** fall back to the 45-second poll in `blog-live.js`.

To fix this properly:
1. Swap SQLite → Postgres (concurrent writers).
2. Replace the in-memory `Set` in `hub.js` with `LISTEN/NOTIFY` or Redis pub/sub.

One instance is fine for a single blog indefinitely.
