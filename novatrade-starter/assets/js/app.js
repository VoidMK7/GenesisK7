const nav = document.getElementById('main-nav');
const title = document.getElementById('page-title');
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${name}`));
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  const active=document.querySelector(`.nav-link[data-page="${name}"]`);
  title.textContent=active?active.textContent.trim():'Overview';
  document.getElementById('sidebar').classList.remove('open');
}
nav.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)showPage(b.dataset.page)});
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.goto)));
document.getElementById('mobile-menu').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));

// Supabase is intentionally not initialized in this frontend-only starter.
// Add a server-side integration layer before accepting credentials or placing orders.
window.NovaTrade = {
  environment: 'frontend-starter',
  tradingMode: 'analysis-only',
  liveTradingEnabled: false,
  supabaseConfigured: false
};
