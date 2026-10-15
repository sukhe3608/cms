'use strict';
const { HttpError } = require('./http');

// Keys match the data-cat values used by the filter buttons in blog.html.
const CATEGORIES = {
  rcs: 'RCS',
  strategy: 'Strategy',
  tutorials: 'Tutorial',
  'case-study': 'Case Study',
  news: 'News',
  marketing: 'Marketing',
  dev: 'API & Dev',
};

const FIELDS = ['title', 'description', 'content', 'category', 'imageUrl', 'imageAlt', 'author'];

// Collapse control characters and runs of whitespace; escaping is the renderer's job.
const clean = (v) => String(v).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

function imageProblem(url, cfg) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return 'Image URL is not valid.'; }
  if (url.startsWith(cfg.publicBaseUrl + '/media/')) return null;
  if (u.protocol === 'https:' && cfg.imageHosts.includes(u.hostname)) return null;
  return 'Upload the image here, or use one hosted on an allowed domain.';
}

// Returns a normalized content object with keys in a fixed order (so equal content
// always serializes identically, which is how "unpublished changes" is detected).
function validateDraft(input, cfg) {
  const fields = {};
  for (const k of FIELDS) {
    if (input[k] !== undefined && typeof input[k] !== 'string') fields[k] = 'Must be text.';
  }
  const v = (k, fallback = '') => (typeof input[k] === 'string' ? input[k] : fallback);

  const out = {
    title: clean(v('title')),
    description: clean(v('description')),
    content: typeof input.content === 'string' ? input.content.trim() : '',
    category: v('category', 'rcs').trim(),
    imageUrl: v('imageUrl').trim(),
    imageAlt: clean(v('imageAlt')),
    author: clean(v('author')) || 'SetuNxt Team',
  };

  if (!fields.content && out.content.length > 50000) fields.content = 'Article content can be at most 50,000 characters.';

  if (!fields.title && out.title.length > 0 && (out.title.length < 3 || out.title.length > 140)) fields.title = 'Title must be 3 to 140 characters.';
  if (!fields.description && out.description.length > 400) fields.description = 'Description can be at most 400 characters.';
  if (!fields.category && !Object.hasOwn(CATEGORIES, out.category)) fields.category = 'Choose one of the listed categories.';
  if (!fields.author && (out.author.length < 2 || out.author.length > 60)) fields.author = 'Author must be 2 to 60 characters.';
  if (!fields.imageAlt && out.imageAlt.length > 160) fields.imageAlt = 'Alt text can be at most 160 characters.';
  if (!fields.imageUrl) {
    if (out.imageUrl.length > 500) fields.imageUrl = 'Image URL is too long.';
    else { const p = imageProblem(out.imageUrl, cfg); if (p) fields.imageUrl = p; }
  }

  if (Object.keys(fields).length) throw new HttpError(422, { error: 'validation_failed', fields });
  return out;
}

// Extra requirements that only apply when going live.
function publishProblems(content) {
  const fields = {};
  if (!content.title || content.title.length < 3) fields.title = 'Add a title of at least 3 characters before publishing.';
  if (content.description.length < 10) fields.description = 'Add a description of at least 10 characters before publishing.';
  if (!content.imageUrl) fields.imageUrl = 'Add an image before publishing.';
  return Object.keys(fields).length ? fields : null;
}

module.exports = { CATEGORIES, validateDraft, publishProblems };
