const CATEGORIES = [
  { name: 'Food & drink', color: '#d9785c', icon: 'fork' },
  { name: 'Groceries', color: '#8b9c60', icon: 'basket' },
  { name: 'Transport', color: '#6089a2', icon: 'train' },
  { name: 'Bills', color: '#8778b3', icon: 'bolt' },
  { name: 'Shopping', color: '#cf9a4e', icon: 'bag' },
  { name: 'Home', color: '#8a8176', icon: 'home' },
  { name: 'Health', color: '#c56d82', icon: 'heart' },
  { name: 'Entertainment', color: '#619b8c', icon: 'play' },
  { name: 'Other', color: '#7c8490', icon: 'dots' }
];
function normalizeName(name) {
  return String(name || '').trim().normalize('NFKC').toLocaleLowerCase('en');
}
function validateName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const length = [...trimmed].length;
  if (length < 2 || length > 40) return 'Your name must be between 2 and 40 characters.';
  if (/[\u0000-\u001F\u007F]/u.test(trimmed)) return 'That name contains characters we can’t use.';
  return null;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use a password with at least 8 characters.';
  if (password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) return 'Passwords must be 72 characters or fewer.';
  return null;
}
function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isValidMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function validExpense(body) {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const amount = Number(body.amount);
  const spent_on = typeof body.spent_on === 'string' ? body.spent_on : '';
  const category = typeof body.category === 'string' ? body.category : '';
  if (!description || description.length > 100) return 'Give this expense a name (up to 100 characters).';
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return 'Enter an amount greater than ₹0.';
  if (!isValidIsoDate(spent_on)) return 'Choose a valid date.';
  if (!CATEGORIES.some(item => item.name === category)) return 'Choose a category from the list.';
  return null;
}
module.exports = { CATEGORIES, normalizeName, validateName, validatePassword, isValidIsoDate, isValidMonth, validExpense };
