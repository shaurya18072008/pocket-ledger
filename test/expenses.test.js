const test = require('node:test');
const assert = require('node:assert/strict');
const { app, validExpense } = require('../server');

const good = { description: 'Test expense', amount: 42.5, category: 'Food & drink', spent_on: '2026-10-28', note: '' };
let nameCount = 0;
function accountName(label='Tester') { nameCount += 1; return `${label} ${Date.now()} ${nameCount}`; }
async function serverFor(t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options={}) => fetch(`${base}${url}`, options);
  const json = (url, body, cookie='') => request(url, {
    method:'POST', headers:{'Content-Type':'application/json', ...(cookie?{Cookie:cookie}:{})}, body:JSON.stringify(body)
  });
  return { request, json };
}
async function createAccount(api, name=accountName()) {
  const response=await api.json('/api/auth/signup',{name,password:'Ledger-secret-26'});
  assert.equal(response.status,201);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  return {cookie,user:await response.json(),name};
}

test('expense validation accepts valid entries and rejects unsafe input', () => {
  assert.equal(validExpense(good), null);
  assert.match(validExpense({ ...good, description: '  ' }), /name/);
  assert.match(validExpense({ ...good, amount: -1 }), /amount/);
  assert.match(validExpense({ ...good, amount: 'not a number' }), /amount/);
  assert.match(validExpense({ ...good, spent_on: '2026-02-31' }), /valid date/);
  assert.match(validExpense({ ...good, category: 'Unsorted' }), /category/);
});

test('sign-up requires a name and a password of at least eight characters', async t => {
  const api=await serverFor(t);
  const short=await api.json('/api/auth/signup',{name:'Asha',password:'short'});
  assert.equal(short.status,400);
  assert.match((await short.json()).error,/8 characters/);
  const missing=await api.json('/api/auth/signup',{name:' ' ,password:'long-enough'});
  assert.equal(missing.status,400);
});

test('private API refuses anonymous requests and new accounts start with a private ledger', async t => {
  const api=await serverFor(t);
  assert.equal((await api.request('/api/expenses')).status,401);
  const created=await createAccount(api);
  assert.match(created.cookie,/^pocket_session=/);
  const cookieHeader=await api.request('/api/auth/status',{headers:{Cookie:created.cookie}});
  const status=await cookieHeader.json();
  assert.equal(status.authenticated,true);
  assert.equal(status.user.name,created.name);
  const expenses=await api.request('/api/expenses',{headers:{Cookie:created.cookie}});
  assert.deepEqual(await expenses.json(),[]);
});

test('sandbox login response supports the dashboard preview token without relying on iframe cookies', async t => {
  const api=await serverFor(t);
  const account=await createAccount(api,accountName('Preview'));
  const login=await api.json('/api/auth/login',{name:account.name,password:'Ledger-secret-26'});
  const result=await login.json();
  assert.equal(login.status,200);
  assert.ok(result.previewToken);
  const claims=JSON.parse(Buffer.from(result.previewToken.split('.')[1],'base64url').toString());
  assert.equal(claims.exp-claims.iat,7*24*60*60);
  const status=await api.request('/api/auth/status',{headers:{Authorization:`Bearer ${result.previewToken}`}});
  assert.equal((await status.json()).authenticated,true);
  const dashboard=await api.request(`/dashboard?preview=${encodeURIComponent(result.previewToken)}`,{redirect:'manual'});
  assert.equal(dashboard.status,200);
  const shell=await dashboard.text();
  assert.match(shell,/account-menu-button/);
  assert.match(shell,/Import CSV\/JSON/);
  const dashboardScript=await (await api.request('/app.js?v=20261028-persistent-session')).text();
  assert.match(dashboardScript,/new URLSearchParams\(location.search\)/);
  assert.doesNotMatch(dashboardScript,/history\.replaceState/);
  const homepageScript=await (await api.request('/home.js?v=20261028-loginfix')).text();
  assert.match(homepageScript,/dashboard\?preview=/);
});

