const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { CATEGORIES, normalizeName, validateName, validatePassword, isValidIsoDate, isValidMonth, validExpense } = require('./lib/shared.cjs');
const { signSession, getSession, makeCookie, clearCookie, SESSION_SECONDS } = require('./lib/auth.cjs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'pocket-ledger.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Keep an ordinary SQLite database for local development; Netlify deploys use managed Postgres.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT NOT NULL,
    spent_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
let expenseColumns = db.prepare('PRAGMA table_info(expenses)').all().map(row => row.name);
if (!expenseColumns.includes('user_id')) {
  db.exec('ALTER TABLE expenses ADD COLUMN user_id INTEGER REFERENCES users(id)');
}
// Remove the old persisted demo login and its mock rows; the new demo is a static, read-only page.
db.prepare('DELETE FROM expenses WHERE user_id IN (SELECT id FROM users WHERE is_demo=1)').run();
db.prepare('DELETE FROM users WHERE is_demo=1').run();
db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, spent_on DESC)');

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
function isSecure(req) { return req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production'; }
function userFromRequest(req) {
  const header = req.get('authorization') || '';
  const bearer = process.env.NODE_ENV !== 'production' ? (header.match(/^Bearer\s+(.+)$/i)?.[1] || '') : '';
  return getSession(req.headers.cookie, bearer);
}
function sendSession(res, user, secure) { res.setHeader('Set-Cookie', makeCookie(signSession(user), secure)); }
function previewToken(user) { return process.env.NODE_ENV === 'production' ? undefined : signSession(user, SESSION_SECONDS); }
const loginAttempts = new Map();
function loginAllowed(key) {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= 12) return false;
  recent.push(now); loginAttempts.set(key, recent); return true;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/demo', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});
app.get('/dashboard', (req, res) => {
  if (!userFromRequest(req) && process.env.NODE_ENV === 'production') return res.redirect(303, '/');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

app.get('/api/auth/status', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.json({ authenticated: false });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authenticated: true, user: { id: user.id, name: user.name, is_demo: Boolean(user.is_demo) } });
});
app.post('/api/auth/signup', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = req.body?.password;
  const nameError = validateName(name);
  if (nameError) return res.status(400).json({ error: nameError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const normalized = normalizeName(name);
  if (!loginAllowed(`signup:${normalized}`)) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  try {
    const result = db.prepare('INSERT INTO users (name, normalized_name, password_hash) VALUES (?, ?, ?)').run(name, normalized, bcrypt.hashSync(password, 12));
    const user = db.prepare('SELECT id, name, is_demo FROM users WHERE id=?').get(result.lastInsertRowid);
    sendSession(res, user, isSecure(req));
    const response = { user: { id: user.id, name: user.name, is_demo: false } };
    const token = previewToken(user);
    if (token) response.previewToken = token;
    res.status(201).json(response);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That name already has an account. Try signing in instead.' });
    console.error('Signup failed:', error.message);
    res.status(500).json({ error: 'Could not create your account right now.' });
  }
});
app.post('/api/auth/login', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = req.body?.password;
  if (!name || typeof password !== 'string') return res.status(400).json({ error: 'Enter your name and password.' });
  const normalized = normalizeName(name);
  if (!loginAllowed(`login:${normalized}`)) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  const user = db.prepare('SELECT * FROM users WHERE normalized_name=?').get(normalized);
  const accepted = user && bcrypt.compareSync(password, user.password_hash);
  if (!accepted) return res.status(401).json({ error: 'That name and password don’t match.' });
  sendSession(res, user, isSecure(req));
  const response = { user: { id: user.id, name: user.name, is_demo: Boolean(user.is_demo) } };
  const token = previewToken(user);
  if (token) response.previewToken = token;
  res.json(response);
});
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookie(isSecure(req)));
  res.status(204).end();
});

