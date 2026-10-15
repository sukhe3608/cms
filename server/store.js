'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./http');
const { CATEGORIES, publishProblems } = require('./validate');

const KEEP_EVENTS = 1000;
const iso = () => new Date().toISOString();

function slugify(title) {
  const s = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '');
  return s || 'post';
}

// What visitors receive. Built only from the LIVE copy, so unpublished edits never leak.
function toPublic(row) {
  const c = JSON.parse(row.live);
  return {
    id: row.id,
    slug: row.slug,
    title: c.title,
    description: c.description,
    content: c.content || '',
    category: c.category,
    categoryLabel: CATEGORIES[c.category] || c.category,
    imageUrl: c.imageUrl,
    imageAlt: c.imageAlt,
    author: { name: c.author },
    status: 'published',
    version: row.live_version,
    publishedAt: row.published_at,
  };
}

// What the admin app receives: both copies plus whether they differ.
function adminView(row) {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    version: row.version,
    liveVersion: row.live_version,
    draft: JSON.parse(row.draft),
    live: row.live ? JSON.parse(row.live) : null,
    hasUnpublishedChanges: row.status === 'published' && row.draft !== row.live,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function encodeCursor(row) {
  return Buffer.from(`${row.published_at}|${row.id}`).toString('base64url');
}
function decodeCursor(str) {
  const [publishedAt, id] = Buffer.from(String(str), 'base64url').toString('utf8').split('|');
  if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(publishedAt || '') || !/^[0-9a-f-]{36}$/.test(id || '')) {
    throw new HttpError(400, 'invalid_cursor');
  }
  return { publishedAt, id };
}

