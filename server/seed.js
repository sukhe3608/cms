'use strict';
// Imports the 10 grid posts that are currently hardcoded in blog.html / blog.js
// so the site looks identical after switching to the engine.
// Usage: npm run seed            (skips if posts already exist)
//        npm run seed -- --force (adds them anyway)
const fs = require('node:fs');
const path = require('node:path');

for (const line of fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createStore } = require('./store');
const { validateDraft } = require('./validate');

const U = (id) => `https://images.unsplash.com/${id}?w=500&h=300&fit=crop`;

const POSTS = [
  ['strategy', 'Priya Sharma', '2025-01-12', 'photo-1553877522-43269d4ea984', '5 RCS Strategies That Boosted Conversion Rates by 300%', 'Learn how top brands leveraged rich cards, carousels, and suggested actions to dramatically improve customer engagement.'],
  ['tutorials', 'Rahul Verma', '2025-01-10', 'photo-1461749280684-dccba630e2f6', 'Getting Started with SetuNxt RCS API: Developer Handbook', 'Step-by-step integration guide for sending rich RCS messages using our RESTful API with practical code examples.'],
  ['case-study', 'Meera Joshi', '2025-01-08', 'photo-1556742049-0cfed4f6a45d', 'How HDFC Bank Achieved 85% Read Rates with RCS Messaging', "An in-depth look at how India's banking leader used RCS to transform customer communication and support workflows."],
  ['news', 'Arun Kumar', '2025-01-05', 'photo-1451187580459-43490279c0fa', 'Apple Adopts RCS: What This Means for Business Messaging', 'With Apple joining the RCS ecosystem, we explore the massive new opportunities for cross-platform customer engagement.'],
  ['marketing', 'Neha Kapoor', '2025-01-03', 'photo-1533750349088-cd871a92f312', 'RCS vs SMS vs WhatsApp: The Ultimate Business Messaging Showdown', 'A comprehensive comparison of messaging channels to help you choose the right platform for your campaigns.'],
  ['rcs', 'Vikram Rao', '2024-12-28', 'photo-1563986768609-322da13575f2', 'Designing Interactive Rich Cards & Carousels for Maximum Impact', 'Master the art of creating rich media experiences that captivate users and drive meaningful conversions.'],
  ['dev', 'Dev Patel', '2024-12-22', 'photo-1555949963-aa79dcee981c', 'Webhooks & Real-Time Event Handling in RCS', 'Set up webhooks for delivery receipts, read confirmations, and user interaction callbacks.'],
  ['marketing', 'Sneha Gupta', '2024-12-18', 'photo-1460925895917-afdab827c52f', 'AI-Powered Personalization at Scale for RCS Campaigns', 'Machine learning driven hyper-personalized RCS messaging campaigns that convert at 5x the rate.'],
  ['rcs', 'Arjun Nair', '2024-12-14', 'photo-1556742393-d75f468bfcb0', 'RCS for E-commerce: Interactive Shopping via Messages', 'Transform your e-commerce journey with product carousels, in-message payments, and order tracking.'],
  ['strategy', 'Kavita Rao', '2024-12-10', 'photo-1552664730-d307ca884978', 'Omnichannel Mastery: RCS in Your Full Messaging Stack', 'Strategic guide to incorporating RCS alongside email, push, and social for unified engagement.'],
];

const cfg = loadConfig();
const db = openDb(path.join(cfg.dataDir, 'engine.db'));
const store = createStore(db);

const existing = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`Database already has ${existing} post(s); nothing seeded. Use --force to add them anyway.`);
  process.exit(0);
}

// Oldest first so ids/dates line up with the original ordering.
for (const [category, author, date, img, title, description] of [...POSTS].reverse()) {
  const content = validateDraft({ title, description, category, author, imageUrl: U(img), imageAlt: title }, cfg);
  const draft = store.createPost(content);
  const { post } = store.publish(draft.id, draft.version);
  // Keep the original publication dates (noon UTC so every timezone shows the same day).
  db.prepare('UPDATE posts SET published_at = ? WHERE id = ?').run(`${date}T12:00:00.000Z`, post.id);
}
console.log(`Seeded ${POSTS.length} posts.`);
db.close();
