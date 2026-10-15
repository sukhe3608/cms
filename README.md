# Blog engine

A standalone content engine for the SetuNxt blog: write a title, description,
and image in a small admin app; changes appear on the live site within
seconds, with zero changes to `blog.css` and only two small, reviewed edits
to `blog.js`.

Zero required npm dependencies. Uses Node's built-in `http`, `node:sqlite`,
and `node:test`. `sharp` (image resizing to WebP) is optional — the engine
runs without it, just without resizing.

## What's implemented (Phase 1 + the real-time/preview parts of Phase 2)

- Full CRUD API with draft/live separation, optimistic-concurrency versioning
  (`If-Match` / `409` conflicts), and a soft-delete archive state
- Image upload: format verified from file bytes (not the filename or
  declared Content-Type), re-encoded to WebP at two sizes, EXIF stripped
- Public API: cursor-paginated listing, ETag caching, per-post lookup by slug
- Real-time push over Server-Sent Events, with `Last-Event-ID` replay and a
  polling fallback for clients that lose the stream
- Token-gated live preview: the admin app's iframe shows the *draft*, on the
  real page, updated instantly via `postMessage` as you type
- Session auth (HMAC-signed cookie, HttpOnly + SameSite), CSRF token on all
  mutating admin requests, per-IP login rate limiting, strict CSP on the
  admin page
- `blog-live.js`: renders posts into your existing `#grid` using the same
  class names your CSS already styles, so no stylesheet changes are needed
- 19 automated integration tests covering the above (`npm test`)

**Not yet built** (see the original roadmap for Phase 3): user roles beyond a
single shared admin password, a media library / image reuse across posts,
rich-text post bodies with a real article page (clicking a card still opens
the same generated-filler article tab your site uses today, just with the
title/description/image swapped in), scheduling, and revision history.
Multi-instance deployment needs one small change — see "Scaling" below.

## Quickstart

```bash
cd blog-engine
cp .env.example .env        # edit ADMIN_PASSWORD, SITE_URL, etc. — see below
npm run seed                # loads your 10 existing posts into the database
npm start                   # http://localhost:8787/admin
```

Then follow `site-patches/blog.html.patch.md` to add two lines to your site.
Everything else — `blog.css`, `blog.html`'s structure, the 10 hardcoded
`<article>` cards — stays exactly as it is; they're used only as an offline
fallback if the engine is ever unreachable.

Run the tests any time with `npm test` (spins up a real instance on a random
port against a temp SQLite database — no mocks).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT`, `PUBLIC_BASE_URL` | Where this engine itself listens and is reached at |
| `ADMIN_PASSWORD` | If unset, a random one is generated and printed on first `npm start` — set a real one before deploying |
| `SESSION_SECRET` | If unset, one is generated and saved to `DATA_DIR/.session-secret` |
| `SITE_URL` | Your blog page, e.g. `https://setunxt.com/blog.html` — used to build the preview link |
| `SITE_ORIGINS` | Origins allowed to call the public API from a browser; leave empty to allow any (safe — the public API only ever serves published posts) |
| `IMAGE_HOSTS` | Extra HTTPS hosts allowed as post image URLs, besides ones you upload here |
| `DATA_DIR` | Where the SQLite database and uploaded images live |
| `MAX_UPLOAD_MB` | Upload size limit, default 5 |
| `TRUST_PROXY` | Set to `1` only if you run this behind a reverse proxy you control |

## Deployment model

The engine is one Node process serving three things on one port: the public
JSON API (`/api/v1/*`), the admin app (`/admin`), and uploaded images
(`/media/*`). It doesn't need a separate static file server or build step.

A simple, solid setup:

1. Run `npm start` under a process manager (`systemd`, `pm2`, or a container)
   on a small VM or container host, on its own subdomain (e.g. `blog-api.setunxt.com`).
2. Put a reverse proxy (Caddy, Nginx, or your platform's built-in one) in
   front for TLS. Caddy is simplest — `blog-api.setunxt.com { reverse_proxy localhost:8787 }`
   gets you HTTPS automatically.
3. Point `SITE_URL` at your real blog page and set `window.BLOG_ENGINE_API`
   in `blog.html` to `https://blog-api.setunxt.com/api/v1`.
4. Back up `DATA_DIR` (the SQLite file + uploaded images) on a schedule —
   there's no external database to manage.

Your existing static site doesn't move or change hosts. It only gains two
`<script>` tags that talk to this new subdomain.

### Scaling / multi-instance

The event log and SSE broadcast currently live in one process's memory. If
you ever run more than one instance behind a load balancer, publishing on
instance A won't push to a browser connected to instance B — polling would
still catch up within 45 seconds, but the "real-time" part would degrade to
that on some fraction of requests. Fixing this is a contained change: swap
the in-process broadcast in `server/hub.js` for Postgres `LISTEN/NOTIFY` or
Redis pub/sub (and swap SQLite for Postgres at the same time, since SQLite
doesn't support concurrent writers across processes). One instance is fine
indefinitely for a single blog's traffic.

## Project layout

```
server/    HTTP API, SQLite store, SSE hub, auth, image processing, tests
admin/     The editor app (static HTML/CSS/JS, served at /admin)
client/    blog-live.js — the one file that ships to your actual site
site-patches/  The two small, reviewed edits to your existing blog.js,
               plus exact instructions for the one-line blog.html change
test/      Integration tests (node --test)
```

## Known limitations to know about before relying on this

- **Single admin password.** Good for one person publishing; add real
  accounts/roles (Phase 3) before handing editor access to a team.
- **No CSRF-safe multi-tab session invalidation.** Logging out in one tab
  doesn't close sessions open in others until the cookie expires (8 hours).
- **Preview tokens aren't rate-limited.** They're short-lived (30 min) and
  scoped to one post, so the risk is low, but add a limiter if you're
  concerned about token-guessing traffic (guessing is already infeasible —
  it's a 256-bit HMAC — but a limiter is cheap insurance).
- **No automated browser test of blog-live.js or the admin UI.** The server
  and its API are covered by 19 integration tests that actually exercise
  HTTP end to end; `admin/app.js` and `client/blog-live.js` were syntax
  checked and manually traced against the API but not run in a real browser
  in this environment. Test the full flow (open `/admin`, publish a post,
  watch it appear on a locally served copy of `blog.html`) before rolling
  this out to your live site.
