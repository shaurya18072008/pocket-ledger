const { createHmac, timingSafeEqual } = require('node:crypto');
const COOKIE_NAME = 'pocket_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const ISSUER = 'pocket-ledger';
const SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-change-this-session-secret');

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}
function signSession(user, expiresIn = SESSION_SECONDS) {
  if (!SECRET) throw new Error('SESSION_SECRET must be set for production.');
  const iat = Math.floor(Date.now() / 1000);
  const payload = { id: String(user.id), name: user.name, is_demo: Boolean(user.is_demo), iat, iss: ISSUER };
  if (expiresIn !== null && expiresIn !== undefined) payload.exp = iat + Number(expiresIn);
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const unsigned = `${head}.${body}`;
  const signature = createHmac('sha256', SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}
function readCookie(cookieHeader, name = COOKIE_NAME) {
  for (const part of String(cookieHeader || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
function verifySession(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [head, body, suppliedSignature] = parts;
  const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) return null;
  const unsigned = `${head}.${body}`;
  const expected = createHmac('sha256', SECRET).update(unsigned).digest();
  const actual = Buffer.from(suppliedSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.iss !== ISSUER) return null;
  if (payload.exp !== undefined && (typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000)) return null;
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || Date.now() < payload.nbf * 1000)) return null;
  return payload;
}
function getSession(cookieHeader, bearerToken = '') {
  const token = bearerToken || readCookie(cookieHeader);
  if (!token || !SECRET) return null;
  try { return verifySession(token); } catch { return null; }
}
function makeCookie(token, secure = false) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}
function clearCookie(secure = false) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
module.exports = { COOKIE_NAME, SESSION_SECONDS, signSession, readCookie, getSession, makeCookie, clearCookie };
