'use strict';
const crypto = require('node:crypto');

const TTL_SECONDS = 30 * 60;

// Lets the public blog page fetch ONE draft post without an admin session — the admin
// app opens it in an iframe, so cross-site cookies wouldn't be sent anyway. The token
// is scoped to a single post id and expires quickly; nothing here can list or expose
// any other post.
function createPreviewTokens(cfg) {
  const sign = (payload) => crypto.createHmac('sha256', cfg.secret).update('preview:' + payload).digest('base64url');

  function issue(id) {
    const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const payload = `${id}.${exp}`;
    return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  }

  function verify(id, token) {
    if (!token || typeof token !== 'string' || !id) return false;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return false;
    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = sign(payload);
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const [tokenId, expStr] = payload.split('.');
    const exp = Number(expStr);
    return tokenId === id && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
  }

  return { issue, verify, ttlSeconds: TTL_SECONDS };
}

module.exports = { createPreviewTokens };
