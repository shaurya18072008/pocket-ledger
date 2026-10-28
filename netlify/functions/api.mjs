import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { CATEGORIES, normalizeName, validateName, validatePassword, isValidIsoDate, isValidMonth, validExpense } from '../../lib/shared.cjs';
import { signSession, getSession, makeCookie, clearCookie } from '../../lib/auth.cjs';

const attempts = new Map();
let sqlClient;
function db() {
  const connectionString=process.env.DATABASE_URL;
  if(!connectionString)throw new Error('DATABASE_URL is not set. Add the Neon Postgres connection string to Netlify environment variables.');
  if(!sqlClient)sqlClient=neon(connectionString);
  return {sql:sqlClient};
}

function json(data, status=200, headers={}) {
  return Response.json(data, { status, headers: { 'Cache-Control':'no-store', ...headers } });
}
function secureCookie() { return true; }
function replyWithSession(user) {
  const token = signSession({ ...user, is_demo: Boolean(user.is_demo) });
  return { 'Set-Cookie': makeCookie(token, secureCookie()), 'Cache-Control':'no-store' };
}
function takeAttempt(key) {
  const now=Date.now(); const times=(attempts.get(key)||[]).filter(time=>now-time<60_000);
  if(times.length>=12)return false;times.push(now);attempts.set(key,times);return true;
}
function cookieHeader(request) { return request.headers.get('cookie') || ''; }
function parsedUser(request) { return getSession(cookieHeader(request)); }
function escapeCsv(value) { return `"${String(value ?? '').replaceAll('"','""')}"`; }
function numericRow(row) { return { ...row, id:Number(row.id), amount:Number(row.amount) }; }
function monthFromRequest(url) { return isValidMonth(url.searchParams.get('month')) ? url.searchParams.get('month') : new Date().toISOString().slice(0,7); }
function cleanName(name) { return typeof name==='string' ? name.trim() : ''; }

async function createAccount(body) {
  const name=cleanName(body?.name),password=body?.password;
  const nameError=validateName(name);if(nameError)return { error:nameError,status:400 };
  const passwordError=validatePassword(password);if(passwordError)return { error:passwordError,status:400 };
  const normalized=normalizeName(name);
  if(!takeAttempt(`signup:${normalized}`))return {error:'Too many attempts. Please wait a minute and try again.',status:429};
  try {
    const rows=await db().sql`INSERT INTO users (id,name,normalized_name,password_hash) VALUES (${randomUUID()},${name},${normalized},${await bcrypt.hash(password,12)}) RETURNING id,name,is_demo`;
    return { user:rows[0],status:201 };
  } catch(error) {
    if(String(error.message||'').toLowerCase().includes('unique'))return {error:'That name already has an account. Try signing in instead.',status:409};
    throw error;
  }
}

