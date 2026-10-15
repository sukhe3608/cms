'use strict';

class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : (body && body.error) || 'error');
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}

async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'payload_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = 100 * 1024) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'expected_json');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_json');
  return value;
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendBuffer(res, status, buf, headers = {}) {
  res.writeHead(status, { 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Accepts `If-Match: 7`, `If-Match: "7"` or `If-Match: W/"7"`.
function parseIfMatch(req) {
  const raw = String(req.headers['if-match'] || '').trim().replace(/^W\//, '').replace(/"/g, '');
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

module.exports = { HttpError, readBody, readJson, sendJson, sendBuffer, parseCookies, parseIfMatch };
