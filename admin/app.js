(() => {
  'use strict';

  const API = '/api/v1';
  const $ = (id) => document.getElementById(id);

  const state = {
    csrf: null,
    posts: [],
    current: null,
    categories: {},
    siteUrl: '',
    previewToken: null,
    previewFrameReady: false,
    searchQuery: '',
    user: null,
    // Responsive view: 'posts' | 'editor' | 'preview'
    activeView: 'posts',
    // Device preview mode: 'mobile' | 'tablet' | 'desktop'
    deviceMode: 'desktop',
    // Preview tab: 'card' | 'site'
    previewTab: 'card',
    // Sidebar collapsed on desktop
    sidebarCollapsed: false,
  };

  // ==========================================================================
  //  Fetch Helpers
  // ==========================================================================
  async function api(method, path, body) {
    const headers = {};
    if (state.csrf && method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(API + path, { method, headers, body: payload, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const apiVersioned = (method, path, version, body) =>
    fetch(API + path, {
      method, credentials: 'same-origin',
      headers: {
        'X-CSRF-Token': state.csrf,
        'If-Match': String(version),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch { /* no body */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    });

  // ==========================================================================
  //  Toast Notifications
  // ==========================================================================
  let toastTimer;
  function toast(msg, type = 'info') {
    const t = $('toast');
    if (!t) return;
    const icons = {
      ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };
    t.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(msg)}</span>`;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }

  // ==========================================================================
  //  Confirmation Modal
  // ==========================================================================
  let modalResolver = null;
  function confirmModal(title, msg, confirmText = 'Confirm', isDanger = true) {
    return new Promise((resolve) => {
      modalResolver = resolve;
      $('modalTitle').textContent = title;
      $('modalMessage').textContent = msg;
      const cBtn = $('modalConfirmBtn');
      cBtn.textContent = confirmText;
      if (isDanger) {
        cBtn.className = 'btn primary danger';
        $('modalIconWrap').style.background = '#fee2e2';
        $('modalIconWrap').style.color = '#dc2626';
      } else {
        cBtn.className = 'btn primary';
        $('modalIconWrap').style.background = '#eff6ff';
        $('modalIconWrap').style.color = '#1e5ba3';
      }
      $('confirmModal').hidden = false;
      cBtn.focus();
    });
  }

  $('modalCancelBtn').addEventListener('click', () => {
    $('confirmModal').hidden = true;
    if (modalResolver) { modalResolver(false); modalResolver = null; }
  });
  $('modalConfirmBtn').addEventListener('click', () => {
    $('confirmModal').hidden = true;
    if (modalResolver) { modalResolver(true); modalResolver = null; }
  });
  $('confirmModal').addEventListener('click', (e) => {
    if (e.target === $('confirmModal')) {
      $('confirmModal').hidden = true;
      if (modalResolver) { modalResolver(false); modalResolver = null; }
    }
  });

  // ==========================================================================
  //  Responsive View Management (Desktop Segmented / Mobile Tab)
  // ==========================================================================
  function setActiveView(view) {
    state.activeView = view;
    const shell = $('shell');
    if (!shell) return;

    // Remove all view classes and apply the new one
    shell.classList.remove('view-posts', 'view-editor', 'view-preview');
    shell.classList.add(`view-${view}`);

    // Sync header segmented nav
    ['tabViewPosts', 'tabViewEditor', 'tabViewPreview'].forEach((id) => {
      const btn = $(id);
      if (btn) btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Sync mobile bottom nav
    ['mobileNavPosts', 'mobileNavEditor', 'mobileNavPreview'].forEach((id) => {
      const btn = $(id);
      if (btn) btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Update mobile bar title if entering editor
    if (view === 'editor' && state.current) {
      updateMobileBarTitle();
    }
  }

  // Desktop segmented nav
  $('viewSwitcher') && $('viewSwitcher').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-segment-btn');
    if (btn && btn.dataset.view) setActiveView(btn.dataset.view);
  });

  // Mobile bottom nav
  $('mobileBottomNav') && $('mobileBottomNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.mobile-nav-btn');
    if (btn && btn.dataset.view) setActiveView(btn.dataset.view);
  });

  // Mobile back button in editor bar
  $('mobileBackBtn') && $('mobileBackBtn').addEventListener('click', () => setActiveView('posts'));

  // Mobile "Preview" button inside editor bar
  $('editorPreviewBtn') && $('editorPreviewBtn').addEventListener('click', () => setActiveView('preview'));

  function updateMobileBarTitle() {
    const el = $('mobilePostTitlePreview');
    if (!el) return;
    const title = state.current ? ($('title') && $('title').value.trim()) || 'Untitled post' : 'Post Editor';
    el.textContent = title.length > 28 ? title.slice(0, 25) + '…' : title;
  }

  // Sidebar toggle (desktop)
  $('toggleSidebarBtn') && $('toggleSidebarBtn').addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    const shell = $('shell');
    if (shell) shell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  });

  // ==========================================================================
  //  Device Preview Mode (Mobile / Tablet / Desktop)
  // ==========================================================================
  function setDeviceMode(mode) {
    state.deviceMode = mode;
    const container = $('previewViewportContainer');
    if (container) {
      container.classList.remove('mode-mobile', 'mode-tablet', 'mode-desktop');
      container.classList.add(`mode-${mode}`);
    }
    ['deviceMobile', 'deviceTablet', 'deviceDesktop'].forEach((id) => {
      const btn = $(id);
      if (btn) {
        const btnMode = id.replace('device', '').toLowerCase();
        btn.classList.toggle('active', btnMode === mode);
      }
    });
  }

  $('deviceMobile') && $('deviceMobile').addEventListener('click', () => setDeviceMode('mobile'));
  $('deviceTablet') && $('deviceTablet').addEventListener('click', () => setDeviceMode('tablet'));
  $('deviceDesktop') && $('deviceDesktop').addEventListener('click', () => setDeviceMode('desktop'));

  // ==========================================================================
  //  Auth
  // ==========================================================================
  async function checkSession() {
    try {
      const url = new URL(window.location.href);
      const sso = url.searchParams.get('sso') || url.searchParams.get('token');
      if (sso) {
        url.searchParams.delete('sso');
        url.searchParams.delete('token');
        window.history.replaceState({}, document.title, url.pathname + (url.search || ''));
        try {
          const res = await api('POST', '/auth/sso', { token: sso });
          state.csrf = res.csrf;
          state.user = res.user || null;
          renderUserBadge();
          showApp();
          return;
        } catch (err) {
          toast((err.data && err.data.message) || 'SSO authentication failed.', 'warn');
        }
      }
      const me = await api('GET', '/auth/me');
      if (me.authenticated) {
        state.csrf = me.csrf;
        state.user = me.user || null;
        renderUserBadge();
        showApp();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  function renderUserBadge() {
    if (!state.user) return;
    const name = state.user.name || state.user.username || 'Admin';
    if ($('userName')) $('userName').textContent = name;
    if ($('userRole')) $('userRole').textContent = state.user.role || 'admin';
    if ($('userAvatar')) $('userAvatar').textContent = (name[0] || 'A').toUpperCase();
    if ($('userBadge')) $('userBadge').title = `Logged in as ${name} (@${state.user.username || 'admin'})`;
  }

  function showLogin() {
    $('login').hidden = false;
    $('app').hidden = true;
    if ($('username') && !$('username').value) $('username').focus();
    else $('password').focus();
  }

  async function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    setActiveView('posts');
    try {
      const cfg = await api('GET', '/admin/config');
      state.categories = cfg.categories || {};
      state.siteUrl = cfg.siteUrl || '';
      $('openSite').href = cfg.siteUrl || '#';
      $('headerSiteLink').href = cfg.siteUrl || '#';

      $('category').innerHTML = '';
      for (const [value, label] of Object.entries(state.categories)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        $('category').appendChild(opt);
      }
      await loadList();
    } catch (err) {
      toast('Failed to load studio configuration.', 'warn');
    }
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    const submitBtn = $('loginSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'Signing in…';
    try {
      const username = $('username') ? $('username').value.trim() : '';
      const password = $('password').value;
      const r = await api('POST', '/auth/login', { username, password });
      state.csrf = r.csrf;
      state.user = r.user || null;
      renderUserBadge();
      $('password').value = '';
      showApp();
    } catch (err) {
      $('loginError').textContent = err.status === 429
        ? 'Too many attempts. Please wait a bit and try again.'
        : (err.data && err.data.message) || 'Invalid username or password.';
      $('password').select();
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn-text').textContent = 'Sign in to Studio';
    }
  });

  $('togglePasswordBtn').addEventListener('click', () => {
    const pw = $('password');
    const isPw = pw.type === 'password';
    pw.type = isPw ? 'text' : 'password';
    $('togglePasswordBtn').setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
  });

  $('logout').addEventListener('click', async () => {
    try { await api('POST', '/auth/logout'); } catch { /* ignore */ }
    state.csrf = null;
    state.current = null;
    showLogin();
  });

  // ==========================================================================
  //  Post List, Search & Filter
  // ==========================================================================
  async function loadList() {
    const status = $('filter').value;
    try {
      const { items } = await api('GET', `/admin/posts?status=${status}`);
      state.posts = items;
      renderList();
    } catch (err) {
      toast('Could not fetch post list.', 'warn');
    }
  }

  $('filter').addEventListener('change', loadList);

  $('postSearch').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    $('clearSearch').hidden = !state.searchQuery;
    renderList();
  });

  $('clearSearch').addEventListener('click', () => {
    $('postSearch').value = '';
    state.searchQuery = '';
    $('clearSearch').hidden = true;
    $('postSearch').focus();
    renderList();
  });

  function renderList() {
    const ul = $('posts');
    ul.innerHTML = '';

    const q = state.searchQuery;
    const filtered = state.posts.filter((p) => {
      if (!q) return true;
      const title = (p.draft.title || '').toLowerCase();
      const author = (p.draft.author || '').toLowerCase();
      const cat = (state.categories[p.draft.category] || p.draft.category || '').toLowerCase();
      return title.includes(q) || author.includes(q) || cat.includes(q);
    });

    $('listEmpty').hidden = filtered.length > 0;

    // Update post count badges everywhere
    const count = state.posts.length;
    const countLabel = `${count} post${count === 1 ? '' : 's'}`;
    if ($('postCountTotal')) $('postCountTotal').textContent = countLabel;
    if ($('navPostBadge')) $('navPostBadge').textContent = count;
    if ($('mobilePostCountBadge')) {
      $('mobilePostCountBadge').textContent = count;
      $('mobilePostCountBadge').hidden = count === 0;
    }

    for (const p of filtered) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'post-item';
      btn.setAttribute('aria-current', String(state.current && state.current.id === p.id));

      const badge = p.status === 'published'
        ? (p.hasUnpublishedChanges
            ? '<span class="badge edits"><span class="badge-dot"></span>Unpublished edits</span>'
            : '<span class="badge live"><span class="badge-dot"></span>Published</span>')
        : p.status === 'archived'
            ? '<span class="badge archived"><span class="badge-dot"></span>Archived</span>'
            : '<span class="badge"><span class="badge-dot"></span>Draft</span>';

      const thumbHtml = p.draft.imageUrl
        ? `<img class="post-thumb" src="${escapeHtml(p.draft.imageUrl)}" alt="" loading="lazy">`
        : `<div class="post-thumb-fallback">${escapeHtml(initials(state.categories[p.draft.category] || p.draft.category || 'Post'))}</div>`;

      btn.innerHTML = `
        ${thumbHtml}
        <div class="post-info">
          <span class="post-title">${escapeHtml(p.draft.title || 'Untitled post')}</span>
          <span class="post-meta">
            ${badge}
            <span>${timeAgo(p.updatedAt)}</span>
          </span>
        </div>
      `;
      btn.addEventListener('click', () => {
        openPost(p.id);
        // On mobile, navigate to editor after selecting a post
        if (window.innerWidth <= 768) {
          setTimeout(() => setActiveView('editor'), 80);
        }
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  // ==========================================================================
  //  Utility Helpers
  // ==========================================================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function initials(name) {
    return String(name ?? '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'ST';
  }

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Today';
    }
  }

  function wordCount(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean).length;
  }

  // ==========================================================================
  //  Editor
  // ==========================================================================
  const FIELDS = ['title', 'description', 'content', 'category', 'author', 'imageAlt'];
  let saveTimer = null;

  async function openPost(id) {
    clearTimeout(saveTimer);
    try {
      const post = await api('GET', `/admin/posts/${id}`);
      state.current = post;
      fillForm(post);
      $('emptyState').hidden = true;
      $('editorForm').hidden = false;
      $('conflict').hidden = true;
      renderList();
      updateLiveCardPreview();
      await startPreview(post.id);
    } catch (err) {
      toast('Could not open post.', 'warn');
    }
  }

  const triggerNewPost = async () => {
    try {
      if ($('filter').value !== 'all' && $('filter').value !== 'draft') {
        $('filter').value = 'all';
      }
      const post = await api('POST', '/admin/posts', {
        title: '',
        description: '',
        content: '',
        category: Object.keys(state.categories)[0] || 'rcs',
        author: (state.user && state.user.name) || 'SetuNxt Team',
        imageUrl: '',
        imageAlt: '',
      });
      await loadList();
      await openPost(post.id);
      $('title').focus();
      // Navigate to editor on mobile
      if (window.innerWidth <= 768) setActiveView('editor');
    } catch (err) {
      toast((err.data && err.data.message) || err.message || 'Could not create post.', 'warn');
    }
  };

  $('newPost').addEventListener('click', triggerNewPost);
  $('emptyNewPostBtn').addEventListener('click', triggerNewPost);
  $('emptyStateNewBtn').addEventListener('click', triggerNewPost);

  function fillForm(post) {
    const d = post.draft;
    $('title').value = d.title || '';
    $('description').value = d.description || '';
    $('content').value = d.content || '';
    $('category').value = d.category || Object.keys(state.categories)[0] || 'rcs';
    $('author').value = d.author || '';
    $('imageAlt').value = d.imageAlt || '';
    $('imageUrl').value = d.imageUrl || '';

    setImagePreview(d.imageUrl);
    updateCounts();
    clearFieldErrors();

    const archived = post.status === 'archived';
    $('fields').disabled = archived;
    $('archivedNote').hidden = !archived;
    $('saveBtn').disabled = archived;
    $('publishBtn').hidden = archived;
    $('publishBtn').innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      <span>${post.status === 'published' ? 'Publish changes' : 'Publish'}</span>
      <kbd class="kbd-hint">Ctrl+↵</kbd>
    `;
    $('unpublishBtn').hidden = post.status !== 'published';
    $('archiveBtn').hidden = archived;
    setStatusLine(post);
    updateLiveCardPreview();
    updateMobileBarTitle();
  }

  function setStatusLine(post) {
    const badge = $('editorStatusBadge');
    const badgeText = $('editorStatusText');
    const msg = $('statusLine');

    if (post.status === 'published') {
      if (post.hasUnpublishedChanges) {
        badge.className = 'status-indicator-badge edits';
        badgeText.textContent = 'Unpublished edits';
        msg.textContent = 'Post is live but has unsaved/unpublished changes.';
      } else {
        badge.className = 'status-indicator-badge published';
        badgeText.textContent = 'Published';
        msg.textContent = 'Live on site';
      }
    } else if (post.status === 'archived') {
      badge.className = 'status-indicator-badge';
      badgeText.textContent = 'Archived';
      msg.textContent = 'Archived — hidden from the public blog.';
    } else {
      badge.className = 'status-indicator-badge';
      badgeText.textContent = 'Draft';
      msg.textContent = 'Draft — not visible on the site yet.';
    }
  }

  function setImagePreview(url) {
    const img = $('imgPreview');
    const prompt = $('imageDropPrompt');
    if (url) {
      img.src = url;
      img.hidden = false;
      prompt.hidden = true;
      $('removeImage').hidden = false;
    } else {
      img.hidden = true;
      img.src = '';
      prompt.hidden = false;
      $('removeImage').hidden = true;
    }
  }

  function updateCounts() {
    const title = $('title');
    const desc = $('description');
    const content = $('content');
    if (!title) return;

    const tLen = title.value.length;
    const dLen = desc.value.length;
    const wCount = wordCount(content.value);

    // Title counter & meter
    const tCount = $('titleCount');
    tCount.textContent = `${tLen} / 140`;
    tCount.classList.toggle('warn', tLen >= 115 && tLen < 140);
    tCount.classList.toggle('danger', tLen >= 140);

    const tMeter = $('titleMeter');
    if (tMeter) {
      const pct = Math.min(100, (tLen / 140) * 100);
      tMeter.style.width = `${pct}%`;
      tMeter.className = 'char-meter-fill' + (tLen >= 140 ? ' danger' : tLen >= 115 ? ' warn' : '');
    }

    // Description counter & meter
    const dCount = $('descCount');
    dCount.textContent = `${dLen} / 400`;
    dCount.classList.toggle('warn', dLen >= 340 && dLen < 400);
    dCount.classList.toggle('danger', dLen >= 400);

    const dMeter = $('descMeter');
    if (dMeter) {
      const pct = Math.min(100, (dLen / 400) * 100);
      dMeter.style.width = `${pct}%`;
      dMeter.className = 'char-meter-fill' + (dLen >= 400 ? ' danger' : dLen >= 340 ? ' warn' : '');
    }

    // Article word count
    const wc = $('contentWordCount');
    if (wc) wc.textContent = `${wCount} word${wCount === 1 ? '' : 's'}`;
  }

  function clearFieldErrors() {
    document.querySelectorAll('[data-error-for]').forEach((e) => (e.textContent = ''));
    document.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  }

  function showFieldErrors(fields) {
    clearFieldErrors();
    for (const [key, msg] of Object.entries(fields || {})) {
      const slot = document.querySelector(`[data-error-for="${key}"]`);
      if (slot) slot.textContent = msg;
      const input = $(key);
      if (input) input.setAttribute('aria-invalid', 'true');
    }
  }

  function currentContent() {
    const c = {};
    for (const f of FIELDS) c[f] = $(f).value;
    c.imageUrl = $('imageUrl').value;
    return c;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    $('statusLine').textContent = 'Editing…';
    updateMobileBarTitle();
    saveTimer = setTimeout(saveDraft, 600);
  }

  ['input', 'change'].forEach((evt) => {
    $('editorForm').addEventListener(evt, (e) => {
      if (!state.current || e.target.closest('.actions')) return;
      updateCounts();
      scheduleSave();
      updateLiveCardPreview();
      pushPreview();
    });
  });

  async function saveDraft() {
    if (!state.current) return;
    const content = currentContent();
    try {
      const updated = await apiVersioned('PATCH', `/admin/posts/${state.current.id}`, state.current.version, content);
      state.current = updated;
      clearFieldErrors();
      setStatusLine(updated);
      updateListEntry(updated);
      updateLiveCardPreview();
      pushPreview();
    } catch (err) {
      if (err.status === 409) return showConflict(err.data.current);
      if (err.status === 422) return showFieldErrors(err.data.fields);
      toast("Couldn't save — check your connection.", 'warn');
    }
  }

  function updateListEntry(post) {
    const i = state.posts.findIndex((p) => p.id === post.id);
    if (i >= 0) state.posts[i] = post;
    else state.posts.unshift(post);
    renderList();
  }

  function showConflict(theirs) {
    state.theirs = theirs;
    $('conflict').hidden = false;
  }

  $('loadTheirs').addEventListener('click', () => {
    state.current = state.theirs;
    fillForm(state.current);
    $('conflict').hidden = true;
    toast('Loaded the latest version.', 'ok');
  });

  $('keepMine').addEventListener('click', async () => {
    state.current = { ...state.current, version: state.theirs.version };
    $('conflict').hidden = true;
    await saveDraft();
    toast('Your changes were kept.', 'ok');
  });

  $('saveBtn').addEventListener('click', () => {
    clearTimeout(saveTimer);
    saveDraft();
    toast('Saving draft…', 'info');
  });

  $('publishBtn').addEventListener('click', async () => {
    if (!state.current) return;
    try {
      const updated = await apiVersioned('POST', `/admin/posts/${state.current.id}/publish`, state.current.version);
      state.current = updated;
      clearFieldErrors();
      setStatusLine(updated);
      updateListEntry(updated);
      fillForm(updated);
      toast('Published — live on the site now!', 'ok');
    } catch (err) {
      if (err.status === 409 && err.data.current) return showConflict(err.data.current);
      if (err.status === 409) return toast('Nothing new to publish.', 'info');
      if (err.status === 422) return showFieldErrors(err.data.fields);
      toast("Couldn't publish — check your connection.", 'warn');
    }
  });

  $('unpublishBtn').addEventListener('click', async () => {
    if (!state.current) return;
    const ok = await confirmModal('Unpublish Post', 'Take this post off the public site? You can publish it again anytime.', 'Unpublish Post', true);
    if (!ok) return;
    try {
      const updated = await apiVersioned('POST', `/admin/posts/${state.current.id}/unpublish`, state.current.version);
      state.current = updated;
      fillForm(updated);
      updateListEntry(updated);
      toast('Post unpublished successfully.', 'ok');
    } catch (err) {
      toast("Couldn't unpublish — check connection.", 'warn');
    }
  });

  $('archiveBtn').addEventListener('click', async () => {
    if (!state.current) return;
    const ok = await confirmModal('Archive Post', 'Archive this post? It will leave the public site and drafts can no longer be edited.', 'Archive Post', true);
    if (!ok) return;
    try {
      const updated = await apiVersioned('DELETE', `/admin/posts/${state.current.id}`, state.current.version);
      state.current = updated;
      fillForm(updated);
      updateListEntry(updated);
      toast('Post archived.', 'ok');
    } catch (err) {
      toast("Couldn't archive post.", 'warn');
    }
  });

  // ==========================================================================
  //  Markdown Toolbar
  // ==========================================================================
  const MARKDOWN_FORMATS = {
    bold: { wrap: '**', placeholder: 'bold text' },
    italic: { wrap: '*', placeholder: 'italic text' },
    h2: { prefix: '## ', placeholder: 'Heading 2' },
    h3: { prefix: '### ', placeholder: 'Heading 3' },
    bullet: { prefix: '- ', placeholder: 'List item' },
    quote: { prefix: '> ', placeholder: 'Quoted text' },
    link: { template: '[{sel}](url)', placeholder: 'link text' },
  };

  document.querySelectorAll('.toolbar-btn[data-format]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const textarea = $('content');
      if (!textarea || $('fields').disabled) return;
      const fmt = btn.dataset.format;
      const config = MARKDOWN_FORMATS[fmt];
      if (!config) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end) || config.placeholder;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);

      let insertion = '';
      if (config.wrap) {
        insertion = `${config.wrap}${selected}${config.wrap}`;
      } else if (config.prefix) {
        insertion = `${config.prefix}${selected}`;
      } else if (config.template) {
        insertion = config.template.replace('{sel}', selected);
      }

      textarea.value = before + insertion + after;
      const newCursorPos = start + insertion.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();

      // Trigger save and preview update
      updateCounts();
      scheduleSave();
      updateLiveCardPreview();
      pushPreview();
    });
  });

  // ==========================================================================
  //  Image Upload & Drag-and-Drop
  // ==========================================================================
  async function handleFileUpload(file) {
    if (!file) return;
    const box = $('imageDropzone');
    box.classList.add('busy');
    try {
      const res = await fetch(`${API}/admin/uploads`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': state.csrf },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status, data });
      $('imageUrl').value = data.imageUrl;
      setImagePreview(data.imageUrl);
      scheduleSave();
      updateLiveCardPreview();
      pushPreview();
      toast('Image uploaded successfully.', 'ok');
    } catch (err) {
      toast((err.data && err.data.message) || 'Could not upload that image.', 'warn');
    } finally {
      box.classList.remove('busy');
      $('imageFile').value = '';
    }
  }

  $('imageFile').addEventListener('change', () => {
    const file = $('imageFile').files[0];
    handleFileUpload(file);
  });

  $('removeImage').addEventListener('click', () => {
    $('imageUrl').value = '';
    setImagePreview('');
    scheduleSave();
    updateLiveCardPreview();
    pushPreview();
  });

  const dropzone = $('imageDropzone');
  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });

  // ==========================================================================
  //  Live Card Preview (Built-in High Fidelity Mock)
  // ==========================================================================
  function updateLiveCardPreview() {
    const c = currentContent();
    const title = c.title || 'Untitled post';
    const desc = c.description || 'Add a description to see how your card appears to readers.';
    const cat = state.categories[c.category] || c.category || 'RCS';
    const author = c.author || 'SetuNxt Team';
    const imgUrl = c.imageUrl;

    $('mockTitle').textContent = title;
    $('mockDesc').textContent = desc;
    $('mockTag').textContent = cat;
    $('mockAuthorName').textContent = author;
    $('mockAvatar').textContent = initials(author);

    const mImg = $('mockImg');
    const mPlaceholder = $('mockImgPlaceholder');
    if (imgUrl) {
      mImg.src = imgUrl;
      mImg.hidden = false;
      mPlaceholder.hidden = true;
    } else {
      mImg.hidden = true;
      mImg.src = '';
      mPlaceholder.hidden = false;
    }

    if (state.current && state.current.publishedAt) {
      $('mockDateText').textContent = formatDate(state.current.publishedAt);
    } else {
      $('mockDateText').textContent = 'Draft';
    }
  }

  // ==========================================================================
  //  Preview Tabs (Card / Site)
  // ==========================================================================
  $('tabCardPreview').addEventListener('click', () => {
    state.previewTab = 'card';
    $('tabCardPreview').classList.add('active');
    $('tabSitePreview').classList.remove('active');
    $('cardPreviewContainer').hidden = false;
    $('sitePreviewContainer').hidden = true;
  });

  $('tabSitePreview').addEventListener('click', () => {
    state.previewTab = 'site';
    $('tabSitePreview').classList.add('active');
    $('tabCardPreview').classList.remove('active');
    $('sitePreviewContainer').hidden = false;
    $('cardPreviewContainer').hidden = true;
  });

  // ==========================================================================
  //  Article Detail Preview (Popup Window)
  // ==========================================================================
  function generateArticleHTML(c, post) {
    const title = c.title || 'Untitled post';
    const description = c.description || '';
    const author = c.author || 'SetuNxt Team';
    const category = state.categories[c.category] || c.category || 'RCS';
    const imageUrl = c.imageUrl || '';
    const authorInitial = initials(author);
    const date = (post && post.publishedAt) ? formatDate(post.publishedAt) : 'Draft';
    const rawContent = c.content ? c.content.trim() : '';

    let fullBody;
    if (rawContent) {
      fullBody = rawContent
        .split(/\n{2,}/)
        .map((para) => {
          const trimmed = para.trim();
          if (!trimmed) return '';
          if (/^#{2,3}\s/.test(trimmed)) {
            const level = trimmed.startsWith('###') ? 3 : 2;
            return `<h${level}>${escapeHtml(trimmed.replace(/^#{2,3}\s+/, ''))}</h${level}>`;
          }
          if (/^[*-]\s/.test(trimmed)) {
            const items = trimmed.split('\n').filter(Boolean);
            const lis = items.map((li) => `<li>${escapeHtml(li.replace(/^[*-]\s+/, '').trim())}</li>`).join('');
            return `<ul>${lis}</ul>`;
          }
          if (/^>\s/.test(trimmed)) {
            return `<blockquote>${escapeHtml(trimmed.replace(/^>\s+/, ''))}</blockquote>`;
          }
          return `<p>${escapeHtml(trimmed)}</p>`;
        })
        .join('\n');
    } else {
      fullBody = `<p>${escapeHtml(description)}</p>
        <p>In this detailed guide, we explore the nuances of <strong>${escapeHtml(title)}</strong>. RCS (Rich Communication Services) enables brands to send interactive messages with images, carousels, and suggested actions — all within the native messaging app.</p>
        <h2>Why ${escapeHtml(category)} Matters</h2>
        <p>Businesses using RCS have reported up to 85% read rates and 40% higher click-through rates compared to traditional SMS. This article dives into real-world applications, best practices, and future trends that will define the messaging ecosystem.</p>
        <h3>Implementation Steps</h3>
        <ul>
          <li>Partner with a certified RCS provider like SetuNxt</li>
          <li>Design rich cards that align with your brand voice</li>
          <li>Test interactive elements and track analytics</li>
          <li>Optimize based on delivery, read, and conversion metrics</li>
        </ul>
        <hr>
        <p><strong>SetuNxt</strong> empowers businesses with a cutting-edge RCS platform, API-driven workflows, and analytics to maximize every conversation. Contact our team to learn more.</p>`;
    }

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} — SetuNxt Blog</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font:400 16px/1.75 'Inter',system-ui,sans-serif;color:#0f172a;background:#f8fafc;-webkit-font-smoothing:antialiased}
    .article-wrap{max-width:800px;margin:0 auto;padding:52px 24px 96px}
    .article-header{margin-bottom:36px}
    .article-category{display:inline-block;padding:5px 14px;border-radius:9999px;background:#eff6ff;color:#1e5ba3;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:18px}
    .article-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(26px,5vw,42px);font-weight:800;line-height:1.2;letter-spacing:-0.03em;color:#0f172a;margin-bottom:22px}
    .article-meta{display:flex;align-items:center;gap:16px;padding:18px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin-bottom:0}
    .author-block{display:flex;align-items:center;gap:12px}
    .author-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1e5ba3,#0f2e54);color:#fff;font-size:14px;font-weight:700;display:grid;place-items:center;flex-shrink:0}
    .author-name{font-weight:700;font-size:14px;color:#0f172a}
    .article-date{font-size:12.5px;color:#64748b;margin-top:3px}
    .article-img{margin:32px 0 40px;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.1)}
    .article-img img{width:100%;height:auto;display:block;max-height:480px;object-fit:cover}
    .article-body{font-size:1.06rem;color:#1e293b;line-height:1.8}
    .article-body p{margin-bottom:1.5rem}
    .article-body h2{font-family:'Plus Jakarta Sans',sans-serif;font-size:1.55rem;font-weight:800;margin:2.4rem 0 1rem;color:#0f172a;letter-spacing:-0.02em}
    .article-body h3{font-size:1.2rem;font-weight:700;margin:2rem 0 .8rem;color:#1e293b}
    .article-body ul{margin-bottom:1.5rem;padding-left:1.6rem}
    .article-body li{margin-bottom:.6rem}
    .article-body blockquote{margin:1.5rem 0;padding:1rem 1.5rem;border-left:4px solid #1e5ba3;background:#eff6ff;border-radius:0 8px 8px 0;color:#1e5ba3;font-style:italic}
    .article-body hr{margin:2.4rem 0;border:0;height:2px;background:linear-gradient(90deg,#1e5ba3,#f7941d,#1e5ba3);border-radius:2px}
    .article-body a{color:#1e5ba3;text-decoration:underline}
    .draft-banner{display:flex;align-items:center;gap:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:700;margin-bottom:32px}
    .back-btn{display:inline-flex;align-items:center;gap:8px;margin-top:52px;padding:12px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:40px;color:#1e5ba3;font:700 14px 'Inter',sans-serif;text-decoration:none;cursor:pointer;transition:all .2s ease;box-shadow:0 2px 8px rgba(30,91,163,.1)}
    .back-btn:hover{background:#1e5ba3;color:#fff;border-color:#1e5ba3;transform:translateY(-2px);box-shadow:0 8px 20px rgba(30,91,163,.3)}
    @media(max-width:640px){.article-wrap{padding:28px 16px 72px}.article-title{font-size:26px}}
  </style>
</head>
<body>
<div class="article-wrap">
  <div class="article-header">
    <div class="article-category">${escapeHtml(category)}</div>
    <h1 class="article-title">${escapeHtml(title)}</h1>
    <div class="article-meta">
      <div class="author-block">
        <div class="author-avatar">${escapeHtml(authorInitial)}</div>
        <div>
          <div class="author-name">${escapeHtml(author)}</div>
          <div class="article-date">${escapeHtml(date)}</div>
        </div>
      </div>
    </div>
  </div>
  ${imageUrl ? `<div class="article-img"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.imageAlt || title)}"></div>` : ''}
  <div class="article-body">
    ${fullBody}
  </div>
  <a href="javascript:window.close()" class="back-btn">← Close article preview</a>
</div>
</body>
</html>`;
  }

  $('previewArticleBtn').addEventListener('click', () => {
    if (!state.current) { toast('Open a post first to preview its article view.', 'info'); return; }
    const c = currentContent();
    const html = generateArticleHTML(c, state.current);
    const w = window.open('', '_blank', 'width=960,height=820');
    if (w) { w.document.write(html); w.document.close(); }
    else toast('Allow pop-ups to preview the article view.', 'warn');
  });

  // ==========================================================================
  //  Live Preview via iframe (Full Site)
  // ==========================================================================
  async function startPreview(id) {
    state.previewFrameReady = false;
    const frame = $('previewFrame');
    try {
      const r = await api('POST', `/admin/posts/${id}/preview-token`);
      state.previewToken = r.token;
      frame.src = r.url;
      frame.onload = () => {
        state.previewFrameReady = true;
        pushPreview();
      };
    } catch {
      state.previewToken = null;
    }
  }

  function pushPreview() {
    if (!state.current || !state.previewToken || !state.previewFrameReady) return;
    const c = currentContent();
    const post = {
      id: state.current.id,
      slug: state.current.slug,
      title: c.title || 'Untitled post',
      description: c.description,
      content: c.content || '',
      category: c.category,
      categoryLabel: state.categories[c.category] || c.category,
      imageUrl: c.imageUrl,
      imageAlt: c.imageAlt,
      author: { name: c.author || 'SetuNxt Team' },
      publishedAt: new Date().toISOString(),
    };
    try {
      $('previewFrame').contentWindow.postMessage(
        { type: 'be:preview', id: state.current.id, token: state.previewToken, post },
        new URL(state.siteUrl, location.href).origin
      );
    } catch {
      /* preview frame not same-origin-reachable yet */
    }
  }

  // ==========================================================================
  //  Keyboard Shortcuts
  // ==========================================================================
  window.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+S — Save draft
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (state.current) {
        clearTimeout(saveTimer);
        saveDraft();
        toast('Draft saved.', 'ok');
      }
    }
    // Ctrl/Cmd+Enter — Publish
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (state.current && !$('publishBtn').hidden) {
        $('publishBtn').click();
      }
    }
    // Escape — Close modal
    if (e.key === 'Escape') {
      if (!$('confirmModal').hidden) {
        $('confirmModal').hidden = true;
        if (modalResolver) { modalResolver(false); modalResolver = null; }
      }
    }
  });

  // ==========================================================================
  //  Boot
  // ==========================================================================
  checkSession();
})();
