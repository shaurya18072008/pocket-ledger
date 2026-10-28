const COLORS = {
  'Food & drink': '#d9785c', Groceries: '#8b9c60', Transport: '#6089a2', Bills: '#8778b3',
  Shopping: '#cf9a4e', Home: '#8a8176', Health: '#c56d82', Entertainment: '#619b8c', Other: '#7c8490'
};
const ICONS = {
  'Food & drink': '<path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10h0a2.5 2.5 0 0 0 2.5-2.5V3M7 10v11M16 3v18M16 3c2.1 1.6 3 4 3 7h-3"/>',
  Groceries: '<path d="M4 9h16l-1.5 11h-13zM8 9l4-5 4 5M9 13v4M15 13v4"/>',
  Transport: '<path d="M5 4h14v14H5zM5 8h14M8 18l-2 3m10-3 2 3M8 12h.01M16 12h.01"/>',
  Bills: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  Shopping: '<path d="M5 8h14l1 12H4zM9 8a3 3 0 0 1 6 0"/>',
  Home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6"/>',
  Health: '<path d="M20.5 8.8c0 5.2-8.5 11-8.5 11s-8.5-5.8-8.5-11A4.5 4.5 0 0 1 12 6.2a4.5 4.5 0 0 1 8.5 2.6Z"/>',
  Entertainment: '<path d="M5 4.5h14v15H5zM10 9l5 3.5-5 3.5z"/>',
  Other: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
const $ = selector => document.querySelector(selector);
// Local sandbox previews may block cookies. Keep the seven-day preview token in the dashboard URL so a refresh preserves this account session.
const legacyHashToken = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '';
const queryToken = new URLSearchParams(location.search).get('preview') || '';
const sandboxToken = queryToken || legacyHashToken;
window.POCKET_SANDBOX_TOKEN = sandboxToken;
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const monthLabel = value => new Date(`${value}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const localIso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const api = async (url, options={}) => {
  const { headers: customHeaders, ...fetchOptions } = options;
  const sandboxAuth = window.POCKET_SANDBOX_TOKEN ? { Authorization: `Bearer ${window.POCKET_SANDBOX_TOKEN}` } : {};
  const response = await fetch(url, { ...fetchOptions, headers: { 'Content-Type': 'application/json', ...sandboxAuth, ...(customHeaders || {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || 'That didn’t work. Please try again.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
};
let activeMonth = localIso(new Date()).slice(0,7);
let categories = [];
let activeCategory = '';
let allVisible = false;
let editingId = null;
let toastTimer;
let cachedRows = [];

function categoryIcon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.Other}</svg>`; }
function safeText(value) { const el = document.createElement('span'); el.textContent = value ?? ''; return el.innerHTML; }
function categoryBackground(color, alpha='18') { return `${color}${alpha}`; }

async function init() {
  let session;
  try { session = await api('/api/auth/status'); }
  catch (error) {
    console.error('Session check failed:', error);
    toast('Could not verify your account right now. Your dashboard is still here—try refreshing in a moment.');
    return;
  }
  if (!session.authenticated) { location.replace('/'); return; }
  const name = session.user.name || 'My ledger';
  $('#profile-name').textContent = name;
  $('#profile-type').textContent = 'Password-protected';
  $('#profile-initial').textContent = [...name.trim()][0]?.toUpperCase() || 'P';
  document.querySelector('.avatar-small').textContent = [...name.trim()][0]?.toUpperCase() || 'P';
  $('#account-menu-button').setAttribute('aria-label', `Account menu for ${name}`);
  document.querySelector('.breadcrumb span').textContent = name;
  const today = new Date();
  $('#today-label').textContent = today.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  $('#welcome-date').textContent = today.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();
  categories = await api('/api/categories');
  renderCategoryControls();
  bindEvents();
  await loadDashboard();
}

function renderCategoryControls() {
  $('#side-categories').innerHTML = categories.map(c => `<button class="side-category" data-category="${safeText(c.name)}"><i class="category-dot" style="background:${c.color}"></i><span>${safeText(c.name)}</span></button>`).join('');
  $('#category-filter').insertAdjacentHTML('beforeend', categories.map(c => `<option>${safeText(c.name)}</option>`).join(''));
  $('#form-category').innerHTML = '<option value="" disabled selected>Choose a category</option>' + categories.map(c => `<option>${safeText(c.name)}</option>`).join('');
}

async function loadDashboard() {
  $('#month-heading').textContent = monthLabel(activeMonth);
  $('#chart-month-start').textContent = new Date(`${activeMonth}-01T12:00:00`).toLocaleDateString('en-IN',{month:'short'});
  try {
    const [summary, rows] = await Promise.all([
      api(`/api/summary?month=${activeMonth}`),
      api(`/api/expenses?month=${activeMonth}&${activeCategory ? `category=${encodeURIComponent(activeCategory)}&` : ''}${$('#search-input').value ? `search=${encodeURIComponent($('#search-input').value)}&` : ''}limit=200`)
    ]);
    cachedRows = rows;
    renderSummary(summary);
    renderTransactions(rows);
    renderCategories(summary);
  } catch (error) {
    toast(error.message);
  }
}

function renderSummary(data) {
  $('#monthly-total').textContent = new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(data.total || 0);
  $('#entry-total').textContent = data.count;
  const today = new Date();
  const [year, month] = data.month.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const sameMonth = year === today.getFullYear() && month === today.getMonth()+1;
  const elapsed = sameMonth ? today.getDate() : daysInMonth;
  $('#chart-day-end').textContent = `${elapsed} ${new Date(year, month-1, 1).toLocaleDateString('en-IN',{month:'short'})}`;
  $('#daily-average').textContent = money(elapsed ? data.total / elapsed : 0);
  const change = data.changePercent;
  const changeNode = $('#change-indicator');
  if (change === null) {
    changeNode.textContent = '●'; changeNode.classList.remove('down'); $('#change-copy').textContent = 'No previous month to compare';
  } else {
    const positive = change > 0;
    changeNode.textContent = positive ? '↑' : change < 0 ? '↓' : '●';
    changeNode.classList.toggle('down', positive);
    $('#change-copy').textContent = `${Math.abs(change).toFixed(0)}% ${positive ? 'more' : change < 0 ? 'less' : 'same'} than last month`;
  }
  $('#snapshot-note').textContent = data.count ? `${data.count} little notes on your month` : 'A fresh page for this month';
  renderChart(data.daily, elapsed, daysInMonth);
}

function renderChart(daily, elapsed, daysInMonth) {
  const values = Array(daysInMonth).fill(0);
  daily.forEach(item => { const day = Number(item.day.slice(-2)); if (day > 0 && day <= daysInMonth) values[day-1] = item.amount; });
  const max = Math.max(...values, 1);
  const totalBars = Math.min(elapsed, 28);
  const sampled = [];
  if (elapsed > totalBars) {
    for (let i=0; i<totalBars; i++) { const start=Math.floor(i*elapsed/totalBars), end=Math.floor((i+1)*elapsed/totalBars); sampled.push(Math.max(...values.slice(start, Math.max(start+1,end)))); }
  } else sampled.push(...values.slice(0, totalBars));
  $('#mini-chart').innerHTML = sampled.map((amount, index) => {
    const h = amount ? Math.max(9, (amount/max)*100) : 4;
    const isToday = index === sampled.length-1 && elapsed === new Date().getDate() && activeMonth === localIso(new Date()).slice(0,7);
    return `<span class="chart-bar-wrap" title="${money(amount)}"><i class="chart-bar ${isToday?'today':''}" style="height:${h}%"></i></span>`;
  }).join('');
}

function renderCategories(summary) {
  const rows = summary.categories || [];
  const total = summary.total || 0;
  $('#category-total').textContent = money(total);
  $('#category-subtitle').textContent = activeCategory ? `Showing ${activeCategory}` : 'Spending by category';
  $('#clear-category').hidden = !activeCategory;
  const segments = rows.map(item => {
    const color = COLORS[item.category] || COLORS.Other;
    return `<button class="category-segment" aria-label="${safeText(item.category)}: ${money(item.amount)}" title="${safeText(item.category)} — ${money(item.amount)}" data-category="${safeText(item.category)}" style="width:${total ? item.amount/total*100 : 0}%;background:${color};${activeCategory && activeCategory!==item.category?'opacity:.3':''}"></button>`;
  }).join('');
  $('#category-bars').innerHTML = segments || '<span style="color:#9ba8a0;font-size:10px">Add an expense to see your breakdown.</span>';
  $('#category-legend').innerHTML = rows.slice(0,8).map(item => `<button class="legend-item" data-category="${safeText(item.category)}" title="Filter ${safeText(item.category)}"><i class="legend-dot" style="background:${COLORS[item.category]||COLORS.Other}"></i><span class="legend-name">${safeText(item.category)}</span><span class="legend-value">${total ? Math.round(item.amount/total*100) : 0}%</span></button>`).join('');
  if (rows.length) {
    const largest = rows[0];
    const share = Math.round(largest.amount / total * 100);
    $('#observation').textContent = `${largest.category} is your biggest category this month, at ${share}% of what you’ve spent.`;
  } else $('#observation').textContent = 'A new month is a clean slate. Add an expense to see where it goes.';
}

function renderTransactions(rows) {
  $('#transaction-count').textContent = rows.length;
  const visible = allVisible ? rows : rows.slice(0,7);
  $('#showing-count').textContent = rows.length ? `Showing ${visible.length} of ${rows.length} ${rows.length===1?'entry':'entries'}` : 'No entries yet';
  $('#view-all').hidden = rows.length <= 7;
  $('#view-all').innerHTML = allVisible ? 'Show fewer <span>↗</span>' : 'View all transactions <span>↗</span>';
  $('#empty-state').hidden = rows.length !== 0;
  $('.table-head').style.display = rows.length ? 'grid' : 'none';
  $('.list-footer').style.display = rows.length ? 'flex' : 'none';
  $('#transaction-list').innerHTML = visible.map(row => {
    const color = COLORS[row.category] || COLORS.Other;
    return `<article class="transaction-row" data-id="${row.id}">
      <div class="expense-info"><span class="expense-icon" style="background:${categoryBackground(color)};color:${color}">${categoryIcon(row.category)}</span><span class="expense-text"><strong>${safeText(row.description)}</strong><small>${row.note ? safeText(row.note) : 'Personal expense'}</small></span></div>
      <div><span class="category-tag"><i style="background:${color}"></i>${safeText(row.category)}</span></div>
      <time class="transaction-date" datetime="${row.spent_on}">${dateLabel(row.spent_on)}</time>
      <strong class="transaction-amount">−${money(row.amount)}</strong>
      <div class="row-actions"><button class="row-menu" aria-label="Actions for ${safeText(row.description)}" data-menu="${row.id}">···</button></div>
    </article>`;
  }).join('');
}

function openModal(row=null) {
  editingId = row?.id ?? null;
  const form = $('#expense-form'); form.reset();
  $('#modal-title').textContent = editingId ? 'Edit expense' : 'Add an expense';
  $('#save-expense').textContent = editingId ? 'Save changes' : 'Save expense';
  $('#form-error').textContent = '';
  form.elements.description.value = row?.description || '';
  form.elements.amount.value = row?.amount ?? '';
  form.elements.spent_on.value = row?.spent_on || localIso(new Date());
  form.elements.category.value = row?.category || '';
  form.elements.note.value = row?.note || '';
  $('#modal-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#description').focus(), 40);
}
function closeModal() { $('#modal-backdrop').hidden = true; document.body.style.overflow = ''; editingId = null; }
function toast(message) { const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2400); }
function selectCategory(category) {
  activeCategory = activeCategory === category ? '' : category;
  $('#category-filter').value = activeCategory;
  document.querySelectorAll('.side-category').forEach(button => button.classList.toggle('selected', button.dataset.category === activeCategory));
  allVisible = false; loadDashboard();
}

