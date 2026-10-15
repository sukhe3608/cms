# Blog Engine — Security Reference

> Documents every security control in the engine, known limitations, and hardening steps for production.

---

## 1. Authentication

### Local password auth

- Passwords are stored as **scrypt** hashes (`crypto.scryptSync`, N=16384 default, 32-byte output) with a 16-byte random salt per user.
- Comparison uses `crypto.timingSafeEqual` to prevent timing side-channels.
- On startup, if `ADMIN_PASSWORD` is set and differs from the stored hash, the DB record is updated automatically (keeps `.env` as the source of truth).
- If `ADMIN_PASSWORD` is unset, a 12-character random password is generated and printed once to stdout. Set a real password in `.env` before going to production.

### Session cookie

| Property | Value |
|---|---|
| Cookie name | `be_session` |
| Signing | HMAC-SHA-256 over a base64url-encoded JSON payload |
| Secret source | `SESSION_SECRET` env var, or auto-generated and saved to `DATA_DIR/.session-secret` (mode 0600) |
| TTL | 8 hours (enforced in the payload `exp` field, not just `Max-Age`) |
| Flags | `HttpOnly`, `SameSite=Lax`, `Secure` (when `PUBLIC_BASE_URL` is `https://`) |

The cookie value is `<base64url-payload>.<HMAC>`. The server re-derives the HMAC on every request and rejects anything that doesn't match, so the cookie cannot be forged or tampered with without the secret.

### JWT / SSO auth

When `REAL_SITE_JWT_SECRET` is set, the engine also accepts:

- `Authorization: Bearer <jwt>` header
- `accessToken`, `jwt`, or `token` cookies from your main site

The JWT is verified with HMAC-SHA-256 (HS256). Requirements:
- Signature must match.
- `exp` must be in the future.
- `userTypeId` must equal `REAL_SITE_ADMIN_USER_TYPE_ID` (default `2`).

This means admins already logged into your main site can access the blog admin without re-entering credentials.

### API-delegated auth

When `REAL_SITE_AUTH_URL` is set, the login handler POSTs credentials to that URL and accepts the result if the returned user has the correct `userTypeId`. Falls back to local DB if the remote call fails.

### Mongoose User Model

When embedded as middleware and `options.userModel` is passed, credentials are verified against your real site's Mongoose model (calls `isPasswordCorrect()` or bcrypt directly). This takes priority over all other auth methods.

---

## 2. CSRF Protection

All **mutating** admin requests (POST / PATCH / DELETE) are protected by a double-submit CSRF token:

1. **Token issuance**: a 16-byte random hex string (`csrf`) is embedded inside the signed session payload and returned in the login/me response body.
2. **Token enforcement**: every mutating request must include `X-CSRF-Token: <csrf>`. The value is compared to the one in the session using `crypto.timingSafeEqual`.
3. **Origin check**: even with a valid CSRF token, the `Origin` header (when present) must match the engine's own origin or the same `host`. This blocks cross-origin requests from other sites even if they somehow obtain the token.

GET and HEAD requests are **not** CSRF-protected (they are read-only).

---

## 3. Login Rate Limiting

The `/api/v1/auth/login` endpoint is rate-limited per source IP:

| Setting | Value |
|---|---|
| Max failures before lockout | 5 |
| Lockout window | 15 minutes |
| Response on lockout | `429` with `Retry-After` header and `retryAfter` seconds in body |
| IP source | `req.socket.remoteAddress`, or `X-Forwarded-For[0]` if `TRUST_PROXY=1` |

Failures are cleared on successful login. The failure map is in process memory — a restart clears all lockouts.

> Set `TRUST_PROXY=1` **only** if this engine runs behind a reverse proxy you control (Caddy, Nginx, etc.). Trusting the header on a public-facing server allows anyone to spoof their IP.

---

## 4. Content Security Policy

### Admin page

