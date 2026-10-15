# Blog Engine — System Design

> A standalone Node.js blog content engine: CRUD API, image upload, live push to an existing static site. Zero required npm dependencies.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (visitor)                     │
│  blog.html + blog-live.js  ──────────────────────────┐  │
│  (static site, unchanged CSS, unchanged blog.js)     │  │
└─────────────────────────────────────────────────────────┘
                │ GET /api/v1/posts          │ SSE /api/v1/stream
                │ GET /api/v1/posts/:slug    │
                ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│                    Blog Engine (Node.js)                  │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  server/ │  │  auth.js │  │  store.js│  │  hub.js │  │
│  │  app.js  │  │ (session │  │ (SQLite) │  │  (SSE)  │  │
│  │ (router) │  │ + CSRF)  │  │          │  │         │  │
│  └────┬─────┘  └──────────┘  └──────────┘  └─────────┘  │
│       │                              │                     │
│  ┌────▼──────────────────────────────────────────────┐   │
│  │       SQLite  data/engine.db  (WAL mode)          │   │
│  │   tables: users · posts · events                  │   │
│  └───────────────────────────────────────────────────┘   │
│       │ /media/*                                          │
│  ┌────▼────┐                                              │
│  │ uploads │  (data/uploads/  — served as static files)  │
│  └─────────┘                                              │
└──────────────────────────────────────────────────────────┘
                │ /admin
                ▼
┌──────────────────────────────────────────────────────────┐
│              Admin SPA  (admin/index.html + app.js)       │
│   CRUD posts · image upload · live preview iframe         │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Module Map

| File | Role |
|---|---|
| `server/index.js` | Process entry point — reads config, opens DB, starts HTTP server |
| `server/app.js` | Route table, request dispatcher, `createApp()` / `createBlogMiddleware()` |
| `server/config.js` | Environment variable parsing, secret auto-generation |
| `server/db.js` | SQLite schema bootstrap (`users`, `posts`, `events`) |
| `server/store.js` | All SQL — post CRUD, event log, cursor pagination |
| `server/auth.js` | Session cookies, HMAC signing, rate limiting, SSO/JWT |
| `server/hub.js` | Server-Sent Events broadcast to connected browsers |
| `server/images.js` | Image format sniffing, sharp resize → WebP, fallback store |
| `server/validate.js` | Draft field validation, publish pre-flight checks |
| `server/preview-tokens.js` | Short-lived HMAC tokens for token-gated draft preview |
| `server/http.js` | Shared HTTP helpers: `HttpError`, `readJson`, `sendJson`, etc. |
| `server/seed.js` | One-shot script to load existing static posts into the DB |
| `admin/app.js` | Admin SPA logic (runs entirely in the browser) |
| `admin/index.html` | Admin SPA shell |
| `admin/app.css` | Admin SPA styles |
| `client/blog-live.js` | Client script shipped to the public blog page |
| `index.js` | Library entry point for embedding as Express middleware |

---

## 3. Data Flow — Write Path (Admin publishes a post)

```
Admin Browser
  │ PATCH /api/v1/admin/posts/:id          (auto-save draft)
  │   If-Match: <version>                   (optimistic concurrency)
  │   X-CSRF-Token: <csrf>                  (CSRF guard)
  │
  ▼
app.js → requireAdmin() → store.saveDraft()
  │  SQLite: UPDATE posts SET draft = ?, version = version+1
  │
  │ POST /api/v1/admin/posts/:id/publish
  │
  ▼
app.js → store.publish()
  │  SQLite: UPDATE posts SET live = draft, status='published', live_version = version+1
  │  SQLite: INSERT INTO events (type='post.published', payload = toPublic(row))
  │
  ▼
hub.broadcast(event)
  │  SSE frame  →  every connected browser's EventSource
  │
  ▼
blog-live.js (visitor) receives 'post.published' event
  │  upsertPost() → prepend <article class="card"> to #grid
```

---

## 4. Data Flow — Read Path (Visitor loads blog.html)

```
blog-live.js boots
  │ GET /api/v1/posts?limit=9         (cursor-paginated, ETag cached)
  ▼
app.js → store.listPublic()
  │  SELECT * FROM posts WHERE status='published'
  │  ORDER BY published_at DESC, id DESC LIMIT 10
  │  ETag: SHA-1 of JSON body (304 if unchanged)
  ▼
blog-live.js renders cards into #grid, opens SSE stream
```

---

## 5. Database Schema

```sql
-- Admin users (local + seeded from .env)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,       -- UUID
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,          -- scrypt(password, salt, 32)
  salt          TEXT NOT NULL,          -- 16 random bytes, hex
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL,          -- ISO-8601
  updated_at    TEXT NOT NULL
);

-- Posts: dual-copy draft/live model
CREATE TABLE posts (
  id            TEXT PRIMARY KEY,       -- UUID
  slug          TEXT NOT NULL UNIQUE,   -- auto-generated, collision-safe
  status        TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  version       INTEGER NOT NULL,       -- bumped on every write
  live_version  INTEGER NOT NULL DEFAULT 0,
  draft         TEXT NOT NULL,          -- JSON blob: what the editor sees
  live          TEXT,                   -- JSON blob: what visitors see (copied on publish)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  published_at  TEXT                    -- NULL until first publish
);

-- Append-only event log for SSE replay (Last-Event-ID)
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,            -- post.published | post.updated | post.unpublished
  post_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,            -- JSON (public view of the post)
  created_at TEXT NOT NULL
);
```

**Pragma config**: WAL journal mode, 3 s busy timeout, foreign keys ON.
**Event pruning**: only the last 1 000 events are kept (`KEEP_EVENTS = 1000`).

---

## 6. Dual-Copy Draft / Live Model

Every post row carries two JSON blobs:

| Column | Contents | Who sees it |
|---|---|---|
| `draft` | Latest editor state | Admin app, preview tokens |
| `live` | Snapshot at last publish | Public API, SSE events |

`hasUnpublishedChanges` is computed as `draft !== live` (string compare). Visitors **never** receive `draft` data; the `toPublic()` projection in `store.js` reads only from `live`.

---

## 7. Real-Time Push — Server-Sent Events

`hub.js` maintains an in-memory `Set` of active `res` objects (up to 2 000 clients).

- **Connect**: `GET /api/v1/stream` — browser opens `EventSource`, engine sends `retry: 5000`.
- **Replay**: if `Last-Event-ID` is present, all events since that seq are flushed immediately.
- **Resync**: if the client is behind the oldest retained event, a `resync` event forces a full reload of posts.
- **Keep-alive**: `:ka` comment sent every 25 s to prevent proxy timeouts.
- **Broadcast**: called inside the same transaction commit that writes the event row, so clients never see an event for a rolled-back write.

> The SSE hub is in-process memory. Multi-instance deployments need Redis pub/sub or Postgres `LISTEN/NOTIFY` (see `hub.js`).

---

## 8. Image Upload Pipeline

```
POST /api/v1/admin/uploads
  Content-Type: image/jpeg | image/png | image/webp
  (raw binary body, not multipart)
         │
         ▼
images.js: sniff(buf) — magic-byte format detection
         │
   ┌─────┴──────────┐
   │ sharp present? │
   └─────┬──────────┘
    No   │   Yes
    │    ▼
    │  .rotate()  — apply EXIF orientation, strip metadata
    │  resize to 500×300 (card) and 800×500 (feature)
    │  re-encode → WebP at quality 80
    │  write  {id}-card.webp  and  {id}-feature.webp
    │
    ▼ (no sharp)
  write {id}-orig.{ext}  (validated but not resized)

Response: { imageUrl, featureUrl, optimized: bool, bytes }
```

Files are served from `/media/` with `Cache-Control: immutable, max-age=31536000` and `Content-Security-Policy: default-src 'none'`.

---

## 9. Post Lifecycle State Machine

```
         createPost()
              │
              ▼
           [draft] ◄────────────────────────┐
              │                             │
           publish()                   unpublish()
              │                             │
              ▼                             │
         [published] ──────────────────────►┘
              │
           archive()
              │
              ▼
          [archived]  (soft delete — slug reserved forever)
```

Every transition bumps `version` and enforces `If-Match` optimistic-concurrency.

---

## 10. Mounting Modes

### Standalone (default)

```bash
npm start       # node server/index.js
```

`createApp(cfg)` builds a raw `node:http` server. Config comes entirely from environment variables.

### Express Middleware

```js
const { createBlogMiddleware } = require('./blog-engine');
app.use('/blog-engine', createBlogMiddleware());
```

`createBlogMiddleware()` wraps the same router in an Express-compatible async function. Routes that don't match blog-engine paths call `next()` so other Express middleware keeps working. Admin `requireAdmin()` also checks `req.user` (set by your existing JWT middleware) before falling back to the blog session cookie.

---

## 11. Cursor Pagination

Public listing uses a stable, opaque cursor:

```
cursor = base64url( publishedAt + "|" + id )
```

The WHERE clause `(published_at < ? OR (published_at = ? AND id < ?))` ensures stable ordering even when two posts share the same timestamp. The cursor is validated server-side (regex check) and an invalid cursor returns `400 invalid_cursor`.

---

## 12. Preview Token Flow

```
Admin clicks "Preview"
  │ POST /api/v1/admin/posts/:id/preview-token
  ▼
previewTokens.issue(id)
  token = base64url(id + "." + exp) + "." + HMAC(secret, "preview:" + payload)

Admin app opens:  SITE_URL?preview=<id>&token=<token>
  │
  ▼
blog-live.js sees ?preview + ?token in URL
  │ GET /api/v1/preview/:id?token=<token>
  ▼
previewTokens.verify(id, token) — timing-safe, checks expiry
store.getPreview(id)  — reads from draft (never live)
  │
  ▼
makeCardEl(post, { preview: true })
  → orange outline card prepended to #grid

Admin app also sends postMessage({ type:'be:preview', post, token, id })
  → instant card update as author types (4s poll fallback)
```

Token TTL: **30 minutes**. Scoped to one post ID — cannot list or reveal other posts.