async function routeApi(request) {
  const url=new URL(request.url);
  const pathname=url.pathname.replace(/^\/(?:\.netlify\/functions\/api|api)/,'') || '/';
  if(request.method==='GET'&&pathname==='/auth/status'){
    const user=parsedUser(request);
    return user?json({authenticated:true,user:{id:user.id,name:user.name,is_demo:Boolean(user.is_demo)}}):json({authenticated:false});
  }
  if(request.method==='POST'&&pathname==='/auth/signup'){
    const body=await request.json();const result=await createAccount(body);
    if(result.error)return json({error:result.error},result.status);
    return json({user:{id:result.user.id,name:result.user.name,is_demo:false}},201,replyWithSession(result.user));
  }
  if(request.method==='POST'&&pathname==='/auth/login'){
    const body=await request.json();const name=cleanName(body?.name),password=body?.password;
    if(!name||typeof password!=='string')return json({error:'Enter your name and password.'},400);
    const normalized=normalizeName(name);
    if(!takeAttempt(`login:${normalized}`))return json({error:'Too many attempts. Please wait a minute and try again.'},429);
    const rows=await db().sql`SELECT id,name,password_hash,is_demo FROM users WHERE normalized_name=${normalized} LIMIT 1`;
    const user=rows[0];
    if(!user||!(await bcrypt.compare(password,user.password_hash)))return json({error:'That name and password don’t match.'},401);
    return json({user:{id:user.id,name:user.name,is_demo:Boolean(user.is_demo)}},200,replyWithSession(user));
  }
  if(request.method==='POST'&&pathname==='/auth/logout')return new Response(null,{status:204,headers:{'Set-Cookie':clearCookie(true),'Cache-Control':'no-store'}});

  const user=parsedUser(request);
  if(!user)return json({error:'Sign in to open your ledger.'},401);
  const userId=user.id;
  const database=db();
  if(request.method==='GET'&&pathname==='/categories')return json(CATEGORIES);

  if(request.method==='GET'&&pathname==='/expenses'){
    const month=url.searchParams.get('month');
    const category=url.searchParams.get('category');
    const rawSearch=(url.searchParams.get('search')||'').trim().slice(0,80);
    const from=url.searchParams.get('from');const to=url.searchParams.get('to');
    const rawLimit=Number.parseInt(url.searchParams.get('limit')||'200',10);
    const limit=Math.max(1,Math.min(500,rawLimit||200));
    const selectedMonth=isValidMonth(month)?month:null;
    const selectedCategory=CATEGORIES.some(item=>item.name===category)?category:null;
    const selectedFrom=isValidIsoDate(from)?from:null;
    const selectedTo=isValidIsoDate(to)?to:null;
    const pattern=rawSearch?`%${rawSearch}%`:null;
    const rows=await database.sql`SELECT id,description,amount,category,to_char(spent_on,'YYYY-MM-DD') AS spent_on,note,created_at FROM expenses WHERE user_id=${userId} AND (${selectedMonth}::text IS NULL OR to_char(spent_on,'YYYY-MM')=${selectedMonth}) AND (${selectedCategory}::text IS NULL OR category=${selectedCategory}) AND (${pattern}::text IS NULL OR description ILIKE ${pattern} OR note ILIKE ${pattern}) AND (${selectedFrom}::date IS NULL OR spent_on >= ${selectedFrom}::date) AND (${selectedTo}::date IS NULL OR spent_on <= ${selectedTo}::date) ORDER BY spent_on DESC,id DESC LIMIT ${limit}`;
    return json(rows.map(numericRow));
  }
  if(request.method==='POST'&&pathname==='/expenses/import'){
    const body=await request.json();const incoming=body?.expenses;
    if(!Array.isArray(incoming)||incoming.length===0)return json({error:'The file has no expense rows to import.'},400);
    if(incoming.length>500)return json({error:'Import up to 500 expenses at a time.'},400);
    const rows=incoming.map((row,index)=>{
      const error=validExpense(row||{});
      return error?{error:`Row ${index+1}: ${error}`}:{description:row.description.trim(),amount:Number(row.amount),category:row.category,spent_on:row.spent_on,note:typeof row.note==='string'?row.note.trim().slice(0,240):''};
    });
    const invalid=rows.find(row=>row.error);if(invalid)return json({error:invalid.error},400);
    const inserted=await database.sql`INSERT INTO expenses (user_id,description,amount,category,spent_on,note) SELECT ${userId},r.description,r.amount,r.category,r.spent_on::date,r.note FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(description text,amount numeric,category text,spent_on text,note text) RETURNING id`;
    return json({imported:inserted.length},201);
  }
  if(request.method==='GET'&&pathname==='/summary'){
    const month=monthFromRequest(url);
    const [current]=await database.sql`SELECT COALESCE(SUM(amount),0)::float8 AS total,COUNT(*)::int AS count FROM expenses WHERE user_id=${userId} AND to_char(spent_on,'YYYY-MM')=${month}`;
    const previousDate=new Date(`${month}-01T12:00:00Z`);previousDate.setUTCMonth(previousDate.getUTCMonth()-1);const previousMonth=previousDate.toISOString().slice(0,7);
    const [previous]=await database.sql`SELECT COALESCE(SUM(amount),0)::float8 AS total FROM expenses WHERE user_id=${userId} AND to_char(spent_on,'YYYY-MM')=${previousMonth}`;
    const categories=await database.sql`SELECT category,COALESCE(SUM(amount),0)::float8 AS amount FROM expenses WHERE user_id=${userId} AND to_char(spent_on,'YYYY-MM')=${month} GROUP BY category ORDER BY amount DESC`;
    const daily=await database.sql`SELECT to_char(spent_on,'YYYY-MM-DD') AS day,COALESCE(SUM(amount),0)::float8 AS amount FROM expenses WHERE user_id=${userId} AND to_char(spent_on,'YYYY-MM')=${month} GROUP BY spent_on ORDER BY spent_on`;
    const total=Number(current.total||0),previousTotal=Number(previous.total||0);
    return json({month,total,count:Number(current.count||0),previousTotal,changePercent:previousTotal?((total-previousTotal)/previousTotal)*100:null,categories,daily});
  }
  if(request.method==='GET'&&/^\/expenses\/\d+$/.test(pathname)){
    const id=Number(pathname.split('/').at(-1));
    const rows=await database.sql`SELECT id,description,amount,category,to_char(spent_on,'YYYY-MM-DD') AS spent_on,note,created_at FROM expenses WHERE id=${id} AND user_id=${userId} LIMIT 1`;
    return rows[0]?json(numericRow(rows[0])):json({error:'Expense not found.'},404);
  }
  if(request.method==='POST'&&pathname==='/expenses'){
    const body=await request.json();const error=validExpense(body||{});if(error)return json({error},400);
    const description=body.description.trim(),amount=Number(body.amount),category=body.category,spentOn=body.spent_on,note=typeof body.note==='string'?body.note.trim().slice(0,240):'';
    const rows=await database.sql`INSERT INTO expenses (user_id,description,amount,category,spent_on,note) VALUES (${userId},${description},${amount},${category},${spentOn}::date,${note}) RETURNING id,description,amount,category,to_char(spent_on,'YYYY-MM-DD') AS spent_on,note,created_at`;
    return json(numericRow(rows[0]),201);
  }
  const idMatch=pathname.match(/^\/expenses\/(\d+)$/);
  if(request.method==='PATCH'&&idMatch){
    const id=Number(idMatch[1]);const existingRows=await database.sql`SELECT id,description,amount,category,to_char(spent_on,'YYYY-MM-DD') AS spent_on,note FROM expenses WHERE id=${id} AND user_id=${userId} LIMIT 1`;
    if(!existingRows[0])return json({error:'Expense not found.'},404);
    const body={...existingRows[0],...(await request.json())};const error=validExpense(body);if(error)return json({error},400);
    const description=body.description.trim(),amount=Number(body.amount),category=body.category,spentOn=body.spent_on,note=typeof body.note==='string'?body.note.trim().slice(0,240):'';
    const rows=await database.sql`UPDATE expenses SET description=${description},amount=${amount},category=${category},spent_on=${spentOn}::date,note=${note} WHERE id=${id} AND user_id=${userId} RETURNING id,description,amount,category,to_char(spent_on,'YYYY-MM-DD') AS spent_on,note,created_at`;
    return rows[0]?json(numericRow(rows[0])):json({error:'Expense not found.'},404);
  }
  if(request.method==='DELETE'&&idMatch){
    const id=Number(idMatch[1]);const rows=await database.sql`DELETE FROM expenses WHERE id=${id} AND user_id=${userId} RETURNING id`;
    return rows.length?new Response(null,{status:204}):json({error:'Expense not found.'},404);
  }
  if(request.method==='GET'&&pathname==='/export.csv'){
    const rows=await database.sql`SELECT to_char(spent_on,'YYYY-MM-DD') AS spent_on,description,category,amount,note FROM expenses WHERE user_id=${userId} ORDER BY spent_on DESC,id DESC`;
    const csv=['Date,Description,Category,Amount (INR),Note',...rows.map(row=>[row.spent_on,row.description,row.category,Number(row.amount).toFixed(2),row.note].map(escapeCsv).join(','))].join('\n');
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="pocket-ledger-expenses.csv"','Cache-Control':'no-store'}});
  }
  return json({error:'API route not found.'},404);
}

export default async function handler(request) {
  try { return await routeApi(request); }
  catch(error) {
    console.error('Pocket Ledger API error:',error?.message||error);
    if(error?.name==='JsonWebTokenError'||error?.name==='TokenExpiredError')return json({error:'Sign in again to open your ledger.'},401);
    return json({error:'Something went wrong while opening your ledger. Please try again.'},500);
  }
}