test('CSV/JSON batch import validates all rows and keeps records account-scoped', async t => {
  const api=await serverFor(t);
  const owner=await createAccount(api,accountName('Importer'));
  const other=await createAccount(api,accountName('Separate'));
  const expenses=[
    {description:'Market',amount:1250.5,category:'Groceries',spent_on:'2026-10-27',note:'weekly shop'},
    {description:'Metro',amount:40,category:'Transport',spent_on:'2026-10-28',note:''}
  ];
  const imported=await api.json('/api/expenses/import',{expenses},owner.cookie);
  assert.equal(imported.status,201);
  assert.equal((await imported.json()).imported,2);
  const rows=await api.request('/api/expenses?month=2026-10',{headers:{Cookie:owner.cookie}});
  assert.deepEqual((await rows.json()).map(row=>row.description).sort(),['Market','Metro']);
  const guests=await api.request('/api/expenses',{headers:{Cookie:other.cookie}});
  assert.deepEqual(await guests.json(),[]);
  const rejected=await api.json('/api/expenses/import',{expenses:[...expenses,{...expenses[0],category:'Not a category'}]},owner.cookie);
  assert.equal(rejected.status,400);
  assert.match((await rejected.json()).error,/Row 3/);
  const after=await api.request('/api/expenses?month=2026-10',{headers:{Cookie:owner.cookie}});
  assert.equal((await after.json()).length,2);
});

test('account records are isolated; owner can edit/delete, and logout locks the API', async t => {
  const api=await serverFor(t);
  const owner=await createAccount(api,accountName('Owner'));
  const another=await createAccount(api,accountName('Guest'));
  const made=await api.json('/api/expenses',{...good,spent_on:'2001-01-02'},owner.cookie);
  assert.equal(made.status,201);
  const expense=await made.json();
  const ownRows=await api.request('/api/expenses?month=2001-01&category=Food%20%26%20drink&search=Test',{headers:{Cookie:owner.cookie}});
  assert.equal((await ownRows.json()).some(row=>row.id===expense.id),true);
  const guestsRows=await api.request('/api/expenses',{headers:{Cookie:another.cookie}});
  assert.deepEqual(await guestsRows.json(),[]);
  const hiddenDetail=await api.request(`/api/expenses/${expense.id}`,{headers:{Cookie:another.cookie}});
  assert.equal(hiddenDetail.status,404);
  const changed=await api.request(`/api/expenses/${expense.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:owner.cookie},body:JSON.stringify({description:'Edited test expense'})});
  assert.equal((await changed.json()).description,'Edited test expense');
  assert.equal((await api.request(`/api/expenses/${expense.id}`,{method:'DELETE',headers:{Cookie:owner.cookie}})).status,204);
  const logout=await api.request('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:owner.cookie},body:'{}'});
  assert.equal(logout.status,204);
  assert.equal((await api.request('/api/expenses',{headers:{Cookie:logout.headers.get('set-cookie').split(';')[0]}})).status,401);
});

test('sign-in checks the password and restores the same account', async t => {
  const api=await serverFor(t);
  const account=await createAccount(api);
  const bad=await api.json('/api/auth/login',{name:account.name,password:'wrong-password'});
  assert.equal(bad.status,401);
  const goodLogin=await api.json('/api/auth/login',{name:account.name,password:'Ledger-secret-26'});
  assert.equal(goodLogin.status,200);
  assert.equal((await goodLogin.json()).user.name,account.name);
  assert.match(goodLogin.headers.get('set-cookie'),/HttpOnly/);
});

test('demo is a static, read-only dashboard and does not create a session', async t => {
  const api=await serverFor(t);
  assert.equal((await api.request('/dashboard',{redirect:'manual'})).status,200);
  const response=await api.request('/demo',{redirect:'manual'});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/DEMO · READ ONLY/);
  assert.match(html,/Back to Homepage/);
  assert.match(html,/text-decoration:none!important/);
  assert.match(html,/demo-period-pill/);
  assert.match(html,/justify-content:center/);
  assert.match(html,/demo\.js/);
  assert.doesNotMatch(html,/app\.js|add-expense|logout-button|auth\/demo/);
  const demoScript=await (await api.request('/demo.js')).text();
  assert.match(demoScript,/\$\('#category-filter'\)\.value=selectedCategory/);
  assert.doesNotMatch(demoScript,/fetch\(|\/api\//);
  assert.equal(response.headers.get('set-cookie'),null);
  const session=await api.request('/api/auth/status');
  assert.deepEqual(await session.json(),{authenticated:false});
});

test('CSV export safely escapes quotes and is limited to the signed-in account', async t => {
  const api=await serverFor(t);
  const account=await createAccount(api);
  const created=await api.json('/api/expenses',{...good,description:'Expense "quoted"',category:'Other',spent_on:'2001-02-03'},account.cookie);
  const expense=await created.json();
  const response=await api.request('/api/export.csv',{headers:{Cookie:account.cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/csv/);
  const csv=await response.text();
  assert.match(csv, /"Expense ""quoted"""/);
  await api.request(`/api/expenses/${expense.id}`,{method:'DELETE',headers:{Cookie:account.cookie}});
});
