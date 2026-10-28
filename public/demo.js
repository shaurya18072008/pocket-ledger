const DEMO_CATEGORIES=[
  {name:'Food & drink',color:'#d9785c'}, {name:'Groceries',color:'#8b9c60'}, {name:'Transport',color:'#6089a2'},
  {name:'Bills',color:'#8778b3'}, {name:'Shopping',color:'#cf9a4e'}, {name:'Home',color:'#8a8176'},
  {name:'Health',color:'#c56d82'}, {name:'Entertainment',color:'#619b8c'}, {name:'Other',color:'#7c8490'}
];
const DEMO_EXPENSES=[
  {description:'Dinner at Sienna',amount:1480,category:'Food & drink',spent_on:'2026-10-27',note:'Dinner with friends'},
  {description:'Metro card top-up',amount:500,category:'Transport',spent_on:'2026-10-26',note:''},
  {description:'Weekly groceries',amount:2365,category:'Groceries',spent_on:'2026-10-25',note:'Sunday market'},
  {description:'The Daily coffee',amount:280,category:'Food & drink',spent_on:'2026-10-24',note:''},
  {description:'Jio Fiber',amount:999,category:'Bills',spent_on:'2026-10-22',note:'Monthly internet'},
  {description:'Bookstore — Oxford',amount:750,category:'Shopping',spent_on:'2026-10-21',note:'A book for the train'},
  {description:'Uber to Salt Lake',amount:420,category:'Transport',spent_on:'2026-10-19',note:''},
  {description:'Pharmacy',amount:365,category:'Health',spent_on:'2026-10-17',note:''},
  {description:'Lunch at 6 Ballygunge',amount:890,category:'Food & drink',spent_on:'2026-10-15',note:''},
  {description:'Electricity bill',amount:1830,category:'Bills',spent_on:'2026-10-13',note:'CESC'},
  {description:'Vegetables & fruit',amount:645,category:'Groceries',spent_on:'2026-10-11',note:''},
  {description:'Movie tickets',amount:680,category:'Entertainment',spent_on:'2026-10-09',note:'Friday night'},
  {description:'Cab to airport',amount:720,category:'Transport',spent_on:'2026-10-07',note:''},
  {description:'Household supplies',amount:1120,category:'Shopping',spent_on:'2026-10-04',note:''},
  {description:'Brunch at Flurys',amount:960,category:'Food & drink',spent_on:'2026-10-02',note:''}
];
const $=selector=>document.querySelector(selector);
const formatMoney=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value||0);
const safe=value=>{const span=document.createElement('span');span.textContent=value??'';return span.innerHTML;};
let selectedCategory='';let expanded=false;
function paintOverview(){
  const total=DEMO_EXPENSES.reduce((sum,item)=>sum+item.amount,0);
  const byCategory=DEMO_EXPENSES.reduce((map,item)=>{map[item.category]=(map[item.category]||0)+item.amount;return map;},{});
  const rows=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]);
  $('#monthly-total').textContent=new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(total);
  $('#entry-total').textContent=DEMO_EXPENSES.length;
  $('#daily-average').textContent=formatMoney(total/28);
  $('#change-copy').textContent='47% less than last month';
  $('#snapshot-note').textContent='15 little notes on your month';
  $('#category-total').textContent=formatMoney(total);
  $('#category-bars').innerHTML=rows.map(([name,value])=>`<button class="category-segment" data-category="${safe(name)}" title="${safe(name)} — ${formatMoney(value)}" aria-label="Filter ${safe(name)}" style="width:${value/total*100}%;background:${DEMO_CATEGORIES.find(c=>c.name===name).color}"></button>`).join('');
  $('#category-legend').innerHTML=rows.map(([name,value])=>`<button class="legend-item" data-category="${safe(name)}" title="Filter ${safe(name)}"><i class="legend-dot" style="background:${DEMO_CATEGORIES.find(c=>c.name===name).color}"></i><span class="legend-name">${safe(name)}</span><span class="legend-value">${Math.round(value/total*100)}%</span></button>`).join('');
  const daily=Array(28).fill(0);DEMO_EXPENSES.forEach(item=>{daily[Number(item.spent_on.slice(-2))-1]+=item.amount;});const max=Math.max(...daily);
  $('#mini-chart').innerHTML=daily.map((value,index)=>`<span class="chart-bar-wrap" title="${index+1} Oct · ${formatMoney(value)}"><i class="chart-bar ${index===27?'today':''}" style="height:${value?Math.max(8,value/max*100):3}%"></i></span>`).join('');
}
function renderCategories(){
  $('#side-categories').innerHTML=DEMO_CATEGORIES.filter(category=>DEMO_EXPENSES.some(item=>item.category===category.name)).map(category=>`<button class="side-category ${selectedCategory===category.name?'selected':''}" data-category="${safe(category.name)}"><i class="category-dot" style="background:${category.color}"></i><span>${safe(category.name)}</span></button>`).join('');
  $('#category-filter').innerHTML='<option value="">All categories</option>'+DEMO_CATEGORIES.filter(category=>DEMO_EXPENSES.some(item=>item.category===category.name)).map(category=>`<option value="${safe(category.name)}">${safe(category.name)}</option>`).join('');
  $('#category-filter').value=selectedCategory;
}
function renderTransactions(){
  const query=$('#search-input').value.trim().toLocaleLowerCase();
  const filtered=DEMO_EXPENSES.filter(item=>(!selectedCategory||item.category===selectedCategory)&&(!query||`${item.description} ${item.note}`.toLocaleLowerCase().includes(query)));
  const shown=expanded?filtered:filtered.slice(0,7);
  $('#transaction-count').textContent=filtered.length;
  $('#showing-count').textContent=filtered.length?`Showing ${shown.length} of ${filtered.length} ${filtered.length===1?'entry':'entries'}`:'No matching entries';
  $('#view-all').hidden=filtered.length<=7;
  $('#view-all').innerHTML=expanded?'Show fewer <span>↗</span>':'View all transactions <span>↗</span>';
  $('#empty-state').hidden=filtered.length!==0;
  $('.table-head').style.display=filtered.length?'grid':'none';
  $('.list-footer').style.display=filtered.length?'flex':'none';
  $('#transaction-list').innerHTML=shown.map(item=>{
    const category=DEMO_CATEGORIES.find(entry=>entry.name===item.category)||DEMO_CATEGORIES.at(-1);
    const icon=item.category==='Transport'?'<path d="M5 4h14v14H5zM5 8h14M8 18l-2 3m10-3 2 3M8 12h.01M16 12h.01"/>':item.category==='Food & drink'?'<path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10h0a2.5 2.5 0 0 0 2.5-2.5V3M7 10v11M16 3v18M16 3c2.1 1.6 3 4 3 7h-3"/>':'<path d="M6 4h12v16H6zM9 8h6M9 12h6"/>';
    return `<article class="transaction-row"><div class="expense-info"><span class="expense-icon" style="background:${category.color}18;color:${category.color}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><span class="expense-text"><strong>${safe(item.description)}</strong><small>${safe(item.note||'Personal expense')}</small></span></div><div><span class="category-tag"><i style="background:${category.color}"></i>${safe(item.category)}</span></div><time class="transaction-date" datetime="${item.spent_on}">${new Date(`${item.spent_on}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</time><strong class="transaction-amount">−${formatMoney(item.amount)}</strong><span></span></article>`;
  }).join('');
  $('#category-subtitle').textContent=selectedCategory?`Showing ${selectedCategory}`:'Spending by category';
  $('#clear-category').hidden=!selectedCategory;
}
function setCategory(name){selectedCategory=selectedCategory===name?'':name;$('#category-filter').value=selectedCategory;renderCategories();renderTransactions();}
paintOverview();renderCategories();renderTransactions();
$('#search-input').addEventListener('input',()=>{expanded=false;renderTransactions();});
$('#category-filter').addEventListener('change',event=>{selectedCategory=event.target.value;expanded=false;renderCategories();renderTransactions();});
$('#side-categories').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)setCategory(button.dataset.category);});
$('#category-bars').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)setCategory(button.dataset.category);});
$('#category-legend').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)setCategory(button.dataset.category);});
$('#clear-category').addEventListener('click',()=>{selectedCategory='';renderCategories();renderTransactions();});
$('#view-all').addEventListener('click',()=>{expanded=!expanded;renderTransactions();});
$('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-item').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));link.classList.add('active');$('#sidebar').classList.remove('open');}));
