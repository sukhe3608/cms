# Blog Engine — Public & Admin API Reference

> Base URL (standalone): `http://localhost:8787`
> Base URL (embedded): depends on your Express mount path.
>
> All JSON responses use `Content-Type: application/json; charset=utf-8`.
> All error responses have shape `{ "error": "<code>", ... }`.

---

## Authentication

Admin endpoints require a session cookie (`be_session`) obtained from `POST /api/v1/auth/login` or `POST /api/v1/auth/sso`.

Mutating admin requests (POST / PATCH / DELETE) also require:
- `X-CSRF-Token: <csrf>` header — value from the login response or `GET /api/v1/auth/me`.
- The request `Origin` must match the engine's own origin (or the same `host`).

Alternatively, if the engine is embedded in an Express app with existing JWT middleware, requests that carry a valid `Authorization: Bearer <jwt>` or `accessToken` cookie are automatically accepted for admin routes (no separate blog login needed, provided `REAL_SITE_JWT_SECRET` is configured and `userTypeId === 2`).

---

## Public API

These endpoints are open to anyone. They only ever serve **published** posts.

CORS: If `SITE_ORIGINS` is empty (default), `Access-Control-Allow-Origin: *` is returned. If set, only listed origins receive CORS headers.

---

### `GET /api/v1/posts`

List published posts, newest first. Cursor-paginated.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `12` | Items per page (1–50) |
| `cursor` | string | — | Opaque cursor from a previous response's `nextCursor` |
| `category` | string | — | Filter by category key (see categories below) |

**Response `200`**

```json
{
  "items": [ /* Post objects */ ],
  "nextCursor": "base64url string or null",
  "seq": 42
}
```

`seq` is the current event log sequence number — pass it as `lastEventId` when opening the SSE stream to ensure no events are missed between the initial load and stream connect.

**Post object (public)**

```json
{
  "id":            "uuid",
  "slug":          "my-post-title",
  "title":         "My Post Title",
  "description":   "Short description.",
  "content":       "Full article body (may be empty string)",
  "category":      "rcs",
  "categoryLabel": "RCS",
  "imageUrl":      "https://blog-api.example.com/media/abc-card.webp",
  "imageAlt":      "Descriptive alt text",
  "author":        { "name": "SetuNxt Team" },
  "status":        "published",
  "version":       7,
  "publishedAt":   "2026-09-15T10:30:00.000Z"
}
```

**Supported categories**

| Key | Label |
|---|---|
| `rcs` | RCS |
| `strategy` | Strategy |
| `tutorials` | Tutorial |
| `case-study` | Case Study |
| `news` | News |
| `marketing` | Marketing |
| `dev` | API & Dev |

**Caching**: `Cache-Control: public, max-age=10, stale-while-revalidate=60`. `ETag` is returned; send `If-None-Match` for `304` responses.

---

### `GET /api/v1/posts/:slug`

Fetch a single published post by its slug.

**Response `200`** — same Post object shape as above.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `404` | `not_found` | No published post with that slug |

---

### `GET /api/v1/stream`

Open a Server-Sent Events stream for real-time updates.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `lastEventId` | integer | Seq of last received event (replay missed events on connect) |

Browsers also send `Last-Event-ID` as a header automatically on reconnect — both are supported.

**Events emitted**

| Event type | Data shape | Meaning |
|---|---|---|
| `post.published` | Public Post object | New post went live |
| `post.updated` | Public Post object | Published post was edited and re-published |
| `post.unpublished` | `{ id, slug, version }` | Post was taken offline |
| `resync` | `{}` | Client is too far behind — reload all posts |

**Keep-alive**: `:ka` comment sent every 25 s.
**Retry**: `retry: 5000` — EventSource auto-reconnects after 5 s.

---

### `GET /api/v1/preview/:id?token=<token>`

Fetch a single **draft** post for token-gated preview. Used by the admin app's iframe and `blog-live.js` preview mode.

**Query parameters**

| Param | Required | Description |
|---|---|---|
| `token` | Yes | HMAC preview token issued by `POST /api/v1/admin/posts/:id/preview-token` |