function createStore(db) {
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
  };

  const q = {
    insert: db.prepare(`INSERT INTO posts (id, slug, status, version, live_version, draft, live, created_at, updated_at, published_at)
                        VALUES (?, ?, 'draft', 1, 0, ?, NULL, ?, ?, NULL)`),
    byId: db.prepare('SELECT * FROM posts WHERE id = ?'),
    bySlug: db.prepare(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`),
    slugTaken: db.prepare('SELECT 1 AS taken FROM posts WHERE slug = ?'),
    updateDraft: db.prepare('UPDATE posts SET draft = ?, version = ?, updated_at = ? WHERE id = ?'),
    setPublished: db.prepare(`UPDATE posts SET status = 'published', live = draft, version = ?, live_version = ?,
                              published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`),
    setStatus: db.prepare('UPDATE posts SET status = ?, version = ?, updated_at = ? WHERE id = ?'),
    addEvent: db.prepare('INSERT INTO events (type, post_id, payload, created_at) VALUES (?, ?, ?, ?)'),
    pruneEvents: db.prepare('DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?'),
    eventsSince: db.prepare('SELECT seq, type, payload FROM events WHERE seq > ? ORDER BY seq ASC LIMIT 500'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events'),
    minSeq: db.prepare('SELECT COALESCE(MIN(seq), 0) AS s FROM events'),
  };

  function mustGet(id) {
    const row = q.byId.get(String(id));
    if (!row) throw new HttpError(404, 'not_found');
    return row;
  }

  function checkVersion(row, expected) {
    if (expected === null) throw new HttpError(428, { error: 'if_match_required', message: 'Send the current version in an If-Match header.' });
    if (row.version !== expected) throw new HttpError(409, { error: 'version_conflict', current: adminView(row) });
  }

  function emit(type, postId, payload) {
    const json = JSON.stringify(payload);
    const info = q.addEvent.run(type, postId, json, iso());
    q.pruneEvents.run(KEEP_EVENTS);
    return { seq: Number(info.lastInsertRowid), type, payload: json };
  }

  function uniqueSlug(title) {
    const base = slugify(title);
    let slug = base;
    while (q.slugTaken.get(slug)) slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    return slug;
  }

  // Draft-shaped like a public post, for the token-gated preview endpoint only.
  // Never touches `live`, so it can never leak unpublished content to visitors.
  function toPreview(row) {
    const c = JSON.parse(row.draft);
    return {
      id: row.id,
      slug: row.slug,
      title: c.title || 'Untitled post',
      description: c.description,
      content: c.content || '',
      category: c.category,
      categoryLabel: CATEGORIES[c.category] || c.category,
      imageUrl: c.imageUrl,
      imageAlt: c.imageAlt,
      author: { name: c.author },
      status: 'preview',
      version: row.version,
      publishedAt: row.published_at || row.updated_at,
    };
  }

  return {
    tx,

    getPreview(id) {
      const row = q.byId.get(String(id));
      return row ? toPreview(row) : null;
    },

    createPost(content) {
      return tx(() => {
        const id = crypto.randomUUID();
        const now = iso();
        q.insert.run(id, uniqueSlug(content.title), JSON.stringify(content), now, now);
        return adminView(q.byId.get(id));
      });
    },

    getAdmin: (id) => adminView(mustGet(id)),

    listAdmin(status = 'all') {
      const rows = db.prepare(`SELECT * FROM posts WHERE (? = 'all' OR status = ?) ORDER BY updated_at DESC LIMIT 500`).all(status, status);
      return rows.map(adminView);
    },

    saveDraft(id, expectedVersion, content) {
      return tx(() => {
        const row = mustGet(id);
        if (row.status === 'archived') throw new HttpError(409, { error: 'archived', message: 'Archived posts cannot be edited.' });
        checkVersion(row, expectedVersion);
        const json = JSON.stringify(content);
        if (json === row.draft) return adminView(row); // nothing changed, keep the version stable
        q.updateDraft.run(json, row.version + 1, iso(), id);
        return adminView(q.byId.get(id));
      });
    },

    publish(id, expectedVersion) {
      return tx(() => {
        const row = mustGet(id);
        if (row.status === 'archived') throw new HttpError(409, { error: 'archived', message: 'Archived posts cannot be published.' });
        checkVersion(row, expectedVersion);
        const problems = publishProblems(JSON.parse(row.draft));
        if (problems) throw new HttpError(422, { error: 'validation_failed', fields: problems });
        if (row.status === 'published' && row.draft === row.live) {
          throw new HttpError(409, { error: 'nothing_to_publish', message: 'There are no unpublished changes.' });
        }
        const now = iso();
        const version = row.version + 1;
        const type = row.status === 'published' ? 'post.updated' : 'post.published';
        q.setPublished.run(version, version, now, now, id);
        const updated = q.byId.get(id);
        return { post: adminView(updated), event: emit(type, id, toPublic(updated)) };
      });
    },

    unpublish(id, expectedVersion) {
      return tx(() => {
        const row = mustGet(id);
        checkVersion(row, expectedVersion);
        if (row.status !== 'published') throw new HttpError(409, { error: 'not_published' });
        q.setStatus.run('draft', row.version + 1, iso(), id);
        const event = emit('post.unpublished', id, { id, slug: row.slug, version: row.version + 1 });
        return { post: adminView(q.byId.get(id)), event };
      });
    },

    // Soft delete: keeps the row so history and slugs stay stable.
    archive(id, expectedVersion) {
      return tx(() => {
        const row = mustGet(id);
        checkVersion(row, expectedVersion);
        if (row.status === 'archived') throw new HttpError(409, { error: 'archived' });
        q.setStatus.run('archived', row.version + 1, iso(), id);
        const event = row.status === 'published'
          ? emit('post.unpublished', id, { id, slug: row.slug, version: row.version + 1 })
          : null;
        return { post: adminView(q.byId.get(id)), event };
      });
    },

    listPublic({ limit, cursor, category }) {
      const where = [`status = 'published'`];
      const args = [];
      if (category) { where.push(`json_extract(live, '$.category') = ?`); args.push(category); }
      if (cursor) {
        const c = decodeCursor(cursor);
        where.push('(published_at < ? OR (published_at = ? AND id < ?))');
        args.push(c.publishedAt, c.publishedAt, c.id);
      }
      const rows = db.prepare(`SELECT * FROM posts WHERE ${where.join(' AND ')} ORDER BY published_at DESC, id DESC LIMIT ?`)
        .all(...args, limit + 1);
      const page = rows.slice(0, limit);
      return {
        items: page.map(toPublic),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
      };
    },

    getPublicBySlug(slug) {
      const row = q.bySlug.get(String(slug));
      return row ? toPublic(row) : null;
    },

    currentSeq: () => Number(q.maxSeq.get().s),
    oldestSeq: () => Number(q.minSeq.get().s),
    eventsSince: (seq) => q.eventsSince.all(seq).map((e) => ({ ...e, seq: Number(e.seq) })),
  };
}

module.exports = { createStore };
