const jwt = require('jsonwebtoken');
const COOKIE_NAME = 'pocket_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-change-this-session-secret');
function signSession(user, expiresIn = SESSION_SECONDS) {
  if (!SECRET) throw new Error('SESSION_SECRET must be set for production.');
  return jwt.sign({ id: String(user.id), name: user.name, is_demo: Boolean(user.is_demo) }, SECRET, { expiresIn, issuer: 'pocket-ledger' });
}
function readCookie(cookieHeader, name = COOKIE_NAME) {
  for (const part of String(cookieHeader || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function getSession(cookieHeader, bearerToken = '') {
  const token = bearerToken || readCookie(cookieHeader);
  if (!token || !SECRET) return null;
  try { return jwt.verify(token, SECRET, { issuer: 'pocket-ledger' }); } catch { return null; }
}
function makeCookie(token, secure = false) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}
function clearCookie(secure = false) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
module.exports = { COOKIE_NAME, SESSION_SECONDS, signSession, readCookie, getSession, makeCookie, clearCookie };