The `admin/index.html` response includes a strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self';
frame-src <siteOrigin>;
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
```

- No inline scripts, no `eval`.
- `frame-src` is locked to the public blog page origin (for the preview iframe).
- `frame-ancestors 'none'` prevents the admin from being embedded in another page.

### Uploaded media

Each `/media/:file` response includes:

```
Content-Security-Policy: default-src 'none'
Cross-Origin-Resource-Policy: cross-origin
```

This prevents uploaded images from executing scripts if a browser somehow opens them directly.

### All responses

Every response includes:

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

---

## 5. Image Upload Security

| Control | Implementation |
|---|---|
| Format verification | Magic-byte sniffing (`sniff()` in `images.js`) — file content, never filename or `Content-Type` |
| Accepted formats | JPEG (`ff d8 ff`), PNG (`89 50 4e 47…`), WebP (`RIFF…WEBP`) |
| Max size | `MAX_UPLOAD_MB` (default 5 MB) — enforced by streaming byte count before buffering the full body |
| EXIF stripping | sharp's `.rotate()` re-encodes to WebP, dropping all metadata |
| Pixel bomb guard | `limitInputPixels: 40e6` passed to sharp |
| Filename | Random 32-byte hex ID generated server-side — no user-supplied filename is used |
| Storage path | Validated against `MEDIA_RE = /^[a-f0-9]{32}-(card|feature|orig)\.(webp|jpg|png)$/` before serving |
| Upload transport | Raw binary body (no multipart parser) — simpler attack surface |

---

## 6. Input Validation

All post fields pass through `validateDraft()` in `server/validate.js` on every create / save / publish:

| Field | Constraints |
|---|---|
| `title` | 3–140 characters, control characters stripped |
| `description` | ≤ 400 characters |
| `content` | ≤ 50 000 characters |
| `category` | Must be one of the 7 known category keys |
| `imageUrl` | ≤ 500 chars; must be either from this engine's `publicBaseUrl/media/` or from a host in `IMAGE_HOSTS` |
| `imageAlt` | ≤ 160 characters |
| `author` | 2–60 characters |

Additional **publish-time** checks (in `publishProblems()`):

- `title` must be ≥ 3 characters.
- `description` must be ≥ 10 characters.
- `imageUrl` must not be empty.

All string values are sanitized by collapsing control characters and runs of whitespace. **Escaping is left to the renderer** (`blog-live.js` uses an `esc()` HTML-escaping helper before inserting into `innerHTML`).

---

## 7. Optimistic Concurrency / Conflict Prevention

Every post write requires an `If-Match: <version>` header matching the current row version. If the version has changed since the client last fetched the post, the server returns:

```json
HTTP/1.1 409 Conflict
{ "error": "version_conflict", "current": { /* latest admin post object */ } }
```

This prevents two simultaneous admin sessions from silently overwriting each other's edits.

---

## 8. Draft / Live Separation

The engine stores two independent JSON blobs per post (`draft` and `live`). The public API (`toPublic()`) reads **exclusively from `live`**. The draft is never returned to unauthenticated callers except through an explicitly issued, time-limited preview token.

This means:
- An unpublished draft can never leak to visitors, even through the SSE stream.
- The SSE broadcast payload is built from `toPublic(row)` (the `live` snapshot) after the publish transaction commits.

---

## 9. Preview Tokens

| Property | Value |
|---|---|
| Algorithm | HMAC-SHA-256 with the session secret |
| Token structure | `base64url(postId + "." + exp) + "." + HMAC("preview:" + payload)` |
| TTL | 30 minutes |
| Scope | Tied to one specific post ID — cannot be used for any other post |
| Comparison | `crypto.timingSafeEqual` |

The preview endpoint (`GET /api/v1/preview/:id?token=...`) returns only the `draft` view — never the `live` data from other posts, never a list. A compromised token exposes one draft post for up to 30 minutes.

> **Known gap**: preview tokens are not rate-limited. Brute-forcing is computationally infeasible (256-bit HMAC space) but a per-IP rate limiter on `/api/v1/preview/*` would add cheap defence-in-depth.

---

## 10. SQL Injection Prevention

All database interactions use **prepared statements** (`db.prepare(...)`) from Node's built-in `node:sqlite`. No string interpolation is used in query bodies. The only dynamic SQL is in `store.listAdmin()` and `store.listPublic()`, where the `WHERE` clause is built by pushing strings into an array and joining with `AND` — no user input is interpolated into the query text itself; all values go through statement parameters.

The cursor in `listPublic` is decoded and validated against a strict regex before use:

```js
/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(publishedAt)  // ISO-8601 date
/^[0-9a-f-]{36}$/.test(id)                       // UUID
```

---

## 11. Known Limitations

| Limitation | Risk level | Notes |
|---|---|---|
| **Single admin password** | Medium | One shared credential for all admins. Phase 3 will add per-user roles. |
| **No multi-tab session invalidation** | Low | Logging out in one tab leaves other tabs active until the 8-hour cookie expires. |
| **Preview tokens not rate-limited** | Very low | 256-bit HMAC space makes brute-force infeasible; add a limiter for extra assurance. |
| **SSE hub in process memory** | Medium (multi-instance only) | Single-instance deployments are unaffected. See design.md §7. |
| **No automated browser test** | Low | Admin SPA and blog-live.js are syntax-checked and manually traced; no headless browser tests yet. |
| **SQLite single-writer** | Low (single-instance only) | WAL mode with 3 s busy timeout handles short contention. Multi-instance requires Postgres. |

---

## 12. Production Hardening Checklist

- [ ] Set a strong `ADMIN_PASSWORD` in `.env` (do not leave it auto-generated).
- [ ] Set `SESSION_SECRET` to a 32+ byte random hex string (do not use the auto-generated file in production).
- [ ] Set `PUBLIC_BASE_URL` to `https://...` so `Secure` is added to the session cookie.
- [ ] Set `TRUST_PROXY=1` only if behind a trusted reverse proxy.
- [ ] Set `SITE_ORIGINS` to your blog page origin to restrict public API CORS.
- [ ] Restrict `IMAGE_HOSTS` to only the domains you actually use.
- [ ] Put a reverse proxy (Caddy / Nginx) in front for TLS termination.
- [ ] Run under a process manager (`systemd`, `pm2`) with automatic restarts.
- [ ] Back up `DATA_DIR` regularly (`engine.db` + `uploads/`).
- [ ] Run `npm test` after any change to server code before deploying.
- [ ] Consider adding a rate limiter on `/api/v1/preview/*` if you expose preview links widely.
- [ ] Review `REAL_SITE_JWT_SECRET` and `REAL_SITE_AUTH_URL` carefully if using SSO — both extend the admin trust boundary to your main site's auth system.
