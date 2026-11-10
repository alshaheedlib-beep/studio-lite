/* Studio Lite — الواجهة (نفس تصميم المحاسب الذكي) */
'use strict';
let S = null;              // كل البيانات من السيرفر
let POS = null;            // حالة نقطة البيع
const ROOT = () => document.getElementById('root');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => r2(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cur = () => (S && S.settings.currency) || '₪';
const money = (n) => `<span class="num">${fmt(n)}</span> ${cur()}`;
const moneyTxt = (n) => `${fmt(n)} ${cur()}`;
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fmtDate = (d) => (d ? `<span class="num">${d.split('-').reverse().join('/')}</span>` : '');
const isAdmin = () => S && S.me.role === 'admin';
const custName = (c) => c ? (c.bride ? `${c.groom} و ${c.bride}` : c.groom) : '—';
const byId = (arr, id) => arr.find((x) => x.id === id);
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

// ---------- المظهر ----------
function applyTheme() {
  const t = LS.get('sl_theme', 'auto'); const r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
}
applyTheme();

// ---------- اتصال ----------
async function api(method, url, body) {
  let res;
  try { res = await fetch('/api/' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch { setNet(false); throw new Error('لا يوجد اتصال بالإنترنت'); }
  setNet(true);
  let data = {}; try { data = await res.json(); } catch {}
  if (res.status === 401 && url !== 'login' && url !== 'state') { S = null; renderLogin(); throw new Error(data.error || 'انتهت الجلسة'); }
  if (!res.ok) { const e = new Error(data.error || 'حدث خطأ'); e.status = res.status; throw e; }
  return data;
}
async function load() { S = await api('GET', 'state'); _balCache = null; }
async function act(fn, okMsg) {
  try { const r = await fn(); await load(); if (okMsg) toast(okMsg); renderTop(); route(); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
let toastT;
function toast(msg, bad) {
  const host = $('#toastHost'); clearTimeout(toastT);
  host.innerHTML = `<div class="toast ${bad ? 'bad' : ''}" role="status">${h(msg)}</div>`;
  toastT = setTimeout(() => (host.innerHTML = ''), bad ? 4500 : 2000);
}
let online = navigator.onLine !== false;
function setNet(v) { if (online === v) return; online = v; const n = $('#net'); if (n) { n.className = 'net' + (v ? '' : ' off'); n.textContent = v ? 'متصل' : 'غير متصل'; } }
window.addEventListener('online', () => setNet(true)); window.addEventListener('offline', () => setNet(false));

// ---------- الحسابات ----------
function custTx(cid) {
  const c = byId(S.customers, cid);
  const tx = [];
  if (c && r2(c.openingBalance) !== 0) tx.push({ kind: 'open', date: (c.createdAt || '').slice(0, 10) || '2000-01-01', sort: '0', debit: Math.max(c.openingBalance, 0), credit: Math.max(-c.openingBalance, 0), desc: 'رصيد سابق (افتتاحي)' });
  for (const i of S.invoices) if (i.customerId === cid && !i.cancelled) tx.push({ kind: 'inv', ref: i, date: i.date, sort: i.createdAt, debit: i.total, credit: 0, desc: `طلبية رقم ${i.no}` });
  for (const p of S.payments) if (p.customerId === cid && !p.cancelled) tx.push({ kind: 'pay', ref: p, date: p.date, sort: p.createdAt, debit: 0, credit: p.amount, desc: `سند قبض رقم ${p.no} — ${p.method}${p.note ? ' — ' + p.note : ''}` });
  tx.sort((a, b) => a.date.localeCompare(b.date) || String(a.sort).localeCompare(String(b.sort)));
  return tx;
}
let _balCache = null;
function balances() {
  if (_balCache) return _balCache;
  const m = new Map(S.customers.map((c) => [c.id, r2(c.openingBalance)]));
  for (const i of S.invoices) if (!i.cancelled) m.set(i.customerId, r2((m.get(i.customerId) || 0) + i.total));
  for (const p of S.payments) if (!p.cancelled) m.set(p.customerId, r2((m.get(p.customerId) || 0) - p.amount));
  return (_balCache = m);
}
const bal = (cid) => balances().get(cid) || 0;
// توزيع الدفعات على الديون الأقدم أولاً (FIFO)
function allocate(cid, asOf) {
  const tx = custTx(cid).filter((t) => !asOf || t.date <= asOf);
  let credit = tx.reduce((s, t) => s + t.credit, 0);
  const debits = tx.filter((t) => t.debit > 0).map((t) => ({ ...t, remaining: t.debit }));
  for (const d of debits) { const use = Math.min(credit, d.remaining); d.remaining = r2(d.remaining - use); credit = r2(credit - use); }
  return { debits, extraCredit: credit };
}
function invoiceRemaining(inv) {
  if (inv.cancelled) return 0;
  const d = allocate(inv.customerId).debits.find((x) => x.ref && x.ref.id === inv.id);
  return d ? d.remaining : 0;
}
const lastPayment = (cid) => S.payments.filter((p) => p.customerId === cid && !p.cancelled).map((p) => p.date).sort().pop() || '';
function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  else if (/^0(59|56)/.test(p)) p = '970' + p.slice(1);
  else if (p.startsWith('0')) p = '972' + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
const reminderText = (c) => `مرحباً ${c.groom}، تحية طيبة من ${S.settings.studioName}.\nنود تذكيركم بأن الرصيد المستحق على حسابكم هو ${moneyTxt(bal(c.id))}.\nشاكرين تعاملكم معنا 🌹`;
const ST_CLASS = { 'جديدة': 'st-new', 'قيد التنفيذ': 'st-prog', 'جاهزة': 'st-ready', 'تم التسليم': 'st-done' };
const stBadge = (i) => i.cancelled ? '<span class="st st-void">ملغاة</span>' : `<span class="st ${ST_CLASS[i.status] || ''}">${h(i.status)}</span>`;

// ---------- أيقونات (نفس خط أيقونات البرنامج) ----------
const P = {
  home: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  pos: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  parties: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  orders: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>',
  aging: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  ring: '<circle cx="12" cy="14" r="6"/><path d="M9 4h6l-1.5 4h-3z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  stmt: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24">${P[n] || ''}</svg>`;

// ---------- الهيكل ----------
const NAV = [
  ['home', 'الرئيسية', 'home'], ['pos', 'البيع', 'pos'], ['customers', 'العرسان', 'parties'],
  ['invoices', 'الطلبيات', 'orders'], ['aging', 'الذمم', 'aging'], ['payments', 'الدفعات', 'cash', 'dsk'], ['settings', 'الإعدادات', 'settings'],
];
function renderShell() {
  ROOT().innerHTML = `<div class="app"><header class="top" id="top"></header><nav class="nav" id="nav" aria-label="الأقسام"></nav><main id="main"></main></div>`;
  renderTop();
  $('#nav').innerHTML = NAV.map(([v, l, ic, cls]) => `<a href="#/${v}" data-v="${v}" class="${cls || ''}">${svg(ic)}<span>${l}</span></a>`).join('');
}
function brandMark() { return S.settings.logo ? `<img src="${h(S.settings.logo)}" alt="">` : h((S.settings.studioName || 'S').trim()[0]); }
function renderTop() {
  const el = $('#top'); if (!el) return;
  el.innerHTML = `<div class="brand"><div class="brand-mark" aria-hidden="true">${brandMark()}</div>
    <div class="brand-txt"><h1>${h(S.settings.studioName)}</h1><small>${h(S.settings.subtitle || 'محاسبة الاستوديو')}</small></div></div>
    <span class="net ${online ? '' : 'off'}" id="net">${online ? 'متصل' : 'غير متصل'}</span>
    <div class="who"><div class="nm"><div>${h(S.me.name)}</div><div class="role">${isAdmin() ? 'مدير' : 'موظف'}</div></div>
    <button class="icon-btn" id="logoutBtn">خروج</button></div>`;
  $('#logoutBtn').onclick = async () => { try { await api('POST', 'logout'); } catch {} S = null; renderLogin(); };
}
const page = (inner) => `<div class="page"><div class="page-inner">${inner}</div></div>`;
const phead = (title, lead, actions = '') => `<div class="phead"><div><h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;

// ---------- الدخول ----------
async function renderLogin() {
  let name = document.title, subtitle = '';
  try { const p = await api('GET', 'public-settings'); name = p.studioName; subtitle = p.subtitle; } catch {}
  ROOT().innerHTML = `<div class="login"><form id="lf">
    <div class="brand-mark" aria-hidden="true">${h((name || 'S').trim()[0])}</div><h1>${h(name)}</h1><p>${h(subtitle || 'محاسبة الاستوديو')} — سجّل الدخول للمتابعة</p>
    <label class="fld">اسم المستخدم<input name="username" autocomplete="username" autocapitalize="off" required dir="ltr"></label>
    <label class="fld">كلمة المرور<input name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
    <button class="btn pri big">دخول</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('POST', 'login', { username: f.get('username'), password: f.get('password') }); await start(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- الموجّه ----------
function route() {
  if (!S || !$('#main')) return;
  closeModal();
  const [path, qs] = (location.hash.slice(2) || 'home').split('?');
  const [name, id] = path.split('/');
  const q = new URLSearchParams(qs || '');
  const navKey = name === 'customer' ? 'customers' : name;
  $$('#nav a').forEach((a) => (a.dataset.v === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const views = { home: vHome, pos: vPos, customers: vCustomers, customer: vCustomer, invoices: vInvoices, payments: vPayments, aging: vAging, settings: vSettings };
  const main = $('#main');
  (views[name] || vHome)(main, id, q);
  const pg = $('.page', main); if (pg && !route.keepScroll) pg.scrollTop = 0;
  document.title = S.settings.studioName;
}
window.addEventListener('hashchange', route);

// ---------- اختيار العريس ----------
function pickerHTML(selectedId, allowNew = true) {
  const c = selectedId && byId(S.customers, selectedId);
  if (c) return `<div class="chosen"><div><b>${h(custName(c))}</b><small><span class="num">${h(c.phone || '')}</span> ${c.weddingDate ? '· العرس ' + fmtDate(c.weddingDate) : ''} · الرصيد ${money(bal(c.id))}</small></div><button type="button" class="btn sm" data-pk="clear">تغيير</button></div>`;
  return `<div class="prow"><div class="picker"><input class="inp" data-pk="q" placeholder="ابحث باسم العريس أو العروس أو الجوال…" autocomplete="off"><div class="list" hidden></div></div>${allowNew ? '<button type="button" class="btn ok" data-pk="new">+ عريس جديد</button>' : ''}</div>`;
}
function bindPicker(root, onPick) {
  const clear = $('[data-pk=clear]', root); if (clear) clear.onclick = () => onPick(null);
  const nw = $('[data-pk=new]', root); if (nw) nw.onclick = () => customerModal(null, (c) => onPick(c.id));
  const q = $('[data-pk=q]', root); if (!q) return;
  const list = $('.list', root);
  let idx = 0, results = [];
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    results = S.customers.filter((c) => !t || [c.groom, c.bride, c.phone, c.phone2, String(c.no)].some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 30);
    idx = 0;
    list.innerHTML = results.length ? results.map((c, i) => `<div class="opt ${i === 0 ? 'act' : ''}" data-i="${i}"><span>${h(custName(c))}</span><small class="num">${h(c.phone || '')}</small></div>`).join('')
      : `<div class="empty small">لا يوجد${t ? ` — <button type="button" class="btn sm ok" data-addq>إضافة «${h(q.value.trim())}» كعريس جديد</button>` : ''}</div>`;
    list.hidden = false;
    const addQ = $('[data-addq]', list); if (addQ) addQ.onmousedown = (e) => { e.preventDefault(); customerModal({ groom: q.value.trim() }, (c) => onPick(c.id)); };
    $$('.opt', list).forEach((o) => (o.onmousedown = (e) => { e.preventDefault(); onPick(results[+o.dataset.i].id); }));
  };
  q.oninput = draw; q.onfocus = draw;
  q.onblur = () => setTimeout(() => (list.hidden = true), 150);
  q.onkeydown = (e) => {
    const opts = $$('.opt', list);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, Math.min(opts.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1))); opts.forEach((o, i) => o.classList.toggle('act', i === idx)); }
    if (e.key === 'Enter') { e.preventDefault(); if (results[idx]) onPick(results[idx].id); }
  };
}

// ---------- نوافذ ----------
function modal(title, body, footer) {
  closeModal();
  const ov = document.createElement('div'); ov.className = 'ovl'; ov.id = 'mdl';
  ov.innerHTML = `<div class="mdl" role="dialog"><div class="mdl-h"><h3>${title}</h3><button class="x" data-close aria-label="إغلاق">×</button></div><div class="mdl-b">${body}</div><div class="mdl-f">${footer || ''}</div></div>`;
  document.body.appendChild(ov);
  $$('[data-close]', ov).forEach((b) => (b.onclick = closeModal));
  ov.onmousedown = (e) => { if (e.target === ov) closeModal(); };
  if (matchMedia('(hover: hover)').matches) { const f = $('.mdl-b input:not([type=hidden]),.mdl-b select', ov); if (f) setTimeout(() => f.focus(), 30); }
  return { root: $('.mdl', ov), body: $('.mdl-b', ov), close: closeModal };
}
function closeModal() { const m = $('#mdl'); if (m) m.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closePrint(); } });

function customerModal(c, after) {
  const isNew = !c || !c.id; c = c || {};
  const m = modal(isNew ? 'عريس جديد' : 'تعديل بيانات العريس', `
    <form id="cf" class="grid2">
      <label class="fld">اسم العريس *<input name="groom" value="${h(c.groom)}" required></label>
      <label class="fld">اسم العروس<input name="bride" value="${h(c.bride)}"></label>
      <label class="fld">الجوال<input class="n" name="phone" value="${h(c.phone)}" inputmode="tel" placeholder="059xxxxxxx"></label>
      <label class="fld">جوال آخر<input class="n" name="phone2" value="${h(c.phone2)}" inputmode="tel"></label>
      <label class="fld">تاريخ العرس<input type="date" name="weddingDate" value="${h(c.weddingDate)}"></label>
      <label class="fld">رصيد سابق (افتتاحي)<input class="n" type="number" step="any" inputmode="decimal" name="openingBalance" value="${h(c.openingBalance || '')}" placeholder="0"></label>
      <label class="fld wide">العنوان / مكان الحفلة<input name="address" value="${h(c.address)}"></label>
      <label class="fld wide">ملاحظات<textarea name="notes">${h(c.notes)}</textarea></label>
    </form>`, `<button class="btn ok" id="cfSave">حفظ</button><button class="btn ghost" data-close>إلغاء</button>`);
  $$('[data-close]', m.root).forEach((b) => (b.onclick = closeModal));
  const saveIt = async (force) => {
    const f = Object.fromEntries(new FormData($('#cf')).entries());
    if (!f.groom.trim()) return toast('اسم العريس مطلوب', true);
    try {
      const r = isNew ? await api('POST', 'customers', { ...f, force }) : await api('PUT', 'customers/' + c.id, f);
      await load(); closeModal(); toast(isNew ? 'تمت إضافة العريس' : 'تم الحفظ');
      after ? after(r) : route();
    } catch (e) {
      if (e.status === 409) { if (confirm(e.message + '\nهل تريد إضافته رغم ذلك؟')) return saveIt(true); return; }
      toast(e.message, true);
    }
  };
  $('#cfSave').onclick = () => saveIt(false);
  $('#cf').onsubmit = (e) => { e.preventDefault(); saveIt(false); };
}

function paymentModal(customerId, invoiceId) {
  let cid = customerId || null;
  const m = modal('قبض دفعة', '', `<button class="btn ok" id="pSave">حفظ الدفعة</button><button class="btn" id="pSavePrint">حفظ وطباعة سند</button><button class="btn ghost" data-close>إلغاء</button>`);
  $$('[data-close]', m.root).forEach((b) => (b.onclick = closeModal));
  const draw = () => {
    const invs = cid ? S.invoices.filter((i) => i.customerId === cid && !i.cancelled) : [];
    const b = cid ? bal(cid) : 0;
    m.body.innerHTML = `
      <div id="pp">${pickerHTML(cid, true)}</div>
      <div class="grid2">
        <label class="fld">المبلغ *<input class="n" type="number" step="any" min="0" id="pAmt" inputmode="decimal"></label>
        <label class="fld">طريقة الدفع<select id="pMethod">${S.methods.map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="fld">التاريخ<input type="date" id="pDate" value="${todayStr()}"></label>
        <label class="fld">على طلبية (اختياري)<select id="pInv"><option value="">— دفعة على الحساب —</option>${invs.map((i) => `<option value="${i.id}" ${i.id === invoiceId ? 'selected' : ''}>رقم ${i.no} — ${moneyTxt(i.total)}</option>`).join('')}</select></label>
        <label class="fld wide">ملاحظة<input id="pNote"></label>
      </div>
      ${b > 0 ? `<div class="seg"><button type="button" data-q="${b}">كامل الرصيد: ${moneyTxt(b)}</button>${b >= 200 ? `<button type="button" data-q="${r2(b / 2)}">النصف: ${moneyTxt(b / 2)}</button>` : ''}</div>` : ''}`;
    bindPicker($('#pp', m.body), (id) => { cid = id; draw(); });
    $$('[data-q]', m.body).forEach((x) => (x.onclick = () => ($('#pAmt').value = x.dataset.q)));
  };
  draw();
  const go = async (print) => {
    if (!cid) return toast('اختر العريس', true);
    const amount = r2($('#pAmt').value);
    if (!(amount > 0)) return toast('أدخل المبلغ', true);
    $('#pSave').disabled = true;
    try {
      const p = await api('POST', 'payments', { customerId: cid, amount, method: $('#pMethod').value, date: $('#pDate').value, invoiceId: $('#pInv').value, note: $('#pNote').value });
      await load(); closeModal(); toast('تم حفظ الدفعة'); route();
      if (print) printReceipt(byId(S.payments, p.id));
    } catch (e) { toast(e.message, true); const b = $('#pSave'); if (b) b.disabled = false; }
  };
  $('#pSave').onclick = () => go(false);
  $('#pSavePrint').onclick = () => go(true);
}
function pickCustomerThen(title, fn) {
  const m = modal(title, '<div id="pk2"></div>', '<button class="btn ghost" data-close>إلغاء</button>');
  $$('[data-close]', m.root).forEach((b) => (b.onclick = closeModal));
  $('#pk2').innerHTML = pickerHTML(null, false);
  bindPicker($('#pk2'), (id) => { if (id) { closeModal(); fn(id); } });
  setTimeout(() => $('[data-pk=q]')?.focus(), 30);
}

// ---------- الرئيسية ----------
function vHome(main) {
  const t = todayStr(), month = t.slice(0, 7);
  const salesToday = S.invoices.filter((i) => !i.cancelled && i.date === t).reduce((s, i) => s + i.total, 0);
  const cashToday = S.payments.filter((p) => !p.cancelled && p.date === t).reduce((s, p) => s + p.amount, 0);
  const salesMonth = S.invoices.filter((i) => !i.cancelled && i.date.startsWith(month)).reduce((s, i) => s + i.total, 0);
  const totalAR = [...balances().values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const upcoming = S.customers.filter((c) => c.weddingDate && c.weddingDate >= t && c.weddingDate <= addDays(t, 21)).sort((a, b) => a.weddingDate.localeCompare(b.weddingDate));
  const ready = S.invoices.filter((i) => !i.cancelled && i.status === 'جاهزة');
  const tile = (href, ic, label, attrs = '') => `<a class="tile" href="${href}" ${attrs}>${svg(ic)}<span>${label}</span></a>`;
  main.innerHTML = page(`
    <div class="stats">
      <a class="stat" href="#/aging"><small>المستحق على العرسان</small><b>${money(totalAR)}</b></a>
      <a class="stat" href="#/invoices"><small>مبيعات اليوم</small><b>${money(salesToday)}</b></a>
      <a class="stat" href="#/payments"><small>مقبوضات اليوم</small><b>${money(cashToday)}</b></a>
      <a class="stat" href="#/invoices"><small>مبيعات هذا الشهر</small><b>${money(salesMonth)}</b></a>
    </div>
    <div class="hboard">
      <section class="hcard tone-green"><h3><i class="tdot"></i>البيع والقبض</h3><div class="tiles">
        ${tile('#/pos', 'pos', 'نقطة البيع')}${tile('javascript:void 0', 'cash', 'قبض دفعة', 'data-act="pay"')}
        ${tile('#/invoices', 'orders', 'الطلبيات')}${tile('#/payments', 'check', 'الدفعات')}</div></section>
      <section class="hcard tone-violet"><h3><i class="tdot"></i>العرسان</h3><div class="tiles">
        ${tile('#/customers', 'parties', 'كل العرسان')}${tile('javascript:void 0', 'userplus', 'عريس جديد', 'data-act="newc"')}
        ${tile('#/customers?f=up', 'calendar', 'أعراس قادمة')}${tile('#/customers?f=debt', 'ring', 'عليهم رصيد')}</div></section>
      <section class="hcard tone-rep"><h3><i class="tdot"></i>التقارير</h3><div class="tiles">
        ${tile('#/aging', 'aging', 'أعمار الذمم')}${tile('javascript:void 0', 'stmt', 'كشف حساب', 'data-act="stmt"')}
        ${tile('#/invoices?st=' + encodeURIComponent('جاهزة'), 'check', `جاهزة للتسليم${ready.length ? ` (${ready.length})` : ''}`)}${isAdmin() ? tile('#/settings?t=services', 'tag', 'الخدمات والأسعار') : tile('#/settings', 'settings', 'الإعدادات')}</div></section>
      <section class="hcard tone-amber"><h3><i class="tdot"></i>أعراس قريبة (3 أسابيع)</h3>
        <div class="card" style="padding:4px 12px">${upcoming.length ? upcoming.slice(0, 7).map((c) => { const d = daysBetween(t, c.weddingDate), b = bal(c.id); return `<a class="rc" href="#/customer/${c.id}"><div><b>${h(custName(c))}</b><small>${fmtDate(c.weddingDate)}</small></div><div class="r"><span class="days ${d <= 2 ? 'd3' : d <= 7 ? 'd2' : 'd1'}">${d === 0 ? 'اليوم' : d === 1 ? 'بكرا' : 'بعد ' + d + ' يوم'}</span><small class="${b > 0 ? 'pos' : ''}">${money(b)}</small></div></a>`; }).join('') : '<div class="empty small">لا يوجد أعراس قريبة</div>'}</div></section>
    </div>`);
  $('[data-act=pay]', main).onclick = (e) => { e.preventDefault(); paymentModal(); };
  $('[data-act=newc]', main).onclick = (e) => { e.preventDefault(); customerModal(null, (c) => (location.hash = '#/customer/' + c.id)); };
  $('[data-act=stmt]', main).onclick = (e) => { e.preventDefault(); pickCustomerThen('كشف حساب — اختر العريس', (id) => (location.hash = '#/customer/' + id)); };
}

// ---------- نقطة البيع ----------
const newPos = (customerId) => ({ editId: null, customerId: customerId || null, items: [], discount: 0, paidNow: '', method: 'نقدي', date: todayStr(), eventDate: '', dueDate: '', notes: '' });
function vPos(main, _id, q) {
  if (q.get('edit')) {
    const inv = byId(S.invoices, q.get('edit'));
    if (inv && (!POS || POS.editId !== inv.id)) POS = { editId: inv.id, customerId: inv.customerId, items: inv.items.map((x) => ({ ...x })), discount: inv.discount, paidNow: '', method: 'نقدي', date: inv.date, eventDate: inv.eventDate, dueDate: inv.dueDate || '', notes: inv.notes };
  } else if (q.get('c')) { if (!POS || POS.editId || POS.customerId !== q.get('c')) POS = newPos(q.get('c')); }
  else if (!POS || POS.editId) POS = newPos();
  const services = S.services.filter((s) => s.active !== false);
  const editInv = POS.editId && byId(S.invoices, POS.editId);
  main.innerHTML = page(`
    ${phead(editInv ? `تعديل طلبية رقم ${editInv.no}` : 'نقطة البيع', editInv ? '' : 'اختر العريس ثم اضغط على الخدمات لإضافتها للطلبية',
      editInv ? '<a class="btn" href="#/invoices" id="posCancelEdit">إلغاء التعديل</a>' : '<button class="btn ghost" id="posClear">تفريغ</button>')}
    <div class="pos-grid">
      <div style="display:grid;gap:14px;min-width:0">
        <div class="card"><h3>العريس</h3><div id="posPicker"></div></div>
        <div class="card tone-green"><div class="phead" style="margin-bottom:10px"><div><h3 style="margin:0">الخدمات</h3></div><div class="actions"><input class="inp" id="svcSearch" placeholder="بحث خدمة…" style="width:170px"><button class="btn sm" id="customItem">+ صنف حر</button></div></div>
          <div class="svc-grid">${services.map((s) => `<button class="svc" data-s="${s.id}"><b>${h(s.name)}</b><small>لكل ${h(s.unit)}</small><span class="p">${money(s.price)}</span></button>`).join('') || '<div class="empty">لا يوجد خدمات — أضفها من الإعدادات</div>'}</div>
        </div>
      </div>
      <div class="cart">
        <div class="card"><h3>الطلبية <small id="cnt"></small></h3>
          <div class="line line-h"><span>الصنف</span><span>الكمية</span><span>السعر</span><span style="text-align:left">المجموع</span><span></span></div>
          <div class="lines" id="cartItems"></div>
        </div>
        <div class="inv-tot" id="totals"></div>
        <div class="card"><div class="grid2">
          <label class="fld">تاريخ الطلبية<input type="date" id="pDate" value="${POS.date}"></label>
          <label class="fld">تاريخ المناسبة<input type="date" id="pEvent" value="${POS.eventDate}"></label>
          <label class="fld">موعد التسليم<input type="date" id="pDue" value="${POS.dueDate}"></label>
          ${editInv ? '' : `<label class="fld">طريقة الدفع<select id="pMethod">${S.methods.map((x) => `<option ${x === POS.method ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`}
          <label class="fld wide">ملاحظات<input id="pNotes" value="${h(POS.notes)}"></label>
        </div></div>
        <div class="dact"><button class="btn ok big" id="posSave">${editInv ? 'حفظ التعديل' : 'حفظ الطلبية'}</button>${editInv ? '' : '<button class="btn big" id="posSavePrint">حفظ وطباعة</button>'}</div>
      </div>
    </div>`);
  const drawPicker = () => {
    $('#posPicker').innerHTML = pickerHTML(POS.customerId, !editInv);
    if (editInv) $('[data-pk=clear]', $('#posPicker'))?.remove();
    bindPicker($('#posPicker'), (id) => {
      POS.customerId = id;
      const c = id && byId(S.customers, id);
      if (c && c.weddingDate && !POS.eventDate) { POS.eventDate = c.weddingDate; $('#pEvent').value = c.weddingDate; }
      drawPicker(); drawTotals();
    });
  };
  const drawCart = () => {
    $('#cnt').textContent = POS.items.length ? `(${POS.items.length} صنف)` : '';
    $('#cartItems').innerHTML = POS.items.length ? POS.items.map((it, i) => `<div class="line" data-i="${i}">
      <input class="inp nm" data-f="name" value="${h(it.name)}" placeholder="اسم الصنف">
      <label class="lq"><span class="ml">الكمية</span><input class="inp n" data-f="qty" type="number" step="any" min="0" inputmode="decimal" value="${it.qty}" aria-label="الكمية"></label>
      <label class="lq"><span class="ml">السعر</span><input class="inp n" data-f="price" type="number" step="any" min="0" inputmode="decimal" value="${it.price}" aria-label="السعر"></label>
      <span class="t"><span class="ml">المجموع</span>${fmt(it.qty * it.price)}</span><button class="x" data-del="${i}" aria-label="حذف">×</button></div>`).join('') : '<div class="empty small">اضغط على خدمة لإضافتها</div>';
    $$('#cartItems .line').forEach((row) => {
      const it = POS.items[+row.dataset.i];
      $$('[data-f]', row).forEach((inp) => (inp.oninput = () => {
        it[inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : Number(inp.value) || 0;
        $('.t', row).innerHTML = `<span class="ml">المجموع</span>${fmt(it.qty * it.price)}`; drawTotals();
      }));
    });
    $$('[data-del]').forEach((b) => (b.onclick = () => { POS.items.splice(+b.dataset.del, 1); drawCart(); }));
    drawTotals();
  };
  const drawTotals = () => {
    const sub = r2(POS.items.reduce((s, i) => s + i.qty * i.price, 0));
    const total = r2(sub - (Number(POS.discount) || 0));
    const b = POS.customerId ? bal(POS.customerId) : 0;
    const prev = editInv ? r2(b - editInv.total) : b;
    const paid = editInv ? 0 : Number(POS.paidNow) || 0;
    const keepFocus = document.activeElement && document.activeElement.id;
    const caret = document.activeElement && document.activeElement.selectionStart;
    $('#totals').innerHTML = `
      <div><span>المجموع</span><b>${money(sub)}</b></div>
      <div><span>خصم</span><input class="inp" type="number" step="any" min="0" inputmode="decimal" id="pDisc" value="${POS.discount || ''}" placeholder="0"></div>
      <div class="g"><span>الإجمالي</span><span>${money(total)}</span></div>
      ${editInv ? '' : `<div><span>المدفوع الآن <button type="button" class="link" id="payAll">الكل</button></span><input class="inp" type="number" step="any" min="0" inputmode="decimal" id="pPaid" value="${POS.paidNow}" placeholder="0"></div>
      <div><span>المتبقي من الطلبية</span><b class="${total - paid > 0 ? 'pos' : ''}">${money(total - paid)}</b></div>`}
      ${POS.customerId ? `<div class="small"><span class="muted">رصيد العريس السابق</span><span>${money(prev)}</span></div><div><span>الرصيد بعد الطلبية</span><b>${money(prev + total - paid)}</b></div>` : ''}`;
    if (keepFocus === 'pDisc' || keepFocus === 'pPaid') { const el = $('#' + keepFocus); el.focus(); try { el.setSelectionRange(caret, caret); } catch {} }
    $('#pDisc').oninput = (e) => { POS.discount = Number(e.target.value) || 0; drawTotals(); };
    if ($('#pPaid')) { $('#pPaid').oninput = (e) => { POS.paidNow = e.target.value; drawTotals(); }; $('#payAll').onclick = () => { POS.paidNow = String(total); drawTotals(); }; }
  };
  $$('[data-s]', main).forEach((b) => (b.onclick = () => {
    const s = byId(S.services, b.dataset.s);
    let qty = 1;
    if (s.unit !== 'خدمة' && s.unit !== 'قطعة') {
      const n = prompt(`كم ${s.unit}؟ — ${s.name}`, '1'); if (n === null) return;
      qty = Number(String(n).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))); if (!(qty > 0)) return toast('عدد غير صحيح', true);
    }
    const ex = POS.items.find((x) => x.serviceId === s.id && x.price === s.price);
    if (ex) ex.qty = r2(ex.qty + qty); else POS.items.push({ serviceId: s.id, name: s.name, unit: s.unit, qty, price: s.price });
    drawCart(); toast(`أضيف: ${s.name}${qty !== 1 ? ' × ' + qty : ''}`);
  }));
  $('#svcSearch').oninput = (e) => { const t = e.target.value.trim(); $$('.svc', main).forEach((b) => (b.style.display = !t || b.textContent.includes(t) ? '' : 'none')); };
  $('#customItem').onclick = () => { POS.items.push({ serviceId: '', name: '', unit: '', qty: 1, price: 0 }); drawCart(); $$('#cartItems [data-f=name]').pop()?.focus(); };
  ['pDate:date', 'pEvent:eventDate', 'pDue:dueDate', 'pNotes:notes', 'pMethod:method'].forEach((x) => { const [id, k] = x.split(':'); const el = $('#' + id); if (el) el.oninput = el.onchange = () => (POS[k] = el.value); });
  if ($('#posClear')) $('#posClear').onclick = () => { if (!POS.items.length || confirm('تفريغ الطلبية؟')) { POS = newPos(); route(); } };
  if ($('#posCancelEdit')) $('#posCancelEdit').onclick = () => { POS = newPos(); };
  const save = async (print) => {
    if (!POS.customerId) { toast('اختر العريس أولاً', true); $('#posPicker [data-pk=q]')?.focus(); return; }
    const items = POS.items.filter((i) => String(i.name).trim() && i.qty > 0);
    if (!items.length) return toast('أضف خدمة واحدة على الأقل', true);
    const body = { customerId: POS.customerId, items, discount: POS.discount, date: POS.date, eventDate: POS.eventDate, dueDate: POS.dueDate, notes: POS.notes, paidNow: POS.paidNow, method: POS.method };
    $('#posSave').disabled = true;
    try {
      let invId;
      if (POS.editId) { await api('PUT', 'invoices/' + POS.editId, body); invId = POS.editId; }
      else { const r = await api('POST', 'invoices', body); invId = r.invoice.id; }
      await load();
      const wasEdit = !!POS.editId; POS = newPos();
      toast(wasEdit ? 'تم حفظ التعديل' : 'تم حفظ الطلبية');
      if (wasEdit) location.hash = '#/invoices'; else route();
      if (print) printInvoice(byId(S.invoices, invId));
    } catch (e) { toast(e.message, true); $('#posSave').disabled = false; }
  };
  $('#posSave').onclick = () => save(false);
  if ($('#posSavePrint')) $('#posSavePrint').onclick = () => save(true);
  drawPicker(); drawCart();
}

// ---------- العرسان ----------
function vCustomers(main, _id, q) {
  const f0 = q.get('f') || 'all';
  main.innerHTML = page(`
    ${phead('العرسان', `${S.customers.length} عريس مسجّل`, '<button class="btn ok" id="addC">+ عريس جديد</button>')}
    <div class="toolbar"><label class="fld grow">بحث<input id="cq" placeholder="اسم، جوال، رقم…" type="search"></label>
      <div class="otabs full" role="tablist">${[['all', 'الكل'], ['debt', 'عليهم رصيد'], ['up', 'أعراس قادمة']].map(([k, l]) => `<button role="tab" data-f="${k}" aria-selected="${k === f0}">${l}</button>`).join('')}</div></div>
    <div class="card tbl-wrap"><table class="mcards"><thead><tr><th>#</th><th>العريس</th><th>العروس</th><th>الجوال</th><th>تاريخ العرس</th><th class="n">الرصيد</th><th></th></tr></thead><tbody id="cBody"></tbody></table></div>`);
  let f = f0;
  const draw = () => {
    const t = $('#cq').value.trim().toLowerCase(), today = todayStr();
    let rows = S.customers.filter((c) => !t || [c.groom, c.bride, c.phone, c.phone2, String(c.no)].some((v) => String(v || '').toLowerCase().includes(t)));
    if (f === 'debt') rows = rows.filter((c) => bal(c.id) > 0.004).sort((a, b) => bal(b.id) - bal(a.id));
    else if (f === 'up') rows = rows.filter((c) => c.weddingDate >= today).sort((a, b) => a.weddingDate.localeCompare(b.weddingDate));
    else rows.sort((a, b) => (b.no || 0) - (a.no || 0));
    $('#cBody').innerHTML = rows.map((c) => { const b = bal(c.id); return `<tr class="click" data-c="${c.id}"><td data-label="رقم">${c.no || ''}</td><td class="hd" data-label="">${h(c.groom)}</td><td data-label="العروس">${h(c.bride)}</td><td data-label="الجوال"><span class="num">${h(c.phone)}</span></td><td data-label="تاريخ العرس">${fmtDate(c.weddingDate)}</td><td class="n ${b > 0 ? 'pos' : b < 0 ? 'neg' : ''}" data-label="الرصيد"><b>${money(b)}</b></td><td data-label=""><a class="btn sm" href="#/pos?c=${c.id}" onclick="event.stopPropagation()">+ طلبية</a></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty"><b>لا يوجد عرسان</b>اضغط «عريس جديد» لإضافة أول عريس</td></tr>';
    $$('[data-c]', main).forEach((r) => (r.onclick = () => (location.hash = '#/customer/' + r.dataset.c)));
  };
  $('#cq').oninput = draw;
  $$('[data-f]', main).forEach((b) => (b.onclick = () => { f = b.dataset.f; $$('[data-f]', main).forEach((x) => x.setAttribute('aria-selected', x === b)); draw(); }));
  draw();
  $('#addC').onclick = () => customerModal(null, (c) => (location.hash = '#/customer/' + c.id));
}

function statementRows(cid, from, to) {
  const tx = custTx(cid);
  const opening = r2(tx.filter((t) => from && t.date < from).reduce((s, t) => s + t.debit - t.credit, 0));
  const inRange = tx.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
  let run = opening;
  const rows = inRange.map((t) => { run = r2(run + t.debit - t.credit); return { ...t, balance: run }; });
  return { opening, rows, closing: run, debit: r2(inRange.reduce((s, t) => s + t.debit, 0)), credit: r2(inRange.reduce((s, t) => s + t.credit, 0)) };
}
function statementTable(st, detailed, forPrint) {
  const act = (t) => forPrint ? '' : `<td data-label="">${t.kind === 'inv' ? `<button class="btn sm" data-pi="${t.ref.id}">طباعة</button>` : t.kind === 'pay' ? `<button class="btn sm" data-pr="${t.ref.id}">سند</button>` : ''}</td>`;
  return `<table class="stm ${forPrint ? '' : 'mcards'}"><thead><tr><th>التاريخ</th><th>البيان</th><th class="n">عليه</th><th class="n">دفع</th><th class="n">الرصيد</th>${forPrint ? '' : '<th></th>'}</tr></thead><tbody>
    ${st.opening ? `<tr class="rrow"><td data-label=""></td><td class="hd" data-label="">رصيد سابق</td><td data-label=""></td><td data-label=""></td><td class="n" data-label="الرصيد">${money(st.opening)}</td>${forPrint ? '' : '<td></td>'}</tr>` : ''}
    ${st.rows.map((t) => `<tr class="${t.kind === 'inv' && detailed ? 'drow' : 'rrow'}"><td data-label="التاريخ">${fmtDate(t.date)}</td><td class="hd" data-label="">${h(t.desc)}${t.kind === 'inv' && t.ref.discount ? ` <span class="muted small">(خصم ${fmt(t.ref.discount)})</span>` : ''}${t.kind === 'inv' && t.ref.notes ? `<div class="muted small">${h(t.ref.notes)}</div>` : ''}</td><td class="n" data-label="عليه">${t.debit ? money(t.debit) : ''}</td><td class="n neg" data-label="دفع">${t.credit ? money(t.credit) : ''}</td><td class="n ${t.balance > 0 ? 'pos' : ''}" data-label="الرصيد"><b>${money(t.balance)}</b></td>${act(t)}</tr>
      ${detailed && t.kind === 'inv' ? t.ref.items.map((it) => `<tr class="iline"><td></td><td class="it">${h(it.name)} — <span class="num">${fmt(it.qty)} × ${fmt(it.price)}</span></td><td class="n">${money(it.total)}</td><td></td><td></td>${forPrint ? '' : '<td></td>'}</tr>`).join('') : ''}`).join('')}
    ${!st.rows.length && !st.opening ? `<tr><td colspan="6" class="empty">لا يوجد حركات</td></tr>` : ''}
  </tbody><tfoot><tr><td data-label=""></td><td data-label="">المجموع</td><td class="n" data-label="عليه">${money(st.debit)}</td><td class="n" data-label="دفع">${money(st.credit)}</td><td class="n" data-label="الرصيد">${money(st.closing)}</td>${forPrint ? '' : '<td></td>'}</tr></tfoot></table>`;
}

function vCustomer(main, id, q) {
  const c = byId(S.customers, id);
  if (!c) { main.innerHTML = page('<div class="empty"><b>العريس غير موجود</b></div>'); return; }
  const b = bal(c.id);
  const from = q.get('from') || '', to = q.get('to') || '', detailed = q.get('d') !== '0';
  const st = statementRows(c.id, from, to);
  const invs = S.invoices.filter((i) => i.customerId === c.id).sort((a, b) => b.no - a.no);
  const wa = waLink(c.phone, reminderText(c));
  main.innerHTML = page(`
    <div class="dhero tone-violet"><div class="dhero-t"><div class="dicon">${svg('ring')}</div><div><h1>${h(custName(c))}</h1><div class="sub">عريس رقم ${c.no || ''} · <span class="num">${h(c.phone || '')}</span>${c.weddingDate ? ' · العرس ' + fmtDate(c.weddingDate) : ''}</div></div></div>
      <div class="bal"><small>الرصيد المستحق</small><b class="${b > 0 ? 'pos' : 'neg'}">${money(b)}</b></div></div>
    <div class="actions"><a class="btn ok" href="#/pos?c=${c.id}">+ طلبية</a><button class="btn pri" id="cPay">قبض دفعة</button><button class="btn" id="cEdit">تعديل</button>${wa && b > 0 ? `<a class="btn wa" target="_blank" rel="noopener" href="${wa}">مطالبة واتساب</a>` : ''}${isAdmin() ? '<button class="btn danger" id="cDel">حذف</button>' : ''}</div>
    <div class="card"><div class="kv"><span>العروس</span><b>${h(c.bride || '—')}</b><span>جوال آخر</span><b><span class="num">${h(c.phone2 || "—")}</span></b><span>العنوان</span><b>${h(c.address || '—')}</b><span>آخر دفعة</span><b>${fmtDate(lastPayment(c.id)) || '—'}</b>${c.notes ? `<span>ملاحظات</span><b>${h(c.notes)}</b>` : ''}</div></div>
    <div class="card"><h3>كشف الحساب ${detailed ? 'التفصيلي' : ''}</h3>
      <div class="toolbar" style="margin-bottom:10px">
        <label class="fld">من تاريخ<input type="date" id="sFrom" value="${from}"></label>
        <label class="fld">إلى تاريخ<input type="date" id="sTo" value="${to}"></label>
        <label class="chk"><input type="checkbox" id="sDet" ${detailed ? 'checked' : ''}> تفصيلي (الأصناف)</label>
        <button class="btn pri full" id="sPrint">طباعة الكشف</button>
      </div>
      <div class="tbl-wrap">${statementTable(st, detailed)}</div></div>
    <div class="card"><h3>الطلبيات <small>${invs.length}</small></h3><div class="tbl-wrap"><table class="mcards"><thead><tr><th>رقم</th><th>التاريخ</th><th>الأصناف</th><th class="n">الإجمالي</th><th class="n">المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${invs.map((i) => `<tr class="${i.cancelled ? 'void' : ''}"><td class="hd" data-label="">طلبية ${i.no}</td><td data-label="التاريخ">${fmtDate(i.date)}</td><td data-label="الأصناف" class="small">${h(i.items.map((x) => x.name).join('، '))}</td><td class="n" data-label="الإجمالي">${money(i.total)}</td><td class="n" data-label="المتبقي">${money(invoiceRemaining(i))}</td><td data-label="الحالة">${stBadge(i)}</td><td data-label=""><button class="btn sm" data-pi="${i.id}">طباعة</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا يوجد طلبيات</td></tr>'}
    </tbody></table></div></div>`);
  const nav = () => { const p = new URLSearchParams(); if ($('#sFrom').value) p.set('from', $('#sFrom').value); if ($('#sTo').value) p.set('to', $('#sTo').value); if (!$('#sDet').checked) p.set('d', '0'); route.keepScroll = true; location.hash = `#/customer/${c.id}?${p}`; setTimeout(() => (route.keepScroll = false), 50); };
  $('#sFrom').onchange = nav; $('#sTo').onchange = nav; $('#sDet').onchange = nav;
  $('#sPrint').onclick = () => printStatement(c, from, to, detailed);
  $('#cPay').onclick = () => paymentModal(c.id);
  $('#cEdit').onclick = () => customerModal(c);
  if ($('#cDel')) $('#cDel').onclick = () => { if (confirm('حذف العريس نهائياً؟')) act(() => api('DELETE', 'customers/' + c.id), 'تم الحذف').then(() => (location.hash = '#/customers')).catch(() => {}); };
  $$('[data-pi]', main).forEach((x) => (x.onclick = () => printInvoice(byId(S.invoices, x.dataset.pi))));
  $$('[data-pr]', main).forEach((x) => (x.onclick = () => printReceipt(byId(S.payments, x.dataset.pr))));
}

// ---------- الطلبيات ----------
function vInvoices(main, _id, q) {
  let st = q.get('st') || '';
  const live = S.invoices.filter((i) => !i.cancelled);
  const cnt = (s) => (s === '' ? live.length : s === 'c' ? S.invoices.length - live.length : live.filter((i) => i.status === s).length);
  main.innerHTML = page(`
    ${phead('الطلبيات', '', '<a class="btn ok" href="#/pos">+ طلبية جديدة</a>')}
    <div class="otabs" role="tablist">${[['', 'الكل'], ...S.statuses.map((s) => [s, s]), ['c', 'ملغاة']].map(([k, l]) => `<button role="tab" data-st="${h(k)}" aria-selected="${k === st}">${l}<span class="cnt">${cnt(k)}</span></button>`).join('')}</div>
    <div class="toolbar">
      <label class="fld">من<input type="date" id="fFrom" value="${q.get('from') || ''}"></label>
      <label class="fld">إلى<input type="date" id="fTo" value="${q.get('to') || ''}"></label>
      <label class="fld grow">بحث<input id="fQ" type="search" placeholder="رقم الطلبية أو اسم العريس…"></label>
    </div>
    <div class="card tbl-wrap"><table class="mcards"><thead><tr><th>رقم</th><th>التاريخ</th><th>العريس</th><th>المناسبة</th><th class="n">الإجمالي</th><th class="n">المتبقي</th><th>الحالة</th><th>بواسطة</th><th></th></tr></thead><tbody id="iBody"></tbody><tfoot id="iFoot"></tfoot></table></div>`);
  const draw = () => {
    const from = $('#fFrom').value, to = $('#fTo').value, qq = $('#fQ').value.trim();
    const rows = S.invoices.filter((i) => (!from || i.date >= from) && (!to || i.date <= to)
      && (st === 'c' ? i.cancelled : st ? !i.cancelled && i.status === st : !i.cancelled)
      && (!qq || String(i.no) === qq || custName(byId(S.customers, i.customerId)).includes(qq))).sort((a, b) => b.no - a.no);
    let tot = 0, rem = 0;
    $('#iBody').innerHTML = rows.map((i) => {
      const c = byId(S.customers, i.customerId), r = invoiceRemaining(i);
      if (!i.cancelled) { tot += i.total; rem += r; }
      const late = !i.cancelled && i.dueDate && i.dueDate < todayStr() && i.status !== 'تم التسليم';
      return `<tr class="${i.cancelled ? 'void' : ''}"><td class="hd" data-label="">طلبية ${i.no}</td><td data-label="التاريخ">${fmtDate(i.date)}</td><td data-label="العريس"><a href="#/customer/${i.customerId}">${h(custName(c))}</a></td><td data-label="المناسبة">${fmtDate(i.eventDate)}${late ? ' <span class="days d2">تسليم متأخر</span>' : ''}</td><td class="n" data-label="الإجمالي">${money(i.total)}</td><td class="n ${r > 0 ? 'pos' : ''}" data-label="المتبقي">${money(r)}</td>
        <td data-label="الحالة">${i.cancelled ? stBadge(i) : `<select class="st ${ST_CLASS[i.status]}" data-sst="${i.id}">${S.statuses.map((s) => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td>
        <td class="small muted" data-label="بواسطة">${h(i.createdByName || '')}</td>
        <td data-label=""><div class="actions"><button class="btn sm" data-pi="${i.id}">طباعة</button>${!i.cancelled && (isAdmin() || i.createdBy === S.me.id) ? `<a class="btn sm" href="#/pos?edit=${i.id}">تعديل</a>` : ''}${!i.cancelled && r > 0 ? `<button class="btn sm" data-pay="${i.id}">دفعة</button>` : ''}${!i.cancelled && isAdmin() ? `<button class="btn sm danger" data-cx="${i.id}">إلغاء</button>` : ''}</div></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">لا يوجد طلبيات</td></tr>';
    $('#iFoot').innerHTML = rows.length ? `<tr><td colspan="4" data-label="">${rows.length} طلبية</td><td class="n" data-label="الإجمالي">${money(tot)}</td><td class="n" data-label="المتبقي">${money(rem)}</td><td colspan="3"></td></tr>` : '';
    $$('[data-sst]', main).forEach((s) => (s.onchange = () => act(() => api('POST', `invoices/${s.dataset.sst}/status`, { status: s.value }), 'تم تحديث الحالة').catch(() => {})));
    $$('[data-pi]', main).forEach((b) => (b.onclick = () => printInvoice(byId(S.invoices, b.dataset.pi))));
    $$('[data-pay]', main).forEach((b) => (b.onclick = () => { const i = byId(S.invoices, b.dataset.pay); paymentModal(i.customerId, i.id); }));
    $$('[data-cx]', main).forEach((b) => (b.onclick = () => { const reason = prompt('سبب إلغاء الطلبية؟'); if (reason !== null) act(() => api('POST', `invoices/${b.dataset.cx}/cancel`, { reason }), 'تم إلغاء الطلبية').catch(() => {}); }));
  };
  $$('[data-st]', main).forEach((b) => (b.onclick = () => { st = b.dataset.st; $$('[data-st]', main).forEach((x) => x.setAttribute('aria-selected', x === b)); draw(); }));
  ['fFrom', 'fTo'].forEach((x) => ($('#' + x).onchange = draw)); $('#fQ').oninput = draw; draw();
}

// ---------- الدفعات ----------
function vPayments(main) {
  const t = todayStr();
  main.innerHTML = page(`
    ${phead('الدفعات', 'سندات القبض من العرسان', '<button class="btn ok" id="addP">+ قبض دفعة</button>')}
    <div class="toolbar">
      <label class="fld">من<input type="date" id="fFrom" value="${t.slice(0, 8)}01"></label>
      <label class="fld">إلى<input type="date" id="fTo"></label>
      <label class="fld">الطريقة<select id="fM"><option value="">الكل</option>${S.methods.map((m) => `<option>${m}</option>`).join('')}</select></label>
      <label class="fld">المستخدم<select id="fU"><option value="">الكل</option>${S.users.map((u) => `<option value="${u.id}">${h(u.name)}</option>`).join('')}</select></label>
      <label class="fld grow">بحث<input id="fQ" type="search" placeholder="اسم العريس أو رقم السند…"></label>
    </div>
    <div class="stats" id="pSum"></div>
    <div class="card tbl-wrap"><table class="mcards"><thead><tr><th>رقم</th><th>التاريخ</th><th>العريس</th><th class="n">المبلغ</th><th>الطريقة</th><th>ملاحظة</th><th>بواسطة</th><th></th></tr></thead><tbody id="pBody"></tbody></table></div>`);
  const draw = () => {
    const from = $('#fFrom').value, to = $('#fTo').value, m = $('#fM').value, u = $('#fU').value, qq = $('#fQ').value.trim();
    const rows = S.payments.filter((p) => (!from || p.date >= from) && (!to || p.date <= to) && (!m || p.method === m) && (!u || p.createdBy === u)
      && (!qq || String(p.no) === qq || custName(byId(S.customers, p.customerId)).includes(qq))).sort((a, b) => b.no - a.no);
    const live = rows.filter((p) => !p.cancelled);
    const byM = {}; live.forEach((p) => (byM[p.method] = (byM[p.method] || 0) + p.amount));
    $('#pSum').innerHTML = `<div class="stat"><small>المجموع (${live.length} سند)</small><b>${money(live.reduce((s, p) => s + p.amount, 0))}</b></div>` + Object.entries(byM).map(([k, v]) => `<div class="stat"><small>${k}</small><b>${money(v)}</b></div>`).join('');
    $('#pBody').innerHTML = rows.map((p) => `<tr class="${p.cancelled ? 'void' : ''}"><td class="hd" data-label="">سند ${p.no}</td><td data-label="التاريخ">${fmtDate(p.date)}</td><td data-label="العريس"><a href="#/customer/${p.customerId}">${h(custName(byId(S.customers, p.customerId)))}</a></td><td class="n" data-label="المبلغ"><b>${money(p.amount)}</b></td><td data-label="الطريقة">${p.method}</td><td class="small" data-label="ملاحظة">${h(p.note)}${p.cancelled ? ` <span class="st st-void">ملغى: ${h(p.cancelReason || '')}</span>` : ''}</td><td class="small muted" data-label="بواسطة">${h(p.createdByName || '')}</td>
      <td data-label=""><div class="actions"><button class="btn sm" data-pr="${p.id}">سند</button>${!p.cancelled && isAdmin() ? `<button class="btn sm danger" data-cx="${p.id}">إلغاء</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">لا يوجد دفعات بهذه الفترة</td></tr>';
    $$('[data-pr]', main).forEach((b) => (b.onclick = () => printReceipt(byId(S.payments, b.dataset.pr))));
    $$('[data-cx]', main).forEach((b) => (b.onclick = () => { const reason = prompt('سبب إلغاء السند؟'); if (reason !== null) act(() => api('POST', `payments/${b.dataset.cx}/cancel`, { reason }), 'تم إلغاء السند').catch(() => {}); }));
  };
  ['fFrom', 'fTo', 'fM', 'fU'].forEach((x) => ($('#' + x).onchange = draw)); $('#fQ').oninput = draw; draw();
  $('#addP').onclick = () => paymentModal();
}

// ---------- أعمار الذمم ----------
const BUCKETS = [[0, 30, '0 - 30 يوم'], [31, 60, '31 - 60 يوم'], [61, 90, '61 - 90 يوم'], [91, 1e9, 'أكثر من 90']];
function agingData(asOf, basis) {
  const rows = [];
  for (const c of S.customers) {
    const { debits, extraCredit } = allocate(c.id, asOf);
    const balance = r2(debits.reduce((s, d) => s + d.remaining, 0) - extraCredit);
    if (Math.abs(balance) < 0.005) continue;
    const b = [0, 0, 0, 0]; let oldest = '';
    for (const d of debits) if (d.remaining > 0) {
      const ref = basis === 'event' && d.kind === 'inv' && d.ref.eventDate ? d.ref.eventDate : d.date;
      const age = Math.max(0, daysBetween(ref, asOf));
      const k = BUCKETS.findIndex(([a, z]) => age >= a && age <= z);
      b[k] = r2(b[k] + d.remaining);
      if (!oldest || ref < oldest) oldest = ref;
    }
    rows.push({ c, balance, b, age: oldest ? daysBetween(oldest, asOf) : 0, last: lastPayment(c.id) });
  }
  return rows.sort((x, y) => y.balance - x.balance);
}
function vAging(main, _id, q) {
  const asOf = q.get('asof') || todayStr(), basis = q.get('basis') || 'inv', show = q.get('show') || 'debt';
  let rows = agingData(asOf, basis);
  if (show === 'debt') rows = rows.filter((r) => r.balance > 0);
  if (show === 'over30') rows = rows.filter((r) => r.balance > 0 && r.b[1] + r.b[2] + r.b[3] > 0);
  const tot = [0, 0, 0, 0], total = rows.reduce((s, r) => { r.b.forEach((v, i) => (tot[i] += v)); return s + r.balance; }, 0);
  main.innerHTML = page(`
    ${phead('أعمار الذمم', 'مين متأخر عليك وقديش — الدفعات بتنخصم من الدين الأقدم أولاً', '<button class="btn pri" id="aPrint">طباعة</button>')}
    <div class="toolbar">
      <label class="fld">حتى تاريخ<input type="date" id="aAsOf" value="${asOf}"></label>
      <label class="fld">العمر محسوب من<select id="aBasis"><option value="inv" ${basis === 'inv' ? 'selected' : ''}>تاريخ الطلبية</option><option value="event" ${basis === 'event' ? 'selected' : ''}>تاريخ المناسبة</option></select></label>
      <label class="fld grow">عرض<select id="aShow"><option value="debt" ${show === 'debt' ? 'selected' : ''}>كل من عليه رصيد</option><option value="over30" ${show === 'over30' ? 'selected' : ''}>المتأخرين أكثر من 30 يوم</option><option value="all" ${show === 'all' ? 'selected' : ''}>الكل مع الأرصدة الدائنة</option></select></label>
    </div>
    <div class="stats">${BUCKETS.map((bk, i) => `<div class="stat"><small>${bk[2]}</small><b class="${i >= 2 && tot[i] > 0 ? 'pos' : ''}">${money(tot[i])}</b></div>`).join('')}</div>
    <div class="card tbl-wrap"><table class="mcards"><thead><tr><th>العريس</th><th>الجوال</th><th class="n">الرصيد</th>${BUCKETS.map((b) => `<th class="n">${b[2]}</th>`).join('')}<th>آخر دفعة</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const wa = waLink(r.c.phone, reminderText(r.c)); return `<tr class="click" data-c="${r.c.id}"><td class="hd" data-label="">${h(custName(r.c))} ${r.balance > 0 && r.age > 30 ? `<span class="days ${r.age > 90 ? 'd3' : r.age > 60 ? 'd2' : 'd1'}">${r.age} يوم</span>` : ''}</td><td data-label="الجوال"><span class="num">${h(r.c.phone)}</span></td><td class="n ${r.balance > 0 ? 'pos' : 'neg'}" data-label="الرصيد"><b>${money(r.balance)}</b></td>${r.b.map((v, i) => `<td class="n" data-label="${v ? BUCKETS[i][2] : ''}">${v ? money(v) : (matchMedia('(max-width:760px)').matches ? '' : '—')}</td>`).join('')}<td data-label="آخر دفعة">${fmtDate(r.last) || '<span class="muted">لا يوجد</span>'}</td><td data-label="">${wa && r.balance > 0 ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${wa}" onclick="event.stopPropagation()">مطالبة واتساب</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty"><b>لا يوجد ذمم 🎉</b>كل العرسان مسددين</td></tr>'}
    </tbody>${rows.length ? `<tfoot><tr><td colspan="2" data-label="">${rows.length} عريس</td><td class="n" data-label="المجموع">${money(total)}</td>${tot.map((v, i) => `<td class="n" data-label="${BUCKETS[i][2]}">${money(v)}</td>`).join('')}<td colspan="2"></td></tr></tfoot>` : ''}</table></div>`);
  const nav = () => (location.hash = `#/aging?asof=${$('#aAsOf').value}&basis=${$('#aBasis').value}&show=${$('#aShow').value}`);
  ['aAsOf', 'aBasis', 'aShow'].forEach((x) => ($('#' + x).onchange = nav));
  $$('[data-c]', main).forEach((r) => (r.onclick = () => (location.hash = '#/customer/' + r.dataset.c)));
  $('#aPrint').onclick = () => printAging(rows, tot, total, asOf, basis);
}

// ---------- الإعدادات ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; const c = $('#installBtn'); if (c) c.hidden = false; });
function vSettings(main, _id, q) {
  const secs = [
    ...(isAdmin() ? [['studio', 'الاستوديو'], ['services', 'الخدمات والأسعار'], ['users', 'المستخدمين']] : []),
    ['look', 'المظهر'], ['install', 'تثبيت على الهاتف'], ['account', 'حسابي'],
    ...(isAdmin() ? [['backup', 'النسخ الاحتياطي']] : []),
  ];
  let t = q.get('t'); if (!secs.some((s) => s[0] === t)) t = secs[0][0];
  main.innerHTML = page(`${phead('الإعدادات')}<div class="setnav" role="tablist">${secs.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${k === t}">${l}</button>`).join('')}</div><div id="setBody"></div>`);
  $$('[data-t]', main).forEach((b) => (b.onclick = () => (location.hash = '#/settings?t=' + b.dataset.t)));
  const body = $('#setBody');
  const S_ = S.settings;
  if (t === 'studio') {
    let logo = S_.logo || '';
    body.innerHTML = `<div class="card"><h3>بيانات الاستوديو <small>تظهر على الفواتير والكشوفات</small></h3><div class="grid2">
      <label class="fld">اسم الاستوديو<input id="sName" value="${h(S_.studioName)}"></label>
      <label class="fld">وصف قصير<input id="sSub" value="${h(S_.subtitle)}"></label>
      <label class="fld">الهاتف<input id="sPhone" class="n" value="${h(S_.phone)}"></label>
      <label class="fld">العنوان<input id="sAddr" value="${h(S_.address)}"></label>
      <label class="fld">رمز العملة<input id="sCur" value="${h(S_.currency)}"></label>
      <label class="fld">نص أسفل الفاتورة<input id="sFoot" value="${h(S_.invoiceFooter)}"></label>
      <label class="fld">الشعار<input type="file" accept="image/*" id="sLogo"></label>
      <div class="actions">${S_.logo ? `<img src="${h(S_.logo)}" style="max-height:56px;border-radius:8px"><button class="btn sm danger" id="sLogoDel">إزالة الشعار</button>` : '<span class="muted small">لا يوجد شعار</span>'}</div>
    </div><div class="actions" style="margin-top:12px"><button class="btn ok" id="sSave">حفظ</button></div></div>`;
    const collect = () => ({ studioName: $('#sName').value, subtitle: $('#sSub').value, phone: $('#sPhone').value, address: $('#sAddr').value, currency: $('#sCur').value, invoiceFooter: $('#sFoot').value, logo });
    $('#sLogo').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image(); img.onload = () => {
        const k = Math.min(1, 320 / Math.max(img.width, img.height)); const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        logo = cv.toDataURL('image/png'); toast('تم تجهيز الشعار — اضغط حفظ');
      }; img.src = URL.createObjectURL(f);
    };
    if ($('#sLogoDel')) $('#sLogoDel').onclick = () => { logo = ''; act(() => api('PUT', 'settings', collect()), 'تمت إزالة الشعار').catch(() => {}); };
    $('#sSave').onclick = () => act(() => api('PUT', 'settings', collect()), 'تم الحفظ').catch(() => {});
  }
  if (t === 'services') {
    body.innerHTML = `<div class="card tone-green"><div class="phead"><div><h3 style="margin:0">الخدمات والأسعار</h3><p class="lead small">أسعار افتراضية — بتقدر تغيّر السعر داخل كل طلبية. الوحدة «خدمة» أو «قطعة» تنضاف بكمية 1، وأي وحدة ثانية (مثل «صورة») بيسألك عن العدد.</p></div><div class="actions"><button class="btn ok" id="addS">+ خدمة جديدة</button></div></div>
      ${S.services.map((s) => `<div class="svc-edit" data-s="${s.id}"><input class="inp nm" data-f="name" value="${h(s.name)}"><input class="inp n" type="number" step="any" inputmode="decimal" data-f="price" value="${s.price}" aria-label="السعر"><input class="inp" data-f="unit" value="${h(s.unit)}" list="units" aria-label="الوحدة"><label class="chk"><input type="checkbox" data-f="active" ${s.active !== false ? 'checked' : ''}> فعالة</label><div class="actions"><button class="btn sm pri" data-save>حفظ</button><button class="btn sm danger" data-del>حذف</button></div></div>`).join('')}
      <datalist id="units"><option>خدمة</option><option>صورة</option><option>قطعة</option><option>ساعة</option><option>ألبوم</option></datalist></div>`;
    const val = (row) => ({ name: $('[data-f=name]', row).value, price: $('[data-f=price]', row).value, unit: $('[data-f=unit]', row).value, active: $('[data-f=active]', row).checked });
    $$('[data-s]', body).forEach((row) => {
      $('[data-save]', row).onclick = () => act(() => api('PUT', 'services/' + row.dataset.s, val(row)), 'تم الحفظ').catch(() => {});
      $('[data-del]', row).onclick = () => { if (confirm('حذف الخدمة؟ (الطلبيات القديمة لا تتأثر)')) act(() => api('DELETE', 'services/' + row.dataset.s), 'تم الحذف').catch(() => {}); };
    });
    $('#addS').onclick = () => {
      const m = modal('خدمة جديدة', `<label class="fld">اسم الخدمة<input id="nsName"></label><div class="grid2"><label class="fld">السعر<input class="n" type="number" step="any" inputmode="decimal" id="nsPrice"></label><label class="fld">الوحدة<input id="nsUnit" value="خدمة" list="units"></label></div>`, `<button class="btn ok" id="nsSave">إضافة</button><button class="btn ghost" data-close>إلغاء</button>`);
      $$('[data-close]', m.root).forEach((b) => (b.onclick = closeModal));
      $('#nsSave').onclick = () => act(() => api('POST', 'services', { name: $('#nsName').value, price: $('#nsPrice').value, unit: $('#nsUnit').value }), 'تمت الإضافة').catch(() => {});
    };
  }
  if (t === 'users') {
    body.innerHTML = `<div class="card"><div class="phead"><div><h3 style="margin:0">المستخدمين</h3><p class="lead small">الموظف: يضيف عرسان وطلبيات ودفعات ويشوف الكشوفات. المدير: كل شي + الإلغاء والأسعار والإعدادات.</p></div><div class="actions"><button class="btn ok" id="addU">+ مستخدم</button></div></div>
      <div class="tbl-wrap"><table class="mcards"><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${S.users.map((u) => `<tr><td class="hd" data-label="">${h(u.name)}</td><td data-label="اسم الدخول"><span class="num">${h(u.username)}</span></td><td data-label="الصلاحية">${u.role === 'admin' ? '<span class="st st-ready">مدير</span>' : '<span class="st st-done">موظف</span>'}</td><td data-label="الحالة">${u.active ? '<span class="st st-new">فعال</span>' : '<span class="st st-void">موقوف</span>'}</td><td data-label=""><button class="btn sm" data-u="${u.id}">تعديل</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    const form = (u) => {
      u = u || { role: 'staff', active: true };
      const m = modal(u.id ? 'تعديل مستخدم' : 'مستخدم جديد', `
        <label class="fld">الاسم<input id="uName" value="${h(u.name || '')}"></label>
        ${u.id ? '' : '<label class="fld">اسم الدخول (إنجليزي)<input id="uUser" dir="ltr" autocapitalize="off"></label>'}
        <label class="fld">${u.id ? 'كلمة مرور جديدة (اتركها فاضية إذا ما بدك تغيرها)' : 'كلمة المرور'}<input id="uPass" dir="ltr" autocapitalize="off"></label>
        <div class="grid2"><label class="fld">الصلاحية<select id="uRole"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>موظف</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>مدير</option></select></label>
        ${u.id ? `<label class="fld">الحالة<select id="uAct"><option value="1">فعال</option><option value="0" ${u.active ? '' : 'selected'}>موقوف</option></select></label>` : ''}</div>`,
        `<button class="btn ok" id="uSave">حفظ</button><button class="btn ghost" data-close>إلغاء</button>`);
      $$('[data-close]', m.root).forEach((b) => (b.onclick = closeModal));
      $('#uSave').onclick = () => {
        const b = { name: $('#uName').value, password: $('#uPass').value, role: $('#uRole').value };
        act(() => (u.id ? api('PUT', 'users/' + u.id, { ...b, active: $('#uAct').value === '1' }) : api('POST', 'users', { ...b, username: $('#uUser').value })), 'تم الحفظ').catch(() => {});
      };
    };
    $('#addU').onclick = () => form();
    $$('[data-u]', body).forEach((b) => (b.onclick = () => form(byId(S.users, b.dataset.u))));
  }
  if (t === 'look') {
    const cur = LS.get('sl_theme', 'auto');
    body.innerHTML = `<div class="card"><h3>المظهر <small>بينحفظ على هذا الجهاز</small></h3><div class="seg">${[['auto', 'تلقائي حسب الجهاز'], ['light', 'فاتح'], ['dark', 'داكن']].map(([k, l]) => `<button data-th="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div></div>`;
    $$('[data-th]', body).forEach((b) => (b.onclick = () => { LS.set('sl_theme', b.dataset.th); applyTheme(); route(); }));
  }
  if (t === 'install') {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    body.innerHTML = `<div class="card"><h3>تثبيت البرنامج كتطبيق</h3>
      ${standalone ? '<p class="lead">✅ أنت فاتح البرنامج كتطبيق مثبّت.</p>' : ''}
      <button class="btn ok big" id="installBtn" ${deferredInstall ? '' : 'hidden'}>تثبيت الآن</button>
      <div class="cols2" style="margin-top:12px">
        <div class="card tone-blue" style="background:var(--tone-soft);border-color:var(--tone-line)"><h3>آيفون وآيباد ${ios ? '<small>(جهازك)</small>' : ''}</h3><ol class="steps"><li>افتح الرابط في <b>Safari</b>.</li><li>اضغط زر <b>المشاركة</b> (المربع مع السهم لفوق).</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم «إضافة».</li></ol></div>
        <div class="card tone-green" style="background:var(--tone-soft);border-color:var(--tone-line)"><h3>أندرويد</h3><ol class="steps"><li>افتح الرابط في <b>Chrome</b>.</li><li>اضغط النقاط الثلاث ⋮ فوق.</li><li>اختر <b>«تثبيت التطبيق»</b> أو «إضافة إلى الشاشة الرئيسية».</li></ol></div>
        <div class="card tone-rep" style="background:var(--tone-soft);border-color:var(--tone-line)"><h3>كمبيوتر (ويندوز أو ماك)</h3><ol class="steps"><li>افتح الرابط في <b>Chrome</b> أو <b>Edge</b>.</li><li>اضغط أيقونة التثبيت ⊕ بآخر شريط العنوان.</li><li>بيفتح بنافذة لحاله زي أي برنامج.</li></ol></div>
      </div>
      <p class="muted small" style="margin-bottom:0">بعد التثبيت بتطلع أيقونة «${h(S_.studioName)}» على الشاشة، وبيفتح بدون شريط المتصفح. أي تحديث بيوصل لحاله.</p></div>`;
    if ($('#installBtn')) $('#installBtn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installBtn').hidden = true; };
  }
  if (t === 'account') {
    body.innerHTML = `<div class="card"><h3>تغيير كلمة المرور <small>${h(S.me.name)}</small></h3><div class="grid2">
      <label class="fld">كلمة المرور الحالية<input type="password" id="pOld" dir="ltr"></label><label class="fld">كلمة المرور الجديدة<input type="password" id="pNew" dir="ltr"></label></div>
      <div class="actions" style="margin-top:12px"><button class="btn ok" id="pSave">تغيير</button></div></div>`;
    $('#pSave').onclick = () => act(() => api('POST', 'me/password', { oldPassword: $('#pOld').value, newPassword: $('#pNew').value }), 'تم تغيير كلمة المرور').catch(() => {});
  }
  if (t === 'backup') {
    body.innerHTML = `<div class="card"><h3>النسخ الاحتياطي</h3><p class="lead small">البرنامج بيحفظ نسخة يومية تلقائياً على السيرفر (آخر 60 يوم). وبتقدر كمان تنزّل نسخة على جهازك.</p>
      <div class="actions"><a class="btn pri" href="/api/backup">تنزيل نسخة احتياطية</a><label class="btn">استرجاع من نسخة…<input type="file" accept=".json" id="restore" hidden></label></div></div>`;
    $('#restore').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المختارة (بينحفظ نسخة من الحالي على السيرفر قبل). متابعة؟')) return;
      try { await api('POST', 'restore', JSON.parse(await f.text())); toast('تم الاسترجاع'); await start(); } catch (err) { toast(err.message, true); }
    };
  }
}

// ---------- الطباعة: معاينة A4 مثل البرنامج ----------
const PRINT_CSS = `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12.5px/1.55 'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#000;margin:0;direction:rtl}
.dh{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #000;padding-bottom:8px;margin-bottom:10px}.dh h1{margin:0;font-size:22px}.dh img{max-height:64px;max-width:150px}
.dt{text-align:center;font-size:17px;font-weight:700;margin:6px 0 10px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 18px;margin-bottom:10px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 7px;text-align:right}th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
td.n,th.n{text-align:left}.num{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}tr.drow td{background:#f3f3f3;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.iline td{font-size:11px;color:#333}tr.iline td.it{padding-right:18px}
tfoot td{font-weight:700;background:#eee}.sum{width:55%;margin:10px 0 0 auto}.sum td{font-weight:600}.muted{color:#666}.small{font-size:11px}
.words{margin-top:6px;font-weight:600}.foot{margin-top:22px;display:flex;justify-content:space-between;font-size:11px;color:#444}.sign{margin-top:36px;display:flex;justify-content:space-between}.sign div{border-top:1px solid #000;padding-top:4px;width:170px;text-align:center}`;
const PREVIEW_CSS = `@media screen{html{background:#7d848c}body{width:210mm;min-height:297mm;margin:16px auto;padding:12mm;box-shadow:0 4px 24px rgba(0,0,0,.35);background:#fff}}@media screen and (max-width:820px){html{background:#fff}body{width:auto;min-height:0;margin:0;padding:12px;box-shadow:none}}`;
function printDoc(title, body) {
  closePrint();
  const s = S.settings;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${h(title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap"><style>${PRINT_CSS}${PREVIEW_CSS}</style></head><body>
    <div class="dh"><div><h1>${h(s.studioName)}</h1><div>${h(s.subtitle || '')}</div><div>${h(s.phone || '')}${s.address ? ' · ' + h(s.address) : ''}</div></div>${s.logo ? `<img src="${h(s.logo)}">` : ''}</div>
    ${body}<div class="foot"><span>${h(s.invoiceFooter || '')}</span><span>طُبع بواسطة ${h(S.me.name)} — <span class="num">${new Date().toLocaleString('en-GB')}</span></span></div></body></html>`;
  const ov = document.createElement('div'); ov.className = 'print-ov'; ov.id = 'printFrame';
  ov.innerHTML = `<div class="print-box"><div class="print-bar"><b class="pttl">${h(title)}</b><button class="btn sm pri" data-p="go">طباعة</button><button class="btn sm" data-p="pdf">حفظ PDF</button><button class="btn sm ghost" data-p="x">إغلاق</button></div><iframe title="معاينة الطباعة"></iframe></div>`;
  document.body.appendChild(ov);
  ov.querySelector('iframe').srcdoc = html;
  const go = () => { const fr = $('#printFrame iframe'); const old = document.title; document.title = title; try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { toast('تعذرت الطباعة', true); } setTimeout(() => (document.title = old), 1500); };
  $('[data-p=go]', ov).onclick = go;
  $('[data-p=pdf]', ov).onclick = () => { toast('اختر «حفظ كـ PDF» من نافذة الطباعة'); go(); };
  $('[data-p=x]', ov).onclick = closePrint;
}
function closePrint() { const f = $('#printFrame'); if (f) f.remove(); }
function tafqeet(n) {
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
  const u1000 = (x) => { const w = []; const hh = Math.floor(x / 100), r = x % 100; if (hh) w.push(hundreds[hh]); if (r) { if (r < 20) w.push(ones[r]); else { const o = r % 10, t = Math.floor(r / 10); w.push(o ? ones[o] + ' و' + tens[t] : tens[t]); } } return w.join(' و'); };
  const scale = (x, one, two, few, many) => (x === 1 ? one : x === 2 ? two : x <= 10 ? u1000(x) + ' ' + few : u1000(x) + ' ' + many);
  const words = (x) => { if (!x) return 'صفر'; const p = []; const m = Math.floor(x / 1e6), t = Math.floor((x % 1e6) / 1000), r = x % 1000; if (m) p.push(scale(m, 'مليون', 'مليونان', 'ملايين', 'مليون')); if (t) p.push(scale(t, 'ألف', 'ألفان', 'آلاف', 'ألف')); if (r) p.push(u1000(r)); return p.join(' و'); };
  n = Math.round((Number(n) || 0) * 100); const sh = Math.floor(n / 100), ag = n % 100;
  return 'فقط ' + words(sh) + ' شيكل' + (ag ? ' و' + u1000(ag) + ' أغورة' : '') + ' لا غير';
}
function printInvoice(inv) {
  if (!inv) return;
  const c = byId(S.customers, inv.customerId);
  const paidOn = S.payments.filter((p) => p.invoiceId === inv.id && !p.cancelled).reduce((s, p) => s + p.amount, 0);
  printDoc(`طلبية ${inv.no} — ${custName(c)}`, `<div class="dt">فاتورة / طلبية رقم ${inv.no}${inv.cancelled ? ' (ملغاة)' : ''}</div>
    <div class="meta"><div>العريس: <b>${h(custName(c))}</b></div><div>التاريخ: <b>${fmtDate(inv.date)}</b></div>
    <div>الجوال: <b class="num">${h(c.phone || '')}</b></div><div>تاريخ المناسبة: <b>${fmtDate(inv.eventDate) || '—'}</b></div>${inv.dueDate ? `<div>موعد التسليم: <b>${fmtDate(inv.dueDate)}</b></div>` : ''}</div>
    <table><thead><tr><th>#</th><th>الصنف</th><th class="n">الكمية</th><th class="n">السعر</th><th class="n">المجموع</th></tr></thead><tbody>
    ${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td>${h(it.name)}</td><td class="n">${fmt(it.qty)} ${h(it.unit && it.unit !== 'خدمة' ? it.unit : '')}</td><td class="n">${money(it.price)}</td><td class="n">${money(it.total)}</td></tr>`).join('')}</tbody></table>
    <table class="sum"><tr><td>المجموع</td><td class="n">${money(inv.subtotal)}</td></tr>${inv.discount ? `<tr><td>الخصم</td><td class="n">${money(inv.discount)}</td></tr>` : ''}<tr><td>الإجمالي</td><td class="n"><b>${money(inv.total)}</b></td></tr>
    ${paidOn ? `<tr><td>المدفوع على الطلبية</td><td class="n">${money(paidOn)}</td></tr>` : ''}<tr><td>الرصيد المستحق على الحساب</td><td class="n"><b>${money(bal(c.id))}</b></td></tr></table>
    <div class="words">${tafqeet(inv.total)}</div>${inv.notes ? `<p>ملاحظات: ${h(inv.notes)}</p>` : ''}
    <div class="sign"><div>توقيع العريس</div><div>${h(S.settings.studioName)}</div></div>`);
}
function printReceipt(p) {
  if (!p) return;
  const c = byId(S.customers, p.customerId);
  const inv = p.invoiceId && byId(S.invoices, p.invoiceId);
  printDoc(`سند قبض ${p.no} — ${custName(c)}`, `<div class="dt">سند قبض رقم ${p.no}${p.cancelled ? ' (ملغى)' : ''}</div>
    <div class="meta"><div>التاريخ: <b>${fmtDate(p.date)}</b></div><div>طريقة الدفع: <b>${h(p.method)}</b></div></div>
    <p style="font-size:15px;line-height:2.2">استلمنا من السيد/ <b>${h(custName(c))}</b><br>مبلغاً وقدره: <b style="font-size:19px">${money(p.amount)}</b><br><span class="words">${tafqeet(p.amount)}</span><br>
    وذلك عن: <b>${h(p.note || (inv ? 'دفعة على طلبية رقم ' + inv.no : 'دفعة على الحساب'))}</b></p>
    <table class="sum"><tr><td>الرصيد المتبقي على الحساب</td><td class="n"><b>${money(bal(c.id))}</b></td></tr></table>
    <div class="sign"><div>المستلم: ${h(p.createdByName || '')}</div><div>التوقيع</div></div>`);
}
function printStatement(c, from, to, detailed) {
  const st = statementRows(c.id, from, to);
  printDoc(`كشف حساب — ${custName(c)}`, `<div class="dt">كشف حساب ${detailed ? 'تفصيلي' : ''}</div>
    <div class="meta"><div>العريس: <b>${h(custName(c))}</b></div><div>الفترة: <b>${from ? fmtDate(from) : 'من البداية'} — ${fmtDate(to || todayStr())}</b></div>
    <div>الجوال: <b class="num">${h(c.phone || '')}</b></div><div>تاريخ العرس: <b>${fmtDate(c.weddingDate) || '—'}</b></div></div>
    ${statementTable(st, detailed, true)}<table class="sum"><tr><td>الرصيد المستحق</td><td class="n"><b>${money(st.closing)}</b></td></tr></table>`);
}
function printAging(rows, tot, total, asOf, basis) {
  printDoc(`أعمار الذمم ${asOf}`, `<div class="dt">تقرير أعمار الذمم حتى ${fmtDate(asOf)}</div><p class="small">العمر محسوب من ${basis === 'event' ? 'تاريخ المناسبة' : 'تاريخ الطلبية'}</p>
    <table><thead><tr><th>العريس</th><th>الجوال</th><th class="n">الرصيد</th>${BUCKETS.map((b) => `<th class="n">${b[2]}</th>`).join('')}<th>آخر دفعة</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${h(custName(r.c))}</td><td class="num">${h(r.c.phone)}</td><td class="n"><b>${money(r.balance)}</b></td>${r.b.map((v) => `<td class="n">${v ? money(v) : '—'}</td>`).join('')}<td>${fmtDate(r.last) || '—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2">المجموع (${rows.length})</td><td class="n">${money(total)}</td>${tot.map((v) => `<td class="n">${money(v)}</td>`).join('')}<td></td></tr></tfoot></table>`);
}

// ---------- تشغيل ----------
async function start() {
  try { await load(); } catch { return renderLogin(); }
  renderShell(); route();
}
const host = document.createElement('div'); host.id = 'toastHost'; document.body.appendChild(host);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