function csvRows(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === '') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  return rows;
}
function importField(record, aliases) {
  const keys = Object.keys(record || {});
  const match = keys.find(key => aliases.includes(key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return match === undefined ? '' : record[match];
}
function normalizeImportRow(record) {
  const dateValue = String(importField(record, ['date','spenton','transactiondate','expensedate']) ?? '').trim();
  const amountText = String(importField(record, ['amount','amountinr','value','spent']) ?? '').replace(/[₹,\s]/g, '');
  return {
    description: String(importField(record, ['description','expense','name','title','item','whatfor']) ?? '').trim(),
    amount: amountText ? Number(amountText) : NaN,
    category: String(importField(record, ['category','type']) ?? '').trim(),
    spent_on: /^\d{4}-\d{2}-\d{2}/.test(dateValue) ? dateValue.slice(0,10) : dateValue,
    note: String(importField(record, ['note','details','memo']) ?? '').trim()
  };
}
function parseImportFile(text, fileName) {
  if (fileName.toLowerCase().endsWith('.csv')) {
    const table = csvRows(text);
    if (table.length < 2) throw new Error('CSV needs a header row and at least one transaction.');
    const headers = table[0].map(header => header.trim());
    const normalizedHeaders = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!normalizedHeaders.some(header => ['description','expense','name','title','item','whatfor'].includes(header)) || !normalizedHeaders.some(header => ['amount','amountinr','value','spent'].includes(header))) {
      throw new Error('CSV headers must include a description and amount column.');
    }
    return table.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))).map(normalizeImportRow);
  }
  if (fileName.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : parsed?.expenses || parsed?.transactions || parsed?.data;
    if (!Array.isArray(records)) throw new Error('JSON must be an array of transactions, or contain an expenses or transactions array.');
    return records.map(normalizeImportRow);
  }
  throw new Error('Choose a CSV or JSON file.');
}
async function importTransactions(file) {
  const rows = parseImportFile(await file.text(), file.name);
  if (!rows.length) throw new Error('There are no transaction rows to import.');
  if (rows.length > 500) throw new Error('Import up to 500 transactions at a time.');
  const result = await api('/api/expenses/import', { method: 'POST', body: JSON.stringify({ expenses: rows }) });
  activeCategory = ''; $('#category-filter').value = '';
  document.querySelectorAll('.side-category').forEach(button => button.classList.remove('selected'));
  allVisible = false;
  const newestDate = rows.map(row => row.spent_on).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
  if (newestDate) activeMonth = newestDate.slice(0,7);
  await loadDashboard();
  toast(`${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'} imported`);
}

