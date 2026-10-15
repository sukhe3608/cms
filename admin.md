# Blog Engine — Admin SPA Reference

> The admin interface served at `/admin`. A single-page app written in plain HTML + CSS + vanilla JS. No framework, no build step, no npm install needed for it to work.

---

## 1. Files

| File | Size | Role |
|---|---|---|
| `admin/index.html` | ~33 KB | Full SPA shell — all markup and DOM IDs live here |
| `admin/app.js` | ~43 KB | All logic — auth, list, editor, preview, image upload |
| `admin/app.css` | ~40 KB | All styles — layout, dark-mode tokens, responsive breakpoints |

All three files are served by the engine at `/admin`, `/admin/app.js`, and `/admin/app.css` with `Cache-Control: no-cache` so changes are picked up instantly on refresh.

---

## 2. Application State

`admin/app.js` keeps a single top-level `state` object:

```js
const state = {
  csrf: null,           // CSRF token from the server (required on every mutating request)
  posts: [],            // Cached list of Admin Post objects
  current: null,        // The post currently open in the editor
  categories: {},       // { rcs: 'RCS', strategy: 'Strategy', ... }
  siteUrl: '',          // SITE_URL from config (used to build preview link)
  previewToken: null,   // Active preview token for the site-preview iframe
  previewFrameReady: false,
  searchQuery: '',
  user: null,           // { id, username, name, role, userTypeId }
  activeView: 'posts',  // 'posts' | 'editor' | 'preview'  (mobile nav)
  deviceMode: 'desktop',// 'mobile' | 'tablet' | 'desktop' (preview viewport)
  previewTab: 'card',   // 'card' (built-in mock) | 'site' (real blog iframe)
  sidebarCollapsed: false,
};
```

---

## 3. Layout — Three-Panel Design

```
┌──────────────────────────────────────────────────────────┐
│  Header: logo · view switcher · site link · user badge   │
├─────────────┬────────────────────┬───────────────────────┤
│  Sidebar    │     Editor         │    Preview Panel      │
│  (post list)│  (form + toolbar)  │  Card mock / iframe   │
│             │                    │                       │
│  filter     │  title             │  [Card] [Site] tabs   │
│  search     │  description       │                       │
│  post items │  content (markdown)│  device switcher      │
│             │  category          │  (mobile/tablet/desk) │
│             │  author            │                       │
│             │  image dropzone    │                       │
└─────────────┴────────────────────┴───────────────────────┘
         mobile bottom nav: Posts | Editor | Preview
```

On **mobile** (≤768 px), the three panels become a tab-switcher controlled by the bottom nav bar and the "Back" / "Preview" buttons in the editor toolbar. The segment nav in the header becomes the three-tab row.

On **desktop**, all three panels are visible simultaneously. The sidebar can be collapsed with a toggle button.

---

## 4. Boot Sequence

```
DOMContentLoaded
  └── checkSession()
        │ GET /api/v1/auth/me
        ├── authenticated? → showApp()
        │     ├── GET /api/v1/admin/config   (categories, siteUrl, upload limits)
        │     └── loadList()                 (GET /api/v1/admin/posts?status=all)
        └── not authenticated? → showLogin()
```

If the URL contains `?sso=<token>` or `?token=<token>`, `checkSession()` tries `POST /api/v1/auth/sso` first before falling back to the normal session check. This supports deep-linking from your main site's admin dashboard.

---

## 5. Post List

- **Filter dropdown**: `all` / `draft` / `published` / `archived` — triggers `GET /api/v1/admin/posts?status=<value>`.
- **Search box**: client-side filter on `title`, `author`, and `category`. No extra API call.
- **Post item badges**: `Draft` (grey), `Published` (green), `Unpublished edits` (amber), `Archived` (dark).
- **Clicking a post** calls `openPost(id)` → `GET /api/v1/admin/posts/:id` → fills the editor form.
- **"New Post" button**: `POST /api/v1/admin/posts` with empty fields → opens the new draft immediately.

---

## 6. Editor Form

### Fields

| Field | Input type | Limit |
|---|---|---|
| Title | `<input>` | 3–140 chars. Character counter + color meter. |
| Description | `<textarea>` | ≤400 chars. Character counter + color meter. |
| Article Content | `<textarea>` | ≤50,000 chars. Markdown. Word count shown. |
| Category | `<select>` | One of the 7 category keys from the engine. |
| Author | `<input>` | 2–60 chars. |
| Image | Dropzone / URL field | See §8 below. |
| Image Alt Text | `<input>` | ≤160 chars. |

### Auto-save

Every `input` or `change` event on the form schedules a `saveDraft()` call 600 ms later (debounced). `saveDraft()` calls:

```
PATCH /api/v1/admin/posts/:id
  If-Match: <current version>
  X-CSRF-Token: <csrf>
  Content-Type: application/json

{ title, description, content, category, author, imageAlt, imageUrl }
```

