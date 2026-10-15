(function () {
    const ICONS = {
        check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        bookmark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        sparkle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        party: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2z"/></svg>',
        books: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    };

    /* === PARTICLES === */
    const pEl = document.getElementById('particles');
    for (let i = 0; i < 28; i++) {
        const d = document.createElement('div');
        d.classList.add('particle');
        const s = Math.random() * 3.5 + 1.5;
        const isO = Math.random() > .55;
        d.style.cssText = `width:${s}px;height:${s}px;left:${Math.random() * 100}%;background:${isO ? 'rgba(247,148,29,.45)' : 'rgba(32,104,178,.35)'};animation-duration:${Math.random() * 9 + 5}s;animation-delay:${Math.random() * 7}s;`;
        pEl.appendChild(d);
    }

    /* === PROGRESS BAR SCROLL === */
    const prog = document.getElementById('progressBar');
    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        const h = document.documentElement.scrollHeight - window.innerHeight;
        if (prog) prog.style.width = h > 0 ? (y / h * 100) + '%' : '0%';
    });

    /* === BACK TO TOP === */
    const btt = document.getElementById('btt');
    if (btt) btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => { if (btt) btt.classList.toggle('show', window.scrollY > 500); });

    /* === TOAST === */
    function toast(icon, msg) {
        const t = document.getElementById('toast');
        const ti = document.getElementById('toastIco');
        const tm = document.getElementById('toastMsg');
        ti.innerHTML = icon; tm.textContent = msg;
        t.classList.add('on');
        clearTimeout(t._t);
        t._t = setTimeout(() => t.classList.remove('on'), 3200);
    }

    /* === NEWSLETTER === */
    document.getElementById('nlForm').addEventListener('submit', e => {
        e.preventDefault();
        const em = document.getElementById('nlEmail');
        if (em.value) { toast(ICONS.party, 'Subscribed! Welcome to the SetuNxt community.'); em.value = '' }
    });

    /* === BOOKMARKS === */
    document.addEventListener('click', e => {
        const b = e.target.closest('.bm-btn');
        if (!b) return; e.stopPropagation();
        b.classList.toggle('saved');
        toast(b.classList.contains('saved') ? ICONS.pin : ICONS.trash, b.classList.contains('saved') ? 'Article bookmarked successfully' : 'Bookmark removed');
    });

    /* === CATEGORY FILTER === */
    const fBtns = document.querySelectorAll('.f-btn');
    const getCards = () => document.querySelectorAll('.card');
    const feat = document.getElementById('featured');
    fBtns.forEach(btn => btn.addEventListener('click', () => {
        fBtns.forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        const cat = btn.dataset.cat;
        getCards().forEach((c, i) => {
            const show = cat === 'all' || c.dataset.cat === cat;
            if (show) { c.style.display = ''; c.style.animation = `fadeUp .5s ease ${i * .05}s both` }
            else { c.style.display = 'none' }
        });
        feat.style.display = (cat === 'all' || feat.dataset.cat === cat) ? '' : 'none';
    }));

    /* === SEARCH === */
    const sI = document.getElementById('searchInput');
    const sB = document.getElementById('searchBtn');
    function doSearch() {
        const q = sI.value.toLowerCase().trim();
        if (!q) { getCards().forEach(c => { c.style.display = ''; c.style.animation = '' }); feat.style.display = ''; return }
        let n = 0;
        getCards().forEach(c => { const t = c.textContent.toLowerCase(); const s = t.includes(q); c.style.display = s ? '' : 'none'; if (s) n++ });
        const fs = feat.textContent.toLowerCase().includes(q); feat.style.display = fs ? '' : 'none'; if (fs) n++;
        toast(ICONS.search, n ? `Found ${n} result${n > 1 ? 's' : ''}` : `No results for "${sI.value}"`);
    }
    sB.addEventListener('click', doSearch);
    sI.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch() });

    /* === LOAD MORE === */
    // Load More and the post grid are now driven by blog-live.js (fetches real pages
    // from the blog engine's API and replaces this button's click handler). The
    // hardcoded 4-post "extra" array that used to live here has been removed since
    // it would otherwise run alongside — and fight with — the live version.

    /* === TAGS === */
    document.querySelectorAll('.tag-p').forEach(t => t.addEventListener('click', () => {
        sI.value = t.textContent; window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(doSearch, 600);
    }));

    // ========== FULL ARTICLE OPEN IN NEW TAB ==========
    // helper: extract clean date from meta element (removes svg, extra spaces)
    function extractDateFromMeta(metaEl) {
        if (!metaEl) return '';
        const clone = metaEl.cloneNode(true);
        clone.querySelectorAll('svg, .sep').forEach(el => el.remove());
        let text = clone.innerText.trim();
        // pattern like "Jan 15, 2025" or "Dec 28, 2024"
        const match = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/);
        return match ? match[0] : text.split(/\s*·\s*/)[0] || '';
    }

    // Escapes text before it's placed into the new tab's HTML in generateFullArticleHTML
    // below. Titles and descriptions can now come from the blog engine's editor, so they
    // can no longer be treated as trusted, hand-written strings the way they used to be.
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // generate full article HTML with consistent styling
    function generateFullArticleHTML(article) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${article.title} | SetuNxt Blog</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
            <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
            <style>
                *{margin:0;padding:0;box-sizing:border-box}
                body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#f6f8fc;color:#0f172a;line-height:1.65;overflow-x:hidden}
                ::-webkit-scrollbar{width:5px}
                ::-webkit-scrollbar-track{background:transparent}
                ::-webkit-scrollbar-thumb{background:#2068B2;border-radius:10px}
                .article-container{max-width:880px;margin:0 auto;padding:32px 24px 80px}
                .article-header{margin-bottom:32px}
                .article-category{display:inline-flex;align-items:center;gap:6px;background:#eaf2fb;color:#2068B2;font-size:.75rem;font-weight:700;padding:6px 14px;border-radius:30px;margin-bottom:20px}
                .article-title{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:800;letter-spacing:-1px;line-height:1.2;margin-bottom:20px;color:#0f172a}
                .article-meta{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #e2e8f0}
                .author-block{display:flex;align-items:center;gap:12px}
                .author-avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#2068B2,#174e8a);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1rem}
                .author-info .author-name{font-weight:700;font-size:.9rem}
                .author-info .article-date{font-size:.75rem;color:#64748b}
                .article-img{margin:24px 0 32px;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.1)}
                .article-img img{width:100%;height:auto;display:block}
                .article-content{font-size:1rem;color:#1e293b}
                .article-content p{margin-bottom:1.5rem;line-height:1.7}
                .article-content h2{font-size:1.5rem;font-weight:700;margin:2rem 0 1rem}
                .article-content h3{font-size:1.25rem;font-weight:600;margin:1.5rem 0 0.75rem}
                .article-content ul{margin-bottom:1.5rem;padding-left:1.5rem}
                .article-content li{margin-bottom:0.4rem}
                .back-link{display:inline-flex;align-items:center;gap:8px;margin-top:48px;padding:12px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:40px;color:#2068B2;font-weight:600;text-decoration:none;transition:all .3s ease}
                .back-link:hover{background:#2068B2;color:#fff;border-color:#2068B2;transform:translateY(-2px)}
                hr{margin:32px 0;border:0;height:1px;background:linear-gradient(90deg,#2068B2,#F7941D)}
                @media (max-width:680px){.article-container{padding:20px 20px 60px}}
            </style>
        </head>
        <body>
        <div class="article-container">
            <div class="article-header">
                <div class="article-category">${article.category}</div>
                <h1 class="article-title">${article.title}</h1>
                <div class="article-meta">
                    <div class="author-block">
                        <div class="author-avatar">${article.authorInitial || article.author.slice(0, 2).toUpperCase()}</div>
                        <div class="author-info">
                            <div class="author-name">${article.author}</div>
                            <div class="article-date">${article.date}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="article-img">
                <img src="${article.image}" alt="${article.title}">
            </div>
            <div class="article-content">
                <p>${article.description}</p>
                ${article.fullBody || `<p>In this comprehensive article, we dive deep into "${article.title}". The insights below will help you leverage RCS messaging effectively.</p>
                <h2>Key Takeaways</h2>
                <ul><li>Rich Communication Services (RCS) is transforming business messaging with verified sender identity and rich media.</li><li>Interactive elements like carousels, quick replies, and suggested actions drive 3x higher engagement than SMS.</li><li>Brands that adopted RCS early are seeing significant ROI improvements in customer support and marketing campaigns.</li></ul>
                <h3>Why It Matters for Your Business</h3>
                <p>As the messaging landscape evolves, RCS provides a native, secure, and feature-rich channel to connect with customers. Whether you're in e-commerce, banking, healthcare, or travel, integrating RCS can open new avenues for personalized, real-time communication.</p>
                <p>Stay ahead of the curve — implement RCS strategies today to build trust, increase conversions, and deliver exceptional customer experiences.</p>
                <hr>
                <p><strong>SetuNxt</strong> empowers businesses with a cutting-edge RCS platform, API-driven workflows, and analytics to maximize every conversation. Contact our team to learn more.</p>`}
            </div>
            <a href="javascript:window.close()" class="back-link">← Close article</a>
        </div>
        </body>
        </html>`;
    }

    function openFullArticle(articleData) {
        const fullHtml = generateFullArticleHTML(articleData);
        const newTab = window.open();
        newTab.document.write(fullHtml);
        newTab.document.close();
    }

    // Extract article data from a card element
    function getCardArticleData(card) {
        const img = esc(card.querySelector('.card-img img')?.src || 'https://images.unsplash.com/photo-1611746872915-64382b5c76da?w=800&h=500&fit=crop');
        const title = esc(card.querySelector('h3')?.innerText || 'Article');
        const description = esc(card.querySelector('.c-desc')?.innerText || '');
        const category = esc(card.querySelector('.c-tag')?.innerText || 'Insights');
        const authorName = esc(card.querySelector('.av-n')?.innerText || 'SetuNxt Team');
        const authorInitialElem = card.querySelector('.av-xs');
        let authorInitial = esc(authorInitialElem ? authorInitialElem.innerText.trim() : authorName.slice(0, 2).toUpperCase());
        const dateElem = card.querySelector('.cf-date');
        let date = esc(dateElem ? dateElem.innerText.trim() : '');

        // If blog-live.js stored authored content in dataset, use it (real content from CMS)
        let fullBody = '';
        const rawContent = card.dataset.content ? card.dataset.content.trim() : '';
        if (rawContent) {
            // Convert plain text / lightweight markdown to HTML paragraphs
            fullBody = rawContent
                .split(/\n{2,}/)
                .map(para => {
                    const trimmed = para.trim();
                    if (!trimmed) return '';
                    if (/^#{2,3}\s/.test(trimmed)) {
                        const level = trimmed.startsWith('###') ? 3 : 2;
                        return `<h${level}>${esc(trimmed.replace(/^#{2,3}\s+/, ''))}</h${level}>`;
                    }
                    if (/^[*-]\s/.test(trimmed)) {
                        const items = trimmed.split('\n').filter(Boolean);
                        const lis = items.map(li => `<li>${esc(li.replace(/^[*-]\s+/, '').trim())}</li>`).join('');
                        return `<ul>${lis}</ul>`;
                    }
                    return `<p>${esc(trimmed)}</p>`;
                })
                .join('\n');
        }

        // Fallback for static/hardcoded cards that have no CMS content
        if (!fullBody) {
            fullBody = `<p>${description}</p><p>In this detailed guide, we explore the nuances of ${title}. RCS (Rich Communication Services) enables brands to send interactive messages with images, videos, carousels, and suggested actions — all within the native messaging app.</p><h2>Why ${category} Matters</h2><p>Businesses using RCS have reported up to 85% read rates and 40% higher click-through rates compared to traditional SMS. This article dives into real-world applications, best practices, and future trends that will define the messaging ecosystem.</p><h3>Implementation Steps</h3><ul><li>Partner with a certified RCS provider like SetuNxt</li><li>Design rich cards that align with your brand voice</li><li>Test interactive elements and track analytics</li><li>Optimize based on delivery, read, and conversion metrics</li></ul><p>Stay tuned for more expert insights from our team.</p>`;
        }

        return { image: img, title, description, category, author: authorName, authorInitial, date, fullBody };
    }

    // Featured article data
    function getFeaturedArticleData() {
        const featEl = document.getElementById('featured');
        if (!featEl) return null;
        const img = esc(featEl.querySelector('.feat-img img')?.src || '');
        const title = esc(featEl.querySelector('.feat-body h2')?.innerText || 'Featured Article');
        const description = esc(featEl.querySelector('.excerpt')?.innerText || '');
        let category = 'RCS';
        const catChip = featEl.querySelector('.cat-chip');
        if (catChip) category = catChip.innerText.replace(/[🔍📱]/g, '').trim();
        category = esc(category);
        const authorName = esc(featEl.querySelector('.author-info .name')?.innerText || 'Arun Kumar');
        const authorAvatar = esc(featEl.querySelector('.avatar')?.innerText || 'AK');
        let date = '';
        const metaDiv = featEl.querySelector('.author-info .meta');
        if (metaDiv) date = esc(extractDateFromMeta(metaDiv));
        const fullBody = `<p>${description}</p><h2>Why RCS is the Future</h2><p>Rich Communication Services (RCS) is the next-generation messaging protocol that replaces SMS. It brings features like read receipts, typing indicators, high-res media sharing, and branded sending numbers — all without requiring additional apps. In 2025, RCS adoption has skyrocketed, with Google and Apple both supporting it natively.</p><h3>What This Means for Marketers</h3><p>With interactive carousels, quick reply buttons, and verified sender profiles, RCS offers a trusted channel for customer engagement. This guide provides actionable strategies to launch your first RCS campaign, measure success, and scale effectively.</p><h3>Conclusion</h3><p>SetuNxt simplifies RCS integration with powerful APIs and analytics. Get started today and transform your messaging ROI.</p>`;
        return { image: img, title, description, category, author: authorName, authorInitial: authorAvatar, date, fullBody };
    }

    // Trending item data
    function getTrendArticleData(trendEl) {
        const title = esc(trendEl.querySelector('h4')?.innerText || 'Trending Topic');
        const metaSpan = trendEl.querySelector('.t-meta');
        let date = '';
        if (metaSpan) {
            const rawText = metaSpan.innerText;
            const match = rawText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/);
            date = esc(match ? match[0] : '');
        }
        const category = 'Trending';
        const description = `Explore why "${title}" is gaining momentum in the RCS and business messaging world. This article breaks down key drivers and actionable insights.`;
        const image = `https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=500&fit=crop`; // generic news img
        const fullBody = `<p>${description}</p><h2>Understanding the Trend</h2><p>As businesses shift to richer communication channels, topics like ${title} are becoming central to marketing and customer experience strategies. We analyze the latest data, expert opinions, and future projections to keep you ahead.</p><h3>Actionable Steps</h3><ul><li>Monitor industry announcements regarding RCS updates</li><li>Test new features with SetuNxt sandbox environment</li><li>Optimize your messaging for interactivity and personalization</li></ul><p>Stay informed with SetuNxt's weekly insights.</p>`;
        return { image, title, description, category, author: 'Editorial Team', authorInitial: 'ET', date, fullBody };
    }

    // Replace existing click handlers with full article opening
    // Card click (delegated)
    document.addEventListener('click', e => {
        const card = e.target.closest('.card');
        if (card && !e.target.closest('.bm-btn')) {
            e.preventDefault();
            const articleData = getCardArticleData(card);
            openFullArticle(articleData);
        }
    });
    // Featured click
    const featuredEl = document.getElementById('featured');
    if (featuredEl) {
        featuredEl.addEventListener('click', (e) => {
            if (e.target.closest('.bm-btn')) return;
            const data = getFeaturedArticleData();
            if (data) openFullArticle(data);
        });
    }
    // Trending items click
    document.querySelectorAll('.trend').forEach(trend => {
        trend.addEventListener('click', () => {
            const data = getTrendArticleData(trend);
            openFullArticle(data);
        });
    });

    /* === SCROLL REVEAL === */
    const rObs = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); rObs.unobserve(en.target) } });
    }, { threshold: .06, rootMargin: '0px 0px -35px 0px' });
    document.querySelectorAll('.reveal').forEach(el => rObs.observe(el));

})();