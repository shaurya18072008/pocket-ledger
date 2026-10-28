const byId = id => document.getElementById(id);
let authMode = 'login';
let toastTimer;
async function api(url, options={}) {
  const response = await fetch(url, { headers: { 'Content-Type':'application/json', ...(options.headers||{}) }, ...options });
  if (!response.ok) { const body=await response.json().catch(()=>({})); throw new Error(body.error||'Please try again.'); }
  return response.status === 204 ? null : response.json();
}
function openAuth(mode) {
  authMode=mode;
  const signup=mode==='signup';
  byId('auth-title').textContent=signup?'Create your ledger.':'Welcome back.';
  byId('auth-copy').textContent=signup?'Just your name and a password. Your new ledger starts empty.':'Pick up where your month left off.';
  byId('auth-submit').innerHTML=signup?'Create account <span>↗</span>':'Log in <span>↗</span>';
  byId('auth-switch').innerHTML=signup?'Already have a ledger? <button type="button" data-switch="login">Log in</button>':'New around here? <button type="button" data-switch="signup">Create an account</button>';
  byId('auth-name').placeholder=signup?'e.g. Alex Morgan':'Your account name';
  byId('auth-password').setAttribute('autocomplete',signup?'new-password':'current-password');
  byId('auth-password').setAttribute('minlength',signup?'8':'1');
  byId('auth-error').textContent='';
  byId('auth-backdrop').hidden=false;
  document.body.style.overflow='hidden';
  setTimeout(()=>byId('auth-name').focus(),40);
}
function closeAuth(){byId('auth-backdrop').hidden=true;document.body.style.overflow='';}
function toast(message){const node=byId('toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2400);}
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>openAuth(button.dataset.open)));
byId('auth-close').addEventListener('click',closeAuth);
byId('auth-backdrop').addEventListener('click',event=>{if(event.target===byId('auth-backdrop'))closeAuth();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeAuth();});
byId('auth-switch').addEventListener('click',event=>{const button=event.target.closest('[data-switch]');if(button)openAuth(button.dataset.switch);});
byId('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name=byId('auth-name').value.trim();
  const password=byId('auth-password').value;
  if(authMode==='signup'&&password.length<8){byId('auth-error').textContent='Use a password with at least 8 characters.';return;}
  const submit=byId('auth-submit');submit.disabled=true;byId('auth-error').textContent='';
  try{
    const result=await api(authMode==='signup'?'/api/auth/signup':'/api/auth/login',{method:'POST',body:JSON.stringify({name,password})});
    location.assign(result.previewToken?`/dashboard?preview=${encodeURIComponent(result.previewToken)}`:'/dashboard');
  }
  catch(error){byId('auth-error').textContent=error.message;submit.disabled=false;}
});