app.use('/api', (req, res, next) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to open your ledger.' });
  req.user = user;
  next();
});
app.get('/api/categories', (req, res) => res.json(CATEGORIES));
app.get('/api/expenses', (req, res) => {
  const { month, category, search, from, to, limit = '200' } = req.query;
  const conditions = ['user_id = @user_id'];
  const params = { user_id: Number(req.user.id) };
  if (isValidMonth(month)) { conditions.push("substr(spent_on, 1, 7) = @month"); params.month = month; }
  if (category && CATEGORIES.some(c => c.name === category)) { conditions.push('category = @category'); params.category = category; }
  if (search && String(search).trim()) { conditions.push('(description LIKE @search OR note LIKE @search)'); params.search = `%${String(search).trim().slice(0, 80)}%`; }
  if (isValidIsoDate(from)) { conditions.push('spent_on >= @from'); params.from = from; }
  if (isValidIsoDate(to)) { conditions.push('spent_on <= @to'); params.to = to; }
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  const rows = db.prepare(`SELECT * FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY spent_on DESC, id DESC LIMIT @limit`).all({ ...params, limit: safeLimit });
  res.json(rows);
});
app.get('/api/summary', (req, res) => {
  const month = isValidMonth(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const current = db.prepare(`SELECT COALESCE(SUM(amount), 0) total, COUNT(*) count FROM expenses WHERE user_id=? AND substr(spent_on,1,7)=?`).get(Number(req.user.id), month);
  const previousDate = new Date(`${month}-01T12:00:00Z`); previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previousMonth = previousDate.toISOString().slice(0, 7);
  const previous = db.prepare(`SELECT COALESCE(SUM(amount), 0) total FROM expenses WHERE user_id=? AND substr(spent_on,1,7)=?`).get(Number(req.user.id), previousMonth);
  const byCategory = db.prepare(`SELECT category, SUM(amount) amount FROM expenses WHERE user_id=? AND substr(spent_on,1,7)=? GROUP BY category ORDER BY amount DESC`).all(Number(req.user.id), month);
  const daily = db.prepare(`SELECT spent_on day, SUM(amount) amount FROM expenses WHERE user_id=? AND substr(spent_on,1,7)=? GROUP BY spent_on ORDER BY spent_on`).all(Number(req.user.id), month);
  res.json({ month, total: current.total, count: current.count, previousTotal: previous.total, changePercent: previous.total ? ((current.total - previous.total) / previous.total) * 100 : null, categories: byCategory, daily });
});
app.post('/api/expenses/import', (req, res) => {
  const incoming = req.body?.expenses;
  if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ error: 'The file has no expense rows to import.' });
  if (incoming.length > 500) return res.status(400).json({ error: 'Import up to 500 expenses at a time.' });
  const normalized = incoming.map((row, index) => {
    const error = validExpense(row || {});
    return error ? { error: `Row ${index + 1}: ${error}` } : {
      description: row.description.trim(), amount: Number(row.amount), category: row.category,
      spent_on: row.spent_on, note: typeof row.note === 'string' ? row.note.trim().slice(0, 240) : ''
    };
  });
  const invalid = normalized.find(row => row.error);
  if (invalid) return res.status(400).json({ error: invalid.error });
  const insert = db.prepare('INSERT INTO expenses (user_id, description, amount, category, spent_on, note) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(rows => rows.forEach(row => insert.run(Number(req.user.id), row.description, row.amount, row.category, row.spent_on, row.note)))(normalized);
  res.status(201).json({ imported: normalized.length });
});
app.post('/api/expenses', (req, res) => {
  const error = validExpense(req.body || {});
  if (error) return res.status(400).json({ error });
  const result = db.prepare('INSERT INTO expenses (user_id, description, amount, category, spent_on, note) VALUES (@user_id, @description, @amount, @category, @spent_on, @note)').run({
    user_id: Number(req.user.id), description: req.body.description.trim(), amount: Number(req.body.amount), category: req.body.category,
    spent_on: req.body.spent_on, note: typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 240) : ''
  });
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(result.lastInsertRowid, Number(req.user.id)));
});
app.get('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid expense id.' });
  const expense = db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(id, Number(req.user.id));
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  res.json(expense);
});
app.patch('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid expense id.' });
  const existing = db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(id, Number(req.user.id));
  if (!existing) return res.status(404).json({ error: 'Expense not found.' });
  const body = { ...existing, ...req.body };
  const error = validExpense(body);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE expenses SET description=@description, amount=@amount, category=@category, spent_on=@spent_on, note=@note WHERE id=@id AND user_id=@user_id').run({
    id, user_id: Number(req.user.id), description: body.description.trim(), amount: Number(body.amount), category: body.category, spent_on: body.spent_on,
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 240) : ''
  });
  res.json(db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(id, Number(req.user.id)));
});
app.delete('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid expense id.' });
  const result = db.prepare('DELETE FROM expenses WHERE id=? AND user_id=?').run(id, Number(req.user.id));
  if (!result.changes) return res.status(404).json({ error: 'Expense not found.' });
  res.status(204).end();
});
app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare('SELECT spent_on, description, category, amount, note FROM expenses WHERE user_id=? ORDER BY spent_on DESC, id DESC').all(Number(req.user.id));
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = ['Date,Description,Category,Amount (INR),Note', ...rows.map(row => [row.spent_on, row.description, row.category, row.amount.toFixed(2), row.note].map(quote).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pocket-ledger-expenses.csv"');
  res.send(csv);
});
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Pocket Ledger listening on 0.0.0.0:${PORT}`));
}
module.exports = { app, db, validExpense };