function bindEvents() {
  const accountMenu = $('#account-menu');
  const accountMenuButton = $('#account-menu-button');
  const closeAccountMenu = () => { accountMenu.hidden = true; accountMenuButton.setAttribute('aria-expanded', 'false'); };
  accountMenuButton.addEventListener('click', event => {
    event.stopPropagation();
    accountMenu.hidden = !accountMenu.hidden;
    accountMenuButton.setAttribute('aria-expanded', String(!accountMenu.hidden));
  });
  document.addEventListener('click', event => { if (!event.target.closest('.account-menu-wrap')) closeAccountMenu(); });
  $('#import-expenses').addEventListener('click', () => $('#expense-import-file').click());
  $('#expense-import-file').addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const button = $('#import-expenses'); button.disabled = true;
    try { await importTransactions(file); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; event.currentTarget.value = ''; }
  });
  $('#add-expense').addEventListener('click', () => openModal());
  $('#empty-add').addEventListener('click', () => openModal());
  $('#close-modal').addEventListener('click', closeModal);
  $('#cancel-modal').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', event => { if (event.target === $('#modal-backdrop')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeAccountMenu(); document.querySelectorAll('.row-menu-pop').forEach(el=>el.remove()); } });
  $('#expense-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    data.amount = Number(data.amount);
    $('#save-expense').disabled = true;
    try {
      await api(editingId ? `/api/expenses/${editingId}` : '/api/expenses', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      const message = editingId ? 'Expense updated' : 'Expense added to your ledger';
      const savedMonth = data.spent_on.slice(0,7);
      closeModal();
      activeMonth = savedMonth;
      activeCategory = '';
      $('#category-filter').value = '';
      document.querySelectorAll('.side-category').forEach(button=>button.classList.remove('selected'));
      allVisible = false;
      await loadDashboard(); toast(message);
    } catch (error) { $('#form-error').textContent = error.message; }
    finally { $('#save-expense').disabled = false; }
  });
  $('#prev-month').addEventListener('click', () => moveMonth(-1));
  $('#next-month').addEventListener('click', () => moveMonth(1));
  $('#month-today').addEventListener('click', () => { activeMonth=localIso(new Date()).slice(0,7); allVisible=false; loadDashboard(); });
  $('#search-input').addEventListener('input', debounce(() => { allVisible=false; loadDashboard(); }, 250));
  $('#category-filter').addEventListener('change', event => { activeCategory=event.target.value; document.querySelectorAll('.side-category').forEach(button=>button.classList.toggle('selected',button.dataset.category===activeCategory)); allVisible=false; loadDashboard(); });
  $('#side-categories').addEventListener('click', event => { const button=event.target.closest('[data-category]'); if(button) selectCategory(button.dataset.category); });
  $('#category-bars').addEventListener('click', event => { const button=event.target.closest('[data-category]'); if(button) selectCategory(button.dataset.category); });
  $('#category-legend').addEventListener('click', event => { const button=event.target.closest('[data-category]'); if(button) selectCategory(button.dataset.category); });
  $('#clear-category').addEventListener('click', () => { activeCategory=''; $('#category-filter').value=''; document.querySelectorAll('.side-category').forEach(button=>button.classList.remove('selected')); loadDashboard(); });
  $('#view-all').addEventListener('click', () => { allVisible=!allVisible; renderTransactions(cachedRows); });
  $('#transaction-list').addEventListener('click', async event => {
    const menuButton = event.target.closest('[data-menu]');
    const action = event.target.closest('[data-action]');
    if (menuButton) {
      document.querySelectorAll('.row-menu-pop').forEach(el=>el.remove());
      const row = cachedRows.find(item=>item.id===Number(menuButton.dataset.menu));
      const pop = document.createElement('div'); pop.className='row-menu-pop';
      pop.innerHTML='<button data-action="edit">Edit expense</button><button class="delete-action" data-action="delete">Delete expense</button>';
      menuButton.parentElement.appendChild(pop); pop.dataset.row = row.id; return;
    }
    if (action) {
      const pop=action.closest('.row-menu-pop'); const row=cachedRows.find(item=>item.id===Number(pop.dataset.row));
      if(action.dataset.action==='edit') { pop.remove(); openModal(row); }
      else if (confirm(`Delete “${row.description}”? This can’t be undone.`)) {
        try { await api(`/api/expenses/${row.id}`,{method:'DELETE'}); await loadDashboard(); toast('Expense deleted'); } catch(error) { toast(error.message); }
      }
    } else document.querySelectorAll('.row-menu-pop').forEach(el=>el.remove());
  });
  $('#export-button').addEventListener('click', () => { window.location.href='/api/export.csv'; });
  $('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout',{method:'POST'}); } finally { window.POCKET_SANDBOX_TOKEN=''; location.replace('/'); } });
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  document.querySelectorAll('.nav-item').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active')); link.classList.add('active'); $('#sidebar').classList.remove('open'); }));
}
function moveMonth(step) {
  const [y,m]=activeMonth.split('-').map(Number);
  const date=new Date(y,m-1+step,1);
  activeMonth=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  activeCategory=''; $('#category-filter').value=''; document.querySelectorAll('.side-category').forEach(button=>button.classList.remove('selected')); allVisible=false; loadDashboard();
}
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer=setTimeout(()=>fn(...args),delay); }; }

init().catch(error => { console.error(error); toast('Could not load your ledger. Check that the server is running.'); });
