/**
 * blog-live.js — connects blog.html to the blog engine API.
 *
 * Loads after blog.js. Uses the SAME class names blog.js/blog.css already
 * define (.card, .card-img, .c-tag, .card-body, .card-foot, .av-xs, .cf-date,
 * #toast...), so no CSS file needs to change and blog.js's existing filter,
 * search, bookmark and reveal logic keeps working on these cards untouched.
 *
 * Requires: patched blog.js from site-patches/ (removes the old hardcoded
 * `extra` Load More data and its click handler — this file replaces both).
 */
(() => {
  'use strict';

  // ---- configure this for your deployment ----
  const API = window.BLOG_ENGINE_API || 'http://localhost:8787/api/v1';
  // ---------------------------------------------

  const grid = document.getElementById('grid');
  const lmBtn = document.getElementById('loadMore');
  if (!grid) return; // not on a page with the blog grid

  const CATS = { rcs: 'RCS', strategy: 'Strategy', tutorials: 'Tutorial', 'case-study': 'Case Study', news: 'News', marketing: 'Marketing', dev: 'API & Dev' };
  const AV_CLASSES = ['av-blue', 'av-orange', 'av-teal', 'av-purple', 'av-pink', 'av-indigo'];
  const BM_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  const CAL_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const SPIN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';
  const DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  const MORE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  const SPARKLE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name).trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const avClass = (name) => AV_CLASSES[[...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AV_CLASSES.length];
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };

  // Reuses the site's own #toast markup and CSS (blog.css .toast / .toast.on) — no new styles.
  function toast(icon, msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    const ti = document.getElementById('toastIco'); const tm = document.getElementById('toastMsg');
    if (ti) ti.innerHTML = icon;
    if (tm) tm.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._liveT);
    t._liveT = setTimeout(() => t.classList.remove('on'), 3200);
  }

  // Same card markup shape blog.js itself uses for its (now removed) Load More cards,
  // so blog.js's existing filter/search/bookmark/article-open logic needs no changes.
  function cardHtml(p, { animDelay = 0, preview = false } = {}) {
    return `<div class="card-img">
        <img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt || p.title)}" loading="lazy">
        <div class="img-overlay"></div>
        <span class="c-tag">${esc(p.categoryLabel || CATS[p.category] || p.category)}</span>
        ${preview ? '' : `<button class="bm-btn" title="Bookmark">${BM_SVG}</button>`}
      </div>
      <div class="card-body">
        <h3>${esc(p.title)}</h3>
        <p class="c-desc">${esc(p.description)}</p>
        <div class="card-foot">
          <div class="cf-author"><div class="av-xs ${avClass(p.author.name)}">${esc(initials(p.author.name))}</div><span class="av-n">${esc(p.author.name)}</span></div>
          <span class="cf-date">${CAL_SVG} ${esc(fmtDate(p.publishedAt))}</span>
        </div>
      </div>`;
  }

  function makeCardEl(p, opts) {
    const el = document.createElement('article');
    // Deliberately no "reveal" class: blog.js's IntersectionObserver only runs once at
    // load, so a later "reveal" element would stay at opacity:0 forever. See blog.js's
    // own (removed) Load More code, which followed the same rule.
    el.className = 'card';
    el.dataset.cat = p.category;
    el.dataset.id = p.id;
    el.dataset.v = String(p.version);
    // Store content for article detail view (read by blog.js getCardArticleData)
    if (p.content) el.dataset.content = p.content;
    if (opts && opts.animDelay !== undefined) el.style.animation = `fadeUp .6s ease ${opts.animDelay}s both`;
    if (opts && opts.preview) { el.style.outline = '3px solid #F7941D'; el.style.outlineOffset = '4px'; el.style.borderRadius = '18px'; }
    el.innerHTML = cardHtml(p, opts);
    return el;
  }

  function findCard(id) { return grid.querySelector(`[data-id="${CSS.escape(id)}"]`); }

  // Keeps a just-inserted/updated card consistent with whatever filter or search is
  // currently active, so a live update can't silently ignore the visitor's own filter.
  function applyActiveView(el) {
    const onBtn = document.querySelector('.f-btn.on');
    const cat = onBtn ? onBtn.dataset.cat : 'all';
    const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const matchesCat = cat === 'all' || el.dataset.cat === cat;
    const matchesQuery = !q || el.textContent.toLowerCase().includes(q);
    el.style.display = matchesCat && matchesQuery ? '' : 'none';
  }

  function upsertPost(p) {
    const existing = findCard(p.id);
    if (existing && Number(existing.dataset.v) >= p.version) return; // idempotent: ignore stale/replayed events
    const el = makeCardEl(p, {});
    if (existing) existing.replaceWith(el); else grid.prepend(el);
    applyActiveView(el);
  }

  function removePost(id) { findCard(id)?.remove(); }

  // ---------- initial load ----------
  let nextCursor = null;
  let rendered = false;

  async function fetchPosts(cursor) {
    const url = new URL(`${API}/posts`);
    url.searchParams.set('limit', '9');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`posts ${res.status}`);
    return res.json();
  }

  async function initialLoad() {
    let page;
    try { page = await fetchPosts(); }
    catch { return false; } // leave the static fallback cards in blog.html untouched
    grid.innerHTML = '';
    page.items.forEach((p, i) => grid.appendChild(makeCardEl(p, { animDelay: i * 0.05 })));
    nextCursor = page.nextCursor;
    rendered = true;
    updateLoadMoreButton();
    return true;
  }

  function updateLoadMoreButton() {
    if (!lmBtn) return;
    lmBtn.classList.remove('loading');
    if (nextCursor) { lmBtn.disabled = false; lmBtn.classList.remove('done'); lmBtn.innerHTML = `${MORE_SVG} Load More Articles`; }
    else { lmBtn.disabled = true; lmBtn.classList.add('done'); lmBtn.innerHTML = `${DONE_SVG} All Articles Loaded`; }
  }

  if (lmBtn) {
    lmBtn.addEventListener('click', async () => {
      if (!rendered || !nextCursor || lmBtn.classList.contains('loading')) return;
      lmBtn.classList.add('loading');
      lmBtn.innerHTML = `${SPIN_SVG} Loading...`;
      try {
        const page = await fetchPosts(nextCursor);
        const start = grid.children.length;
        page.items.forEach((p, i) => grid.appendChild(makeCardEl(p, { animDelay: i * 0.12 })));
        nextCursor = page.nextCursor;
        toast(SPARKLE_SVG, 'New articles loaded successfully!');
      } catch {
        toast(BM_SVG, "Couldn't load more articles — try again.");
      } finally {
        updateLoadMoreButton();
      }
    });
  }

  // ---------- real-time updates ----------
  let es = null;
  let pollTimer = null;

  function startPolling() {
    stopStream();
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try { (await fetchPosts()).items.forEach(upsertPost); } catch { /* try again next tick */ }
    }, 45000);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  function startStream() {
    stopPolling();
    try { es = new EventSource(`${API}/stream`); } catch { startPolling(); return; }
    es.addEventListener('post.published', (e) => upsertPost(JSON.parse(e.data)));
    es.addEventListener('post.updated', (e) => upsertPost(JSON.parse(e.data)));
    es.addEventListener('post.unpublished', (e) => removePost(JSON.parse(e.data).id));
    es.addEventListener('resync', () => { rendered = false; initialLoad(); });
    es.onopen = stopPolling;
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) startPolling(); }; // EventSource auto-retries otherwise
  }
  function stopStream() { if (es) { es.close(); es = null; } }

  // ---------- preview mode (used by the admin app's live-preview iframe) ----------
  // Renders ONE extra, outlined card for the draft named in the URL. Only ever active
  // in a page opened with a short-lived, single-post signed token — nothing here can
  // affect what other visitors see.
  async function startPreview(id, token) {
    async function refresh() {
      try {
        const res = await fetch(`${API}/preview/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const p = await res.json();
        const el = makeCardEl(p, { preview: true });
        const old = document.querySelector('[data-preview-id]');
        el.dataset.previewId = id;
        old ? old.replaceWith(el) : grid.prepend(el);
      } catch { /* keep showing the last good preview */ }
    }
    await refresh();
    // Instant updates while the author types, pushed by the admin app via postMessage;
    // falls back to this poll if the message channel is ever missed.
    setInterval(refresh, 4000);
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'be:preview' || e.data.token !== token || e.data.id !== id) return;
      const el = makeCardEl(e.data.post, { preview: true });
      const old = document.querySelector('[data-preview-id]');
      el.dataset.previewId = id;
      old ? old.replaceWith(el) : grid.prepend(el);
    });
  }

  // ---------- boot ----------
  const params = new URLSearchParams(location.search);
  const previewId = params.get('preview');
  const previewToken = params.get('token');
  if (previewId && previewToken) {
    startPreview(previewId, previewToken); // preview tabs don't take over the whole grid
  } else {
    initialLoad().then((ok) => { if (ok) startStream(); });
  }
})();