If the response is `409 version_conflict`, the conflict banner appears with two options:
- **Load their version** — discards local edits, loads the server's current copy.
- **Keep mine** — bumps the local version to match the server's and re-saves over it.

If the response is `422 validation_failed`, inline error messages appear under each failing field. `aria-invalid` is set for screen-reader accessibility.

### Markdown Toolbar

Buttons for **Bold**, *Italic*, H2, H3, bullet list, blockquote, link. Each inserts syntax at the cursor position (or wraps the current selection). The toolbar is plain DOM manipulation — no Markdown library dependency.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Publish / Publish changes |
| (auto-save) | Triggers 600 ms after any edit |

---

## 7. Publish / Unpublish / Archive

All three actions require `If-Match: <version>` and `X-CSRF-Token`.

| Button | Endpoint | Notes |
|---|---|---|
| **Publish** | `POST /api/v1/admin/posts/:id/publish` | On `409 nothing_to_publish`, shows "Nothing new to publish" toast. On `422`, shows field errors. |
| **Publish changes** | Same endpoint | Label changes when post is already published with unsaved edits. |
| **Unpublish** | `POST /api/v1/admin/posts/:id/unpublish` | Shows confirmation modal first. |
| **Archive** | `DELETE /api/v1/admin/posts/:id` | Shows confirmation modal. Fields are disabled after archiving. |

---

## 8. Image Upload

The image dropzone accepts:
- **Drag & drop** — any image file dragged onto the dropzone area.
- **File picker** — clicking the dropzone opens a file input.
- **URL input** — typing or pasting a URL from an allowed host (configured via `IMAGE_HOSTS`).

On drop/select, the file is sent as a raw binary body:

```
POST /api/v1/admin/uploads
Content-Type: <file.type>
X-CSRF-Token: <csrf>
<binary body>
```

On success, `imageUrl` in the form is updated automatically, the preview thumbnail updates, and the draft is auto-saved.

---

## 9. Preview Panel

The preview panel has two tabs:

### Card Preview (built-in mock)

A high-fidelity replica of the actual blog card rendered inline in the admin. Updates instantly as you type — no network request needed. Shows title, description, category tag, author initials, and image.

### Site Preview (iframe)

When this tab is active, `startPreview(postId)` is called:

1. Issues a preview token: `POST /api/v1/admin/posts/:id/preview-token`.
2. Opens `SITE_URL?preview=<id>&token=<token>` in a sandboxed `<iframe>`.
3. As the editor detects `input`/`change` events, `pushPreview()` sends the current draft to the iframe via `postMessage({ type: 'be:preview', post: {...}, token, id })`.
4. `blog-live.js` running in the iframe receives this message and immediately re-renders the preview card.
5. If `postMessage` is missed, `blog-live.js` polls `/api/v1/preview/:id?token=...` every 4 s as a fallback.

The iframe also has **device mode** buttons (Mobile / Tablet / Desktop) that change the `<iframe>` wrapper's `width` to simulate responsive breakpoints.

A separate **"Open in tab"** button opens the same preview URL in a new browser tab.

---

## 10. Article Detail Preview

The **"Preview article"** button (article icon in the toolbar) opens a new browser tab with a fully rendered article page generated entirely client-side from the current draft fields. This page:

- Uses `escapeHtml()` to sanitize all user-supplied values before inserting into `innerHTML`.
- Renders `content` field markdown as basic `<p>`, `<h2>`, `<h3>`, `<ul>`, and `<blockquote>` blocks.
- Falls back to generated filler content if `content` is empty.
- Matches the SetuNxt article page styling with Inter + Plus Jakarta Sans fonts.

---

## 11. Status Indicators

The editor header shows a status badge that updates after every save:

| State | Badge text | Colour |
|---|---|---|
| Saved draft | `Draft` | Grey |
| Published, no changes | `Published` | Green |
| Published, unsaved edits | `Unpublished edits` | Amber |
| Archived | `Archived` | Dark grey |

The post list sidebar shows the same badges on each item.

---

## 12. Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `> 1280 px` | Three columns. Sidebar collapsible. |
| `768–1280 px` | Two columns (sidebar + editor). Preview panel hidden until "Preview" tab clicked. |
| `≤ 768 px` | Single column. Bottom nav bar switches between Posts / Editor / Preview. Editor bar has Back and Preview buttons. |

---

## 13. HTTP Helper Pattern

All API calls go through two helpers:

```js
// General requests (no versioning)
api(method, path, body)
// → fetch with CSRF header, throws typed errors with .status and .data

// Versioned mutations (require If-Match)
apiVersioned(method, path, version, body)
// → same as above but adds If-Match: <version>
```

Both set `credentials: 'same-origin'` so the `be_session` cookie is always included.