**Response `200`** — same shape as a public Post object but with `"status": "preview"`. Built from `draft` (not `live`).

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `403` | `invalid_or_expired_token` | Token is wrong, forged, or expired (30-minute TTL) |
| `404` | `not_found` | Post ID does not exist |

---

### `GET /healthz`

```json
{ "ok": true, "seq": 42, "streams": 3 }
```

`streams` is the number of active SSE connections. Used by process managers and load-balancer health checks.

---

## Auth Endpoints

---

### `POST /api/v1/auth/login`

```json
{ "username": "admin", "password": "hunter2" }
```

`username` can be a username or email address. Also accepted: `userName`, `email`.

**Response `200`**

```json
{
  "ok": true,
  "csrf": "32-char hex token",
  "user": {
    "id": "uuid",
    "username": "admin",
    "name": "Admin",
    "role": "admin",
    "userTypeId": 2
  }
}
```

A `Set-Cookie: be_session=...; HttpOnly; SameSite=Lax` header is also returned. Session TTL: **8 hours**.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `401` | `invalid_credentials` | Wrong username or password |
| `429` | `too_many_attempts` | 5+ failures in 15 min from this IP. `retryAfter` seconds in body. |

---

### `POST /api/v1/auth/sso`

Exchange your main site's access token for a blog admin session. Requires `REAL_SITE_JWT_SECRET` to be configured.

```json
{ "token": "<jwt>" }
```

Or send `Authorization: Bearer <jwt>` header instead of the body field.

**Response `200`** — same shape as `/login`.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `400` | `token_required` | No token provided |
| `403` | `invalid_or_unauthorized_token` | JWT invalid, expired, or `userTypeId !== 2` |

---

### `GET /api/v1/auth/me`

Returns the current session state. No credentials needed — use to bootstrap the admin UI or check if already logged in.

**Response `200` (authenticated)**

```json
{
  "authenticated": true,
  "csrf": "32-char hex token",
  "user": { "id": "...", "username": "...", "name": "...", "role": "admin", "userTypeId": 2 }
}
```

**Response `200` (not authenticated)**

```json
{ "authenticated": false }
```

---

### `POST /api/v1/auth/logout`

Clears the session cookie. No body required. Returns `{ "ok": true }`.

---

## Admin API

All admin endpoints require authentication (see above). All mutating endpoints require `X-CSRF-Token`.

---

### `GET /api/v1/admin/config`

Returns engine configuration useful for the admin UI.

```json
{
  "siteUrl": "https://yoursite.com/blog.html",
  "categories": { "rcs": "RCS", ... },
  "maxUploadBytes": 5242880,
  "imageOptimization": true
}
```

---

### `GET /api/v1/admin/posts`

List all posts visible to admin.

**Query parameters**

| Param | Default | Description |
|---|---|---|
| `status` | `all` | Filter: `all` / `draft` / `published` / `archived` |

**Response `200`**

```json
{ "items": [ /* Admin Post objects */ ] }
```

**Admin Post object**

```json
{
  "id":                    "uuid",
  "slug":                  "my-post",
  "status":                "draft",
  "version":               3,
  "liveVersion":           2,
  "draft":                 { /* full draft fields */ },
  "live":                  { /* full live fields, or null if never published */ },
  "hasUnpublishedChanges": true,
  "createdAt":             "2026-09-01T08:00:00.000Z",
  "updatedAt":             "2026-09-10T12:00:00.000Z",
  "publishedAt":           "2026-09-05T09:00:00.000Z"
}
```

---

### `GET /api/v1/admin/posts/:id`

Fetch a single post by UUID (admin view).

**Errors**: `404 not_found`.

---

### `POST /api/v1/admin/posts`

Create a new draft post.

**Request body** (all fields optional on creation)

```json
{
  "title":       "My New Post",
  "description": "Short intro.",
  "content":     "Full article body (up to 50,000 chars).",
  "category":    "rcs",
  "imageUrl":    "https://blog-api.example.com/media/abc-card.webp",
  "imageAlt":    "Descriptive alt text",
  "author":      "SetuNxt Team"
}
```

**Response `201`** — Admin Post object.

**Validation errors**: `422 validation_failed` with `{ fields: { fieldName: "message" } }`.

---

### `PATCH /api/v1/admin/posts/:id`

