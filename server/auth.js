'use strict';
const crypto = require('node:crypto');

const COOKIE = 'be_session';
const TTL_SECONDS = 8 * 3600;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(password ?? ''), salt, 32).toString('hex');
}

function verifyPasswordHash(input, storedHash, saltHex) {
  const keyHex = hashPassword(input, saltHex);
  const a = Buffer.from(keyHex, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verifies a JWT signed by your real website's generateAccessToken()
// Requires userTypeId === 2 (admin) and not expired.
function verifyRealSiteJwt(token, secret, adminUserTypeId = 2) {
  if (!token || !secret || typeof token !== 'string') return null;
  const clean = token.trim();
  const parts = clean.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || (header.alg && header.alg !== 'HS256')) return null;

  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  const a = Buffer.from(sigB64, 'base64url');
  const b = Buffer.from(expectedSig, 'base64url');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Must match adminUserTypeId (default 2)
  if (Number(payload.userTypeId) !== Number(adminUserTypeId)) {
    return null;
  }

  return {
    id: String(payload._id || payload.id || 'admin'),
    username: String(payload.userName || payload.username || 'admin'),
    name: String(payload.fullName || payload.name || payload.userName || 'Admin'),
    email: String(payload.email || ''),
    role: 'admin',
    userTypeId: payload.userTypeId,
    roleId: payload.roleId,
    source: 'jwt_sso',
  };
}

// Optional API delegation: checks username/password against your real site's login endpoint
async function verifyViaRealSiteApi(username, password, authUrl, adminUserTypeId = 2) {
  if (!authUrl || !username || !password) return null;
  try {
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: username, email: username, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.user || (data.data && data.data.user) || data;
    if (!user) return null;
    if (Number(user.userTypeId) !== Number(adminUserTypeId)) return null;
    if (user.status !== undefined && Number(user.status) !== 1) return null;

    return {
      id: String(user._id || user.id || 'admin'),
      username: String(user.userName || user.username || username),
      name: String(user.fullName || user.name || username),
      email: String(user.email || ''),
      role: 'admin',
      userTypeId: user.userTypeId,
      roleId: user.roleId,
      source: 'real_site_api',
    };
  } catch {
    return null;
  }
}

function createAuth(cfg, db, options = {}) {
  const fails = new Map();
  const sign = (s) => crypto.createHmac('sha256', cfg.secret).update(s).digest('base64url');

  let q = null;
  if (db) {
    q = {
      countUsers: db.prepare('SELECT COUNT(*) AS c FROM users'),
      byUsernameOrEmail: db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1'),
      byId: db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1'),
      firstUser: db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 1'),
      insertUser: db.prepare(`
        INSERT INTO users (id, username, name, email, password_hash, salt, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listUsers: db.prepare('SELECT id, username, name, email, role, created_at, updated_at FROM users ORDER BY created_at ASC'),
      updatePassword: db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?'),
    };

    // Seed default admin in database if none exists
    const count = Number(q.countUsers.get().c);
    if (count === 0) {
      const id = crypto.randomUUID();
      const username = (cfg.adminUsername || 'admin').trim();
      const name = (cfg.adminName || 'Admin').trim();
      const email = (cfg.adminEmail || 'admin@setunxt.com').trim();
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(cfg.adminPassword, salt);
      const now = new Date().toISOString();
      q.insertUser.run(id, username, name, email, hash, salt, 'admin', now, now);
    } else if (!cfg.generatedPassword && cfg.adminPassword) {
      // Keep admin password in database in sync with ADMIN_PASSWORD in .env
      const adminUser = q.byUsernameOrEmail.get(cfg.adminUsername || 'admin', cfg.adminEmail || 'admin@setunxt.com');
      if (adminUser && !verifyPasswordHash(cfg.adminPassword, adminUser.password_hash, adminUser.salt)) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(cfg.adminPassword, salt);
        q.updatePassword.run(hash, salt, new Date().toISOString(), adminUser.id);
      }
    }
  }

  async function verifyCredentials(usernameOrEmail, password) {
    // 1. If real website Mongoose User model is provided:
    if (options.userModel) {
      const query = String(usernameOrEmail || '').trim().toLowerCase();
      try {
        const user = await options.userModel.findOne({
          $or: [{ userName: query }, { email: query }],
          userTypeId: Number(cfg.realSiteAdminUserTypeId || 2),
          status: 1,
        });
        if (user) {
          let valid = false;
          if (typeof user.isPasswordCorrect === 'function') {
            valid = await user.isPasswordCorrect(password);
          } else if (options.bcrypt) {
            valid = await options.bcrypt.compare(password, user.password);
          } else {
            try {
              const b = require('bcrypt');
              valid = await b.compare(password, user.password);
            } catch {
              try {
                const b = require('bcryptjs');
                valid = await b.compare(password, user.password);
              } catch {
                valid = user.password === password;
              }
            }
          }
          if (valid) {
            return {
              id: String(user._id),
              username: user.userName,
              name: user.fullName || user.userName,
              email: user.email,
              role: 'admin',
              userTypeId: user.userTypeId,
              roleId: user.roleId,
              source: 'mongoose_user_model',
            };
          }
        }
      } catch (err) {
        console.error('Error verifying against userModel:', err);
      }
    }

    // 2. Try real site auth API if configured
    if (cfg.realSiteAuthUrl) {
      const realUser = await verifyViaRealSiteApi(usernameOrEmail, password, cfg.realSiteAuthUrl, cfg.realSiteAdminUserTypeId);
      if (realUser) return realUser;
    }

    // 3. Database or local fallback
    if (!db || !q) {
      const salt = crypto.randomBytes(16);
      const passwordKey = crypto.scryptSync(cfg.adminPassword, salt, 32);
      const key = crypto.scryptSync(String(password ?? ''), salt, 32);
      return crypto.timingSafeEqual(key, passwordKey)
        ? { id: 'admin', username: 'admin', name: 'Admin', role: 'admin', userTypeId: 2 }
        : null;
    }

    const query = String(usernameOrEmail || '').trim();
    let row = null;
    if (query) {
      row = q.byUsernameOrEmail.get(query, query);
    } else {
      row = q.firstUser.get();
    }

    if (!row) return null;
    if (!verifyPasswordHash(password, row.password_hash, row.salt)) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      name: row.name,
      email: row.email,
      role: row.role,
      userTypeId: 2,
    };
  }

  async function verifyPassword(input) {
    const user = await verifyCredentials('', input);
    return Boolean(user);
  }

  function verifyRealSiteToken(token) {
    return verifyRealSiteJwt(token, cfg.realSiteJwtSecret, cfg.realSiteAdminUserTypeId);
  }

  function issue(user = {}) {
    const csrf = crypto.randomBytes(16).toString('hex');
    const payload = Buffer.from(JSON.stringify({
      userId: user.id || 'admin',
      username: user.username || 'admin',
      name: user.name || 'Admin',
      role: user.role || 'admin',
      userTypeId: user.userTypeId !== undefined ? user.userTypeId : 2,
      roleId: user.roleId !== undefined ? user.roleId : null,
      csrf,
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    })).toString('base64url');
    return { token: `${payload}.${sign(payload)}`, csrf };
  }

  function read(cookies, headers) {
    const token = cookies && cookies[COOKIE];
    if (token) {
      const [payload, sig] = token.split('.');
      if (payload && sig && safeEqual(sig, sign(payload))) {
        try {
          const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
          if (data.exp > Math.floor(Date.now() / 1000)) return data;
        } catch { /* ignore */ }
      }
    }

    // Direct Real-Site JWT verification via Authorization header or accessToken cookie
    if (cfg.realSiteJwtSecret) {
      let jwtToken = null;
      if (headers && headers.authorization) {
        const m = /^Bearer\s+(\S+)$/i.exec(headers.authorization);
        if (m) jwtToken = m[1];
      }
      if (!jwtToken && cookies && (cookies.accessToken || cookies.jwt || cookies.token)) {
        jwtToken = cookies.accessToken || cookies.jwt || cookies.token;
      }
      if (jwtToken) {
        const ssoUser = verifyRealSiteJwt(jwtToken, cfg.realSiteJwtSecret, cfg.realSiteAdminUserTypeId);
        if (ssoUser) {
          const csrf = crypto.createHmac('sha256', cfg.secret).update(`sso-${ssoUser.id}`).digest('hex').slice(0, 32);
          return {
            userId: ssoUser.id,
            username: ssoUser.username,
            name: ssoUser.name,
            role: 'admin',
            userTypeId: ssoUser.userTypeId,
            roleId: ssoUser.roleId,
            csrf,
            exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
            source: 'jwt_sso',
          };
        }
      }
    }

    return null;
  }

  function cookie(value, maxAge) {
    return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;
  }

  function retryAfter(ip) {
    const now = Date.now();
    for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
    const f = fails.get(ip);
    return f && f.count >= MAX_FAILS ? Math.ceil((f.resetAt - now) / 1000) : 0;
  }
  function recordFailure(ip) {
    const f = fails.get(ip) || { count: 0, resetAt: Date.now() + WINDOW_MS };
    f.count += 1;
    fails.set(ip, f);
  }

  return {
    verifyCredentials,
    verifyPassword,
    verifyRealSiteToken,
    issue,
    read,
    safeEqual,
    retryAfter,
    recordFailure,
    clearFailures: (ip) => fails.delete(ip),
    setCookie: (token) => cookie(token, TTL_SECONDS),
    clearCookie: () => cookie('', 0),
    listUsers: () => (q ? q.listUsers.all() : []),
  };
}

module.exports = { createAuth, hashPassword, verifyPasswordHash, verifyRealSiteJwt };
