# blog.html — one-line change

No structural or style changes. Line 437 of your `blog.html` currently reads:

```html
<script src="assets/js/blog.js"></script>
</body>
```

Replace `assets/js/blog.js` with the patched copy (see `blog.js` and `CHANGES.md`
in this folder), and add `blog-live.js` right after it:

```html
<script src="assets/js/blog.js"></script>
<script>window.BLOG_ENGINE_API = 'https://your-engine-domain.example/api/v1';</script>
<script src="assets/js/blog-live.js"></script>
</body>
```

Order matters: `blog.js` must load first (it defines the filter/search/bookmark/
article-open behavior that the engine's cards reuse), `blog-live.js` loads second
and takes over `#grid` and `#loadMore` once its first API call succeeds.

Set `window.BLOG_ENGINE_API` to wherever you deploy the engine. If you don't set
it, `blog-live.js` defaults to `http://localhost:8787/api/v1` for local testing.

Nothing else in `blog.html` needs to change. The 10 hardcoded `<article class="card">`
blocks in `#grid` can stay exactly where they are — they act as the offline fallback
if the engine is ever unreachable, and `blog-live.js` seamlessly replaces them the
moment its first request succeeds. `npm run seed` (see the main README) loads the
same 10 posts into the engine's database so there's no visible change on first deploy.