Save a draft. Sends only changed fields (sparse patch — missing keys are left unchanged).

**Required header**: `If-Match: <version>` (integer or quoted integer).

```json
{ "title": "Updated Title" }
```

**Response `200`** — updated Admin Post object.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `409` | `version_conflict` | Another save happened first. Response includes `current` admin post object. |
| `409` | `archived` | Archived posts cannot be edited. |
| `422` | `validation_failed` | Field validation failed (`fields` object in response). |
| `428` | `if_match_required` | `If-Match` header was missing. |

---

### `POST /api/v1/admin/posts/:id/publish`

Publish the current draft. Copies `draft` → `live` atomically, emits `post.published` or `post.updated` SSE event.

**Required header**: `If-Match: <version>`

**Response `200`** — updated Admin Post object.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `409` | `nothing_to_publish` | `draft === live` (no unpublished changes) |
| `409` | `archived` | Cannot publish an archived post |
| `422` | `validation_failed` | Publish-time requirements not met (title, description, imageUrl) |

---

### `POST /api/v1/admin/posts/:id/unpublish`

Take a post offline (sets status back to `draft`). Emits `post.unpublished` SSE event.

**Required header**: `If-Match: <version>`

**Response `200`** — updated Admin Post object.

**Errors**: `409 not_published`.

---

### `DELETE /api/v1/admin/posts/:id`

Soft-delete (archive) a post. The slug is permanently reserved. If the post was published, emits `post.unpublished` SSE event.

**Required header**: `If-Match: <version>`

**Response `200`** — Admin Post object with `status: "archived"`.

**Errors**: `409 archived` (already archived).

---

### `POST /api/v1/admin/posts/:id/preview-token`

Issue a short-lived preview token for the post (30 minutes, scoped to this post ID only).

**Response `200`**

```json
{
  "token":     "base64url.HMAC",
  "url":       "https://yoursite.com/blog.html?preview=<id>&token=<token>",
  "expiresIn": 1800
}
```

---

### `POST /api/v1/admin/uploads`

Upload an image. Body must be the raw image bytes (no multipart form).

**Headers required**

```
Content-Type: image/jpeg   (or image/png or image/webp)
X-CSRF-Token: <csrf>
```

**Response `201`**

```json
{
  "imageUrl":   "/media/abc123-card.webp",
  "featureUrl": "/media/abc123-feature.webp",
  "optimized":  true,
  "bytes":      204800
}
```

`optimized: false` means `sharp` is not installed — the original file was stored unchanged.

**Errors**

| Status | Error code | Meaning |
|---|---|---|
| `400` | `empty_upload` | Zero-byte body |
| `413` | `payload_too_large` | Exceeds `MAX_UPLOAD_MB` |
| `415` | `unsupported_image` | Not JPEG / PNG / WebP (detected from file bytes, not Content-Type) |
| `422` | `invalid_image` | File bytes claim to be an image but sharp cannot decode it |

---

### `GET /api/v1/admin/users`

List all admin user accounts stored in the local database.

```json
{ "users": [ { "id": "...", "username": "...", "name": "...", "email": "...", "role": "admin", "created_at": "...", "updated_at": "..." } ] }
```

---

## Media Files

### `GET /media/:file`

Serve an uploaded image. Filename must match `[a-f0-9]{32}-(card|feature|orig).(webp|jpg|png)`.

- `Cache-Control: public, max-age=31536000, immutable`
- `Cross-Origin-Resource-Policy: cross-origin`
- `Content-Security-Policy: default-src 'none'`

---

## Admin Static Assets

| Route | File | Notes |
|---|---|---|
| `GET /admin` or `/admin/` | `admin/index.html` | Full CSP header |
| `GET /admin/app.js` | `admin/app.js` | `no-cache` |
| `GET /admin/app.css` | `admin/app.css` | `no-cache` |
| `GET /` | — | Redirects `302` to `/admin` |

---

## Common Error Shape

```json
{
  "error": "snake_case_code",
  "message": "Human-readable explanation (sometimes omitted)",
  "fields": { "fieldName": "Validation message" }
}
```

`fields` is only present on `422 validation_failed` responses.
`retryAfter` (seconds) is present on `429 too_many_attempts`.
