/* Studio Lite — الواجهة */
'use strict';
let S = null;              // كل البيانات من السيرفر
let POS = null;            // حالة نقطة البيع
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
const isAdmin = () => S && S.me.role === 'admin';
const custName = (c) => c ? (c.bride ? `${c.groom} و ${c.bride}` : c.groom) : '—';
const byId = (arr, id) => arr.find((x) => x.id === id);

// ---------- اتصال ----------
async function api(method, url, body) {
  const res = await fetch('/api/' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = {}; try { data = await res.json(); } catch {}
  if (res.status === 401 && url !== 'login' && url !== 'state') { S = null; renderLogin(); throw new Error(data.error || 'انتهت الجلسة'); }
  if (!res.ok) { const e = new Error(data.error || 'حدث خطأ'); e.status = res.status; throw e; }
  return data;
}
async function load() { S = await api('GET', 'state'); }
async function act(fn, okMsg) {
  try { const r = await fn(); await load(); if (okMsg) toast(okMsg); route(); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
function toast(msg, err) {
  const d = document.createElement('div'); d.className = 't-msg' + (err ? ' err' : ''); d.textContent = msg;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), err ? 4500 : 2500);
}

// ---------- الحسابات ----------
function custTx(cid) {
  const c = byId(S.customers, cid);
  const tx = [];
  if (c && r2(c.openingBalance) !== 0) tx.push({ kind: 'open', date: (c.createdAt || '').slice(0, 10) || '2000-01-01', sort: '0', debit: Math.max(c.openingBalance, 0), credit: Math.max(-c.openingBalance, 0), desc: 'رصيد افتتاحي' });
  for (const i of S.invoices) if (i.customerId === cid && !i.cancelled) tx.push({ kind: 'inv', ref: i, date: i.date, sort: i.createdAt, debit: i.total, credit: 0, desc: `طلبية رقم ${i.no}` });
  for (const p of S.payments) if (p.customerId === cid && !p.cancelled) tx.push({ kind: 'pay', ref: p, date: p.date, sort: p.createdAt, debit: 0, credit: p.amount, desc: `سند قبض رقم ${p.no} — ${p.method}${p.note ? ' — ' + p.note : ''}` });
  tx.sort((a, b) => a.date.localeCompare(b.date) || String(a.sort).localeCompare(String(b.sort)));
  return tx;
}
function balanceOf(cid, asOf) {
  return r2(custTx(cid).filter((t) => !asOf || t.date <= asOf).reduce((s, t) => s + t.debit - t.credit, 0));
}
let _balCache = null;
function balances() {
  if (_balCache && _balCache.S === S) return _balCache.m;
  const m = new Map(S.customers.map((c) => [c.id, r2(c.openingBalance)]));
  for (const i of S.invoices) if (!i.cancelled) m.set(i.customerId, r2((m.get(i.customerId) || 0) + i.total));
  for (const p of S.payments) if (!p.cancelled) m.set(p.customerId, r2((m.get(p.customerId) || 0) - p.amount));
  _balCache = { S, m }; return m;
}
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
function lastPayment(cid) {
  return S.payments.filter((p) => p.customerId === cid && !p.cancelled).map((p) => p.date).sort().pop() || '';
}
function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  else if (/^0(59|56)/.test(p)) p = '970' + p.slice(1);
  else if (p.startsWith('0')) p = '972' + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function reminderText(c) {
  const bal = balances().get(c.id) || 0;
  return `مرحباً ${c.groom}، تحية طيبة من ${S.settings.studioName}.\nنود تذكيركم بأن الرصيد المستحق على حسابكم هو ${moneyTxt(bal)}.\nشاكرين تعاملكم معنا 🌹`;
}
const statusClass = (s) => ({ 'جديدة': 'b-new', 'قيد التنفيذ': 'b-prog', 'جاهزة': 'b-ready', 'تم التسليم': 'b-done' }[s] || '');

// ---------- أيقونات ----------
const I = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  pos: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/>',
  doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;

// ---------- الهيكل ----------
function renderShell() {
  const logo = S.settings.logo ? `<img src="${h(S.settings.logo)}" alt="">` : `<div class="logo">${h((S.settings.studioName || 'S')[0])}</div>`;
  const nav = [
    ['dashboard', 'الرئيسية', 'home'], ['pos', 'نقطة البيع', 'pos'], ['customers', 'العرسان', 'users'],
    ['invoices', 'الطلبيات', 'doc'], ['payments', 'الدفعات', 'cash'], ['aging', 'أعمار الذمم', 'clock'], 'sep',
    ...(isAdmin() ? [['services', 'الخدمات والأسعار', 'tag'], ['users', 'المستخدمين', 'key'], ['settings', 'الإعدادات', 'gear']] : [['settings', 'حسابي', 'gear']]),
  ];
  $('#app').innerHTML = `
  <div class="mobile-bar"><b>${h(S.settings.studioName)}</b><button id="menuBtn">☰</button></div>
  <div class="shell">
    <aside class="side" id="side">
      <div class="brand">${logo}<div><b>${h(S.settings.studioName)}</b><small>${h(S.settings.subtitle || '')}</small></div></div>
      <nav class="nav">${nav.map((n) => n === 'sep' ? '<div class="sep"></div>' : `<a href="#/${n[0]}" data-r="${n[0]}">${ico(n[2])}${n[1]}</a>`).join('')}</nav>
      <div class="who"><div><b>${h(S.me.name)}</b><br>${isAdmin() ? 'مدير' : 'موظف'}</div><button class="btn sm" id="logoutBtn">خروج</button></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  $('#logoutBtn').onclick = async () => { await api('POST', 'logout'); S = null; renderLogin(); };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
}
function topBar(title, sub, actions = '') {
  return `<div class="top"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="btns">${actions}</div></div>`;
}

// ---------- الدخول ----------
async function renderLogin() {
  let name = 'Studio Lite', subtitle = '';
  try { const p = await api('GET', 'public-settings'); name = p.studioName; subtitle = p.subtitle; } catch {}
  document.title = name;
  $('#app').innerHTML = `<div class="login"><form class="box" id="lf">
    <h1>${h(name)}</h1><p>${h(subtitle || 'برنامج المحاسبة')}</p>
    <label class="f">اسم المستخدم<input class="in" name="username" autocomplete="username" required dir="ltr"></label>
    <label class="f">كلمة المرور<input class="in" name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
    <button class="btn pri lg">دخول</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('POST', 'login', { username: f.get('username'), password: f.get('password') }); await start(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- الموجّه ----------
function route() {
  if (!S) return;
  const [path, qs] = (location.hash.slice(2) || 'dashboard').split('?');
  const [name, id] = path.split('/');
  const q = new URLSearchParams(qs || '');
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === name || (name === 'customer' && a.dataset.r === 'customers')));
  $('#side')?.classList.remove('open');
  const views = { dashboard: vDashboard, pos: vPos, customers: vCustomers, customer: vCustomer, invoices: vInvoices, payments: vPayments, aging: vAging, services: vServices, users: vUsers, settings: vSettings };
  const v = views[name] || vDashboard;
  const main = $('#main');
  if (!main) return;
  v(main, id, q);
  document.title = S.settings.studioName;
}
window.addEventListener('hashchange', route);

// ---------- اختيار العريس ----------
function pickerHTML(selectedId, allowNew = true) {
  const c = selectedId && byId(S.customers, selectedId);
  if (c) return `<div class="chosen"><div><b>${h(custName(c))}</b><small>${h(c.phone || '')} ${c.weddingDate ? '· العرس ' + h(c.weddingDate) : ''} · الرصيد ${money(balances().get(c.id) || 0)}</small></div><button type="button" class="btn sm" data-pk="clear">تغيير</button></div>`;
  return `<div class="row" style="align-items:stretch"><div class="picker" style="flex:3"><input class="in" data-pk="q" placeholder="ابحث باسم العريس أو العروس أو الجوال…" autocomplete="off"><div class="list" hidden></div></div>${allowNew ? '<button type="button" class="btn gold" data-pk="new" style="flex:0 0 auto;min-width:0">+ عريس جديد</button>' : ''}</div>`;
}
function bindPicker(root, onPick) {
  const clear = $('[data-pk=clear]', root); if (clear) clear.onclick = () => onPick(null);
  const nw = $('[data-pk=new]', root); if (nw) nw.onclick = () => customerModal(null, (c) => onPick(c.id));
  const q = $('[data-pk=q]', root); if (!q) return;
  const list = $('.list', root.querySelector('.picker'));
  let idx = 0, results = [];
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    results = S.customers.filter((c) => !t || [c.groom, c.bride, c.phone, c.phone2, String(c.no)].some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 30);
    idx = 0;
    list.innerHTML = results.length ? results.map((c, i) => `<div class="opt ${i === 0 ? 'act' : ''}" data-i="${i}"><span>${h(custName(c))}</span><small>${h(c.phone || '')} ${c.weddingDate ? '· ' + h(c.weddingDate) : ''}</small></div>`).join('')
      : `<div class="empty small">لا يوجد. اضغط "عريس جديد" لإضافته${t ? ` <button type="button" class="btn sm gold" id="pkAddQ">إضافة "${h(q.value.trim())}"</button>` : ''}</div>`;
    list.hidden = false;
    const addQ = $('#pkAddQ', list); if (addQ) addQ.onmousedown = (e) => { e.preventDefault(); customerModal({ groom: q.value.trim() }, (c) => onPick(c.id)); };
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
function modal(title, body, footer, wide) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}"><header><h3>${title}</h3><button class="xbtn" data-close>×</button></header><div class="body">${body}</div><footer>${footer || ''}</footer></div></div>`;
  const close = () => (root.innerHTML = '');
  $$('[data-close]', root).forEach((b) => (b.onclick = close));
  $('.modal-bg', root).onmousedown = (e) => { if (e.target.classList.contains('modal-bg')) close(); };
  const first = $('input:not([type=hidden]),select,textarea', root); if (first) setTimeout(() => first.focus(), 30);
  return { root: $('.modal', root), close };
}
const closeModal = () => ($('#modal-root').innerHTML = '');

function customerModal(c, after) {
  const isNew = !c || !c.id; c = c || {};
  const m = modal(isNew ? 'إضافة عريس جديد' : 'تعديل بيانات العريس', `
    <form id="cf" class="grid g2">
      <label class="f">اسم العريس *<input class="in" name="groom" value="${h(c.groom)}" required></label>
      <label class="f">اسم العروس<input class="in" name="bride" value="${h(c.bride)}"></label>
      <label class="f">الجوال<input class="in num-in" name="phone" value="${h(c.phone)}" inputmode="tel" placeholder="059xxxxxxx"></label>
      <label class="f">جوال آخر<input class="in num-in" name="phone2" value="${h(c.phone2)}" inputmode="tel"></label>
      <label class="f">تاريخ العرس<input class="in" type="date" name="weddingDate" value="${h(c.weddingDate)}"></label>
      <label class="f">العنوان / مكان الحفلة<input class="in" name="address" value="${h(c.address)}"></label>
      <label class="f">رصيد سابق (افتتاحي)<input class="in num-in" type="number" step="any" name="openingBalance" value="${h(c.openingBalance || '')}" placeholder="0"></label>
      <label class="f" style="grid-column:1/-1">ملاحظات<textarea class="in" name="notes">${h(c.notes)}</textarea></label>
    </form>`, `<button class="btn pri" id="cfSave">حفظ</button><button class="btn" data-close>إلغاء</button>`);
  const saveIt = async (force) => {
    const f = Object.fromEntries(new FormData($('#cf')).entries());
    if (!f.groom.trim()) return toast('اسم العريس مطلوب', true);
    try {
      const r = isNew ? await api('POST', 'customers', { ...f, force }) : await api('PUT', 'customers/' + c.id, f);
      await load(); m.close(); toast(isNew ? 'تمت إضافة العريس' : 'تم الحفظ');
      after ? after(r) : route();
    } catch (e) {
      if (e.status === 409 && confirm(e.message + '\nهل تريد إضافته رغم ذلك؟')) return saveIt(true);
      if (e.status !== 409) toast(e.message, true);
    }
  };
  $('#cfSave').onclick = () => saveIt(false);
  $('#cf').onsubmit = (e) => { e.preventDefault(); saveIt(false); };
}

function paymentModal(customerId, invoiceId) {
  let cid = customerId || null;
  const draw = () => {
    const invs = cid ? S.invoices.filter((i) => i.customerId === cid && !i.cancelled) : [];
    const bal = cid ? balances().get(cid) || 0 : 0;
    m.root.querySelector('.body').innerHTML = `
      <div id="pp">${pickerHTML(cid, true)}</div>
      ${cid ? `<div class="muted small">الرصيد الحالي على العريس: <b class="${bal > 0 ? 'pos' : 'neg'}">${money(bal)}</b></div>` : ''}
      <div class="grid g2">
        <label class="f">المبلغ *<input class="in num-in" type="number" step="any" min="0" id="pAmt" inputmode="decimal" value="${bal > 0 ? '' : ''}"></label>
        <label class="f">طريقة الدفع<select class="in" id="pMethod">${S.methods.map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="f">التاريخ<input class="in" type="date" id="pDate" value="${todayStr()}"></label>
        <label class="f">على طلبية (اختياري)<select class="in" id="pInv"><option value="">— دفعة على الحساب —</option>${invs.map((i) => `<option value="${i.id}" ${i.id === invoiceId ? 'selected' : ''}>رقم ${i.no} — ${i.date} — ${moneyTxt(i.total)}</option>`).join('')}</select></label>
        <label class="f" style="grid-column:1/-1">ملاحظة<input class="in" id="pNote"></label>
      </div>
      ${bal > 0 ? `<div class="btns"><span class="muted small">مبلغ سريع:</span><button type="button" class="btn sm" data-q="${bal}">كامل الرصيد ${moneyTxt(bal)}</button></div>` : ''}`;
    bindPicker($('#pp', m.root), (id) => { cid = id; draw(); });
    $$('[data-q]', m.root).forEach((b) => (b.onclick = () => ($('#pAmt').value = b.dataset.q)));
  };
  const m = modal('قبض دفعة (سند قبض)', '', `<button class="btn pri" id="pSave">حفظ الدفعة</button><button class="btn" id="pSavePrint">حفظ وطباعة سند</button><button class="btn" data-close>إلغاء</button>`);
  draw();
  const go = async (print) => {
    if (!cid) return toast('اختر العريس', true);
    const amount = r2($('#pAmt').value);
    if (!(amount > 0)) return toast('أدخل المبلغ', true);
    try {
      const p = await api('POST', 'payments', { customerId: cid, amount, method: $('#pMethod').value, date: $('#pDate').value, invoiceId: $('#pInv').value, note: $('#pNote').value });
      await load(); m.close(); toast('تم حفظ الدفعة'); route();
      if (print) printReceipt(byId(S.payments, p.id));
    } catch (e) { toast(e.message, true); }
  };
  $('#pSave').onclick = () => go(false);
  $('#pSavePrint').onclick = () => go(true);
}

// ---------- الرئيسية ----------
function vDashboard(main) {
  const t = todayStr();
  const salesToday = S.invoices.filter((i) => !i.cancelled && i.date === t).reduce((s, i) => s + i.total, 0);
  const cashToday = S.payments.filter((p) => !p.cancelled && p.date === t).reduce((s, p) => s + p.amount, 0);
  const month = t.slice(0, 7);
  const salesMonth = S.invoices.filter((i) => !i.cancelled && i.date.startsWith(month)).reduce((s, i) => s + i.total, 0);
  const bal = balances();
  const totalAR = [...bal.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const upcoming = S.customers.filter((c) => c.weddingDate && c.weddingDate >= t && c.weddingDate <= addDays(t, 21)).sort((a, b) => a.weddingDate.localeCompare(b.weddingDate));
  const ready = S.invoices.filter((i) => !i.cancelled && i.status === 'جاهزة');
  const inProg = S.invoices.filter((i) => !i.cancelled && (i.status === 'جديدة' || i.status === 'قيد التنفيذ'));
  main.innerHTML = topBar(`أهلاً ${h(S.me.name)} 👋`, new Date().toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    `<a class="btn gold lg" href="#/pos">+ طلبية جديدة</a><button class="btn lg" id="dPay">قبض دفعة</button>`) + `
  <div class="grid g4">
    <div class="card stat gold"><div class="l">إجمالي الذمم (المستحق على العرسان)</div><div class="v">${money(totalAR)}</div></div>
    <div class="card stat"><div class="l">مبيعات اليوم</div><div class="v">${money(salesToday)}</div></div>
    <div class="card stat"><div class="l">مقبوضات اليوم</div><div class="v">${money(cashToday)}</div></div>
    <div class="card stat"><div class="l">مبيعات هذا الشهر</div><div class="v">${money(salesMonth)}</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>أعراس قادمة (3 أسابيع)</h3>${upcoming.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>العريس</th><th>بعد</th><th>الرصيد</th></tr></thead><tbody>${upcoming.map((c) => `<tr class="click" data-c="${c.id}"><td>${c.weddingDate}</td><td>${h(custName(c))}</td><td>${daysBetween(t, c.weddingDate) === 0 ? '<span class="badge b-bad">اليوم</span>' : daysBetween(t, c.weddingDate) + ' يوم'}</td><td class="${(bal.get(c.id) || 0) > 0 ? 'pos' : ''}">${money(bal.get(c.id) || 0)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا يوجد أعراس قريبة</div>'}</div>
    <div class="card"><h3>طلبيات جاهزة للتسليم (${ready.length}) · قيد العمل (${inProg.length})</h3>${[...ready, ...inProg].length ? `<div class="tbl-wrap"><table><thead><tr><th>رقم</th><th>العريس</th><th>الحالة</th><th>المتبقي</th></tr></thead><tbody>${[...ready, ...inProg].slice(0, 12).map((i) => `<tr class="click" data-c="${i.customerId}"><td>${i.no}</td><td>${h(custName(byId(S.customers, i.customerId)))}</td><td><span class="badge ${statusClass(i.status)}">${i.status}</span></td><td>${money(invoiceRemaining(i))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا يوجد</div>'}</div>
  </div>`;
  $('#dPay').onclick = () => paymentModal();
  $$('[data-c]', main).forEach((r) => (r.onclick = () => (location.hash = '#/customer/' + r.dataset.c)));
}

// ---------- نقطة البيع ----------
function newPos(customerId) { return { editId: null, customerId: customerId || null, items: [], discount: 0, paidNow: '', method: 'نقدي', date: todayStr(), eventDate: '', dueDate: '', notes: '' }; }
function vPos(main, _id, q) {
  if (q.get('edit')) {
    const inv = byId(S.invoices, q.get('edit'));
    if (inv && (!POS || POS.editId !== inv.id)) POS = { editId: inv.id, customerId: inv.customerId, items: inv.items.map((x) => ({ ...x })), discount: inv.discount, paidNow: '', method: 'نقدي', date: inv.date, eventDate: inv.eventDate, dueDate: inv.dueDate || '', notes: inv.notes };
  } else if (q.get('c')) { if (!POS || POS.editId || POS.customerId !== q.get('c')) POS = newPos(q.get('c')); }
  else if (!POS || POS.editId) POS = newPos();
  const services = S.services.filter((s) => s.active !== false);
  const editInv = POS.editId && byId(S.invoices, POS.editId);
  main.innerHTML = topBar(editInv ? `تعديل طلبية رقم ${editInv.no}` : 'نقطة البيع', editInv ? '' : 'اختر العريس ثم اضغط على الخدمات لإضافتها',
    editInv ? `<button class="btn" id="posCancelEdit">إلغاء التعديل</button>` : `<button class="btn" id="posClear">تفريغ</button>`) + `
  <div class="pos-grid">
    <div>
      <div class="card mb"><h3>العريس</h3><div id="posPicker"></div></div>
      <div class="card"><div class="row" style="margin-bottom:12px"><h3 style="margin:0;flex:0 0 auto">الخدمات</h3><input class="in" id="svcSearch" placeholder="بحث خدمة…" style="max-width:240px"><button class="btn sm" id="customItem" style="flex:0 0 auto">+ صنف حر</button></div>
        <div class="svc-grid" id="svcGrid">${services.map((s) => `<button class="svc" data-s="${s.id}"><b>${h(s.name)}</b><span class="u">لكل ${h(s.unit)}</span><span class="p">${money(s.price)}</span></button>`).join('') || '<div class="empty">لا يوجد خدمات — أضفها من صفحة الخدمات</div>'}</div>
      </div>
    </div>
    <div class="card cart">
      <h3>الطلبية</h3>
      <div class="ci ci-h"><span>الصنف</span><span>الكمية</span><span>السعر</span><span style="text-align:left">المجموع</span><span></span></div>
      <div class="cart-items" id="cartItems"></div>
      <div class="totals" id="totals"></div>
      <div class="grid g2 mt">
        <label class="f">تاريخ الطلبية<input class="in" type="date" id="pDate" value="${POS.date}"></label>
        <label class="f">تاريخ المناسبة<input class="in" type="date" id="pEvent" value="${POS.eventDate}"></label>
        <label class="f">موعد التسليم<input class="in" type="date" id="pDue" value="${POS.dueDate}"></label>
        ${editInv ? '' : `<label class="f">طريقة الدفع<select class="in" id="pMethod">${S.methods.map((x) => `<option ${x === POS.method ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`}
        <label class="f" style="grid-column:1/-1">ملاحظات<input class="in" id="pNotes" value="${h(POS.notes)}"></label>
      </div>
      <div class="btns mt"><button class="btn pri lg" id="posSave" style="flex:1">${editInv ? 'حفظ التعديل' : 'حفظ الطلبية'}</button>${editInv ? '' : '<button class="btn lg" id="posSavePrint">حفظ وطباعة</button>'}</div>
    </div>
  </div>`;
  const drawPicker = () => {
    $('#posPicker').innerHTML = pickerHTML(POS.customerId, !editInv);
    bindPicker($('#posPicker'), (id) => {
      POS.customerId = id;
      const c = id && byId(S.customers, id);
      if (c && c.weddingDate && !POS.eventDate) { POS.eventDate = c.weddingDate; $('#pEvent').value = c.weddingDate; }
      drawPicker(); drawCart();
    });
    if (editInv) { const cb = $('[data-pk=clear]', $('#posPicker')); if (cb) cb.remove(); }
  };
  const drawCart = () => {
    $('#cartItems').innerHTML = POS.items.length ? POS.items.map((it, i) => `<div class="ci" data-i="${i}">
      <input class="in" data-f="name" value="${h(it.name)}">
      <input class="in num-in" data-f="qty" type="number" step="any" min="0" value="${it.qty}">
      <input class="in num-in" data-f="price" type="number" step="any" min="0" value="${it.price}">
      <span class="t">${fmt(it.qty * it.price)}</span><button class="x" data-del="${i}">×</button></div>`).join('') : '<div class="empty small">اضغط على خدمة لإضافتها</div>';
    $$('#cartItems .ci').forEach((row) => {
      const it = POS.items[+row.dataset.i];
      $$('[data-f]', row).forEach((inp) => (inp.oninput = () => {
        it[inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : Number(inp.value) || 0;
        $('.t', row).textContent = fmt(it.qty * it.price); drawTotals();
      }));
    });
    $$('[data-del]').forEach((b) => (b.onclick = () => { POS.items.splice(+b.dataset.del, 1); drawCart(); }));
    drawTotals();
  };
  const drawTotals = () => {
    const sub = r2(POS.items.reduce((s, i) => s + i.qty * i.price, 0));
    const total = r2(sub - (Number(POS.discount) || 0));
    const bal = POS.customerId ? balances().get(POS.customerId) || 0 : 0;
    const prevBal = editInv ? r2(bal - editInv.total) : bal;
    $('#totals').innerHTML = `
      <div class="tr"><span>المجموع</span><b>${money(sub)}</b></div>
      <div class="tr"><span>خصم</span><input class="in num-in" type="number" step="any" min="0" id="pDisc" value="${POS.discount || ''}" placeholder="0"></div>
      <div class="tr grand"><span>الإجمالي</span><span>${money(total)}</span></div>
      ${editInv ? '' : `<div class="tr"><span>المدفوع الآن</span><span class="btns"><button type="button" class="btn sm" id="payAll">الكل</button><input class="in num-in" type="number" step="any" min="0" id="pPaid" value="${POS.paidNow}" placeholder="0"></span></div>
      <div class="tr"><span>المتبقي من الطلبية</span><b class="pos">${money(total - (Number(POS.paidNow) || 0))}</b></div>`}
      ${POS.customerId ? `<div class="tr small muted"><span>رصيد العريس السابق</span><span>${money(prevBal)}</span></div>
      <div class="tr"><span>الرصيد بعد الطلبية</span><b>${money(prevBal + total - (editInv ? 0 : Number(POS.paidNow) || 0))}</b></div>` : ''}`;
    const disc = $('#pDisc');
    disc.oninput = () => { POS.discount = Number(disc.value) || 0; const p = disc.selectionStart; drawTotals(); const d2 = $('#pDisc'); d2.focus(); try { d2.setSelectionRange(p, p); } catch {} };
    const paid = $('#pPaid');
    if (paid) {
      paid.oninput = () => { POS.paidNow = paid.value; const p = paid.selectionStart; drawTotals(); const p2 = $('#pPaid'); p2.focus(); try { p2.setSelectionRange(p, p); } catch {} };
      $('#payAll').onclick = () => { POS.paidNow = String(total); drawTotals(); };
    }
  };
  const addItem = (it) => {
    const ex = POS.items.find((x) => x.serviceId && x.serviceId === it.serviceId && x.price === it.price);
    if (ex) ex.qty = r2(ex.qty + 1); else POS.items.push(it);
    drawCart();
  };
  $$('[data-s]', main).forEach((b) => (b.onclick = () => {
    const s = byId(S.services, b.dataset.s);
    if (s.unit !== 'خدمة' && s.unit !== 'قطعة') {
      const n = prompt(`كم ${s.unit}؟ (${s.name})`, '1'); if (n === null) return;
      const qty = Number(n); if (!(qty > 0)) return toast('عدد غير صحيح', true);
      const ex = POS.items.find((x) => x.serviceId === s.id);
      if (ex) { ex.qty = r2(ex.qty + qty); drawCart(); return; }
      return addItem({ serviceId: s.id, name: s.name, unit: s.unit, qty, price: s.price });
    }
    addItem({ serviceId: s.id, name: s.name, unit: s.unit, qty: 1, price: s.price });
  }));
  $('#svcSearch').oninput = (e) => { const t = e.target.value.trim(); $$('.svc', main).forEach((b) => (b.style.display = !t || b.textContent.includes(t) ? '' : 'none')); };
  $('#customItem').onclick = () => { POS.items.push({ serviceId: '', name: '', unit: '', qty: 1, price: 0 }); drawCart(); const last = $$('#cartItems [data-f=name]').pop(); last && last.focus(); };
  ['pDate:date', 'pEvent:eventDate', 'pDue:dueDate', 'pNotes:notes', 'pMethod:method'].forEach((x) => { const [id, k] = x.split(':'); const el = $('#' + id); if (el) el.oninput = el.onchange = () => (POS[k] = el.value); });
  if ($('#posClear')) $('#posClear').onclick = () => { if (!POS.items.length || confirm('تفريغ الطلبية؟')) { POS = newPos(); route(); } };
  if ($('#posCancelEdit')) $('#posCancelEdit').onclick = () => { POS = newPos(); location.hash = '#/invoices'; };
  const save = async (print) => {
    if (!POS.customerId) return toast('اختر العريس أولاً', true);
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
      if (print) printInvoice(byId(S.invoices, invId));
      location.hash = wasEdit ? '#/invoices' : '#/pos'; route();
    } catch (e) { toast(e.message, true); $('#posSave').disabled = false; }
  };
  $('#posSave').onclick = () => save(false);
  if ($('#posSavePrint')) $('#posSavePrint').onclick = () => save(true);
  drawPicker(); drawCart();
}

// ---------- العرسان ----------
function vCustomers(main) {
  const bal = balances();
  main.innerHTML = topBar('العرسان', `${S.customers.length} عريس`, `<button class="btn gold" id="addC">+ عريس جديد</button>`) + `
    <div class="filters"><label class="f" style="flex:1">بحث<input class="in" id="cq" placeholder="اسم، جوال، رقم…"></label>
      <label class="f">عرض<select class="in" id="cf"><option value="all">الكل</option><option value="debt">عليهم رصيد</option><option value="up">أعراس قادمة</option></select></label></div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th>العريس</th><th>العروس</th><th>الجوال</th><th>تاريخ العرس</th><th>الرصيد</th><th></th></tr></thead><tbody id="cBody"></tbody></table></div>`;
  const draw = () => {
    const t = $('#cq').value.trim().toLowerCase(), f = $('#cf').value, today = todayStr();
    let rows = S.customers.filter((c) => !t || [c.groom, c.bride, c.phone, c.phone2, String(c.no)].some((v) => String(v || '').toLowerCase().includes(t)));
    if (f === 'debt') rows = rows.filter((c) => (bal.get(c.id) || 0) > 0.004);
    if (f === 'up') rows = rows.filter((c) => c.weddingDate >= today).sort((a, b) => a.weddingDate.localeCompare(b.weddingDate));
    else rows.sort((a, b) => (b.no || 0) - (a.no || 0));
    $('#cBody').innerHTML = rows.map((c) => { const b = bal.get(c.id) || 0; return `<tr class="click" data-c="${c.id}"><td>${c.no || ''}</td><td><b>${h(c.groom)}</b></td><td>${h(c.bride)}</td><td class="ltr">${h(c.phone)}</td><td>${h(c.weddingDate)}</td><td class="${b > 0 ? 'pos' : b < 0 ? 'neg' : ''}">${money(b)}</td><td><a class="btn sm" href="#/pos?c=${c.id}" onclick="event.stopPropagation()">طلبية</a></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">لا يوجد عرسان بعد</td></tr>';
    $$('[data-c]', main).forEach((r) => (r.onclick = () => (location.hash = '#/customer/' + r.dataset.c)));
  };
  $('#cq').oninput = draw; $('#cf').onchange = draw; draw();
  $('#addC').onclick = () => customerModal(null, (c) => (location.hash = '#/customer/' + c.id));
}

function statementRows(cid, from, to) {
  const tx = custTx(cid);
  const before = tx.filter((t) => from && t.date < from);
  const inRange = tx.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
  const opening = r2(before.reduce((s, t) => s + t.debit - t.credit, 0));
  let run = opening;
  const rows = inRange.map((t) => { run = r2(run + t.debit - t.credit); return { ...t, balance: run }; });
  return { opening, rows, closing: run, debit: r2(inRange.reduce((s, t) => s + t.debit, 0)), credit: r2(inRange.reduce((s, t) => s + t.credit, 0)) };
}
function statementTable(st, detailed, forPrint) {
  return `<table><thead><tr><th>التاريخ</th><th>البيان</th><th>مدين (عليه)</th><th>دائن (دفع)</th><th>الرصيد</th>${forPrint ? '' : '<th></th>'}</tr></thead><tbody>
    ${st.opening ? `<tr><td></td><td><b>رصيد سابق</b></td><td></td><td></td><td>${money(st.opening)}</td>${forPrint ? '' : '<td></td>'}</tr>` : ''}
    ${st.rows.map((t) => `<tr><td>${t.date}</td><td class="wrap">${h(t.desc)}${t.kind === 'inv' && t.ref.discount ? ` <span class="muted small">(خصم ${fmt(t.ref.discount)})</span>` : ''}${t.kind === 'inv' && t.ref.notes ? `<div class="muted small">${h(t.ref.notes)}</div>` : ''}</td><td>${t.debit ? money(t.debit) : ''}</td><td>${t.credit ? money(t.credit) : ''}</td><td class="${t.balance > 0 ? 'pos' : ''}"><b>${money(t.balance)}</b></td>${forPrint ? '' : `<td>${t.kind === 'inv' ? `<button class="btn sm" data-pi="${t.ref.id}">طباعة</button>` : t.kind === 'pay' ? `<button class="btn sm" data-pr="${t.ref.id}">سند</button>` : ''}</td>`}</tr>
      ${detailed && t.kind === 'inv' ? t.ref.items.map((it) => `<tr class="sub"><td></td><td class="wrap">↳ ${h(it.name)} — <span class="num">${fmt(it.qty)}</span> × <span class="num">${fmt(it.price)}</span></td><td>${money(it.total)}</td><td></td><td></td>${forPrint ? '' : '<td></td>'}</tr>`).join('') : ''}`).join('')}
    ${!st.rows.length && !st.opening ? `<tr><td colspan="6" class="empty">لا يوجد حركات</td></tr>` : ''}
  </tbody><tfoot><tr><td></td><td>المجموع</td><td>${money(st.debit)}</td><td>${money(st.credit)}</td><td>${money(st.closing)}</td>${forPrint ? '' : '<td></td>'}</tr></tfoot></table>`;
}

function vCustomer(main, id, q) {
  const c = byId(S.customers, id);
  if (!c) { main.innerHTML = '<div class="empty">العريس غير موجود</div>'; return; }
  const bal = balances().get(c.id) || 0;
  const from = q.get('from') || '', to = q.get('to') || '', detailed = q.get('d') !== '0';
  const st = statementRows(c.id, from, to);
  const invs = S.invoices.filter((i) => i.customerId === c.id).sort((a, b) => b.no - a.no);
  const wa = waLink(c.phone, reminderText(c));
  main.innerHTML = topBar(h(custName(c)), `عريس رقم ${c.no || ''}${c.createdByName ? ' · أضافه ' + h(c.createdByName) : ''}`,
    `<a class="btn gold" href="#/pos?c=${c.id}">+ طلبية</a><button class="btn pri" id="cPay">قبض دفعة</button><button class="btn" id="cEdit">تعديل</button>${wa && bal > 0 ? `<a class="btn wa" target="_blank" href="${wa}">مطالبة واتساب</a>` : ''}${isAdmin() ? '<button class="btn danger" id="cDel">حذف</button>' : ''}`) + `
  <div class="grid g3">
    <div class="card stat ${bal > 0 ? 'gold' : ''}"><div class="l">الرصيد المستحق</div><div class="v">${money(bal)}</div></div>
    <div class="card"><div class="kv"><span>العروس</span><b>${h(c.bride || '—')}</b><span>الجوال</span><b class="num">${h(c.phone || '—')} ${c.phone2 ? ' / ' + h(c.phone2) : ''}</b><span>تاريخ العرس</span><b>${h(c.weddingDate || '—')}</b></div></div>
    <div class="card"><div class="kv"><span>العنوان</span><b>${h(c.address || '—')}</b><span>آخر دفعة</span><b>${lastPayment(c.id) || '—'}</b><span>ملاحظات</span><b>${h(c.notes || '—')}</b></div></div>
  </div>
  <div class="card mt">
    <h3>كشف الحساب</h3>
    <div class="filters">
      <label class="f">من تاريخ<input class="in" type="date" id="sFrom" value="${from}"></label>
      <label class="f">إلى تاريخ<input class="in" type="date" id="sTo" value="${to}"></label>
      <label class="switch"><input type="checkbox" id="sDet" ${detailed ? 'checked' : ''}> تفصيلي (عرض الأصناف)</label>
      <button class="btn pri" id="sPrint">طباعة الكشف</button>
    </div>
    <div class="tbl-wrap">${statementTable(st, detailed)}</div>
  </div>
  <div class="card mt"><h3>الطلبيات (${invs.length})</h3><div class="tbl-wrap"><table><thead><tr><th>رقم</th><th>التاريخ</th><th>الأصناف</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${invs.map((i) => `<tr class="${i.cancelled ? 'cancel' : ''}"><td>${i.no}</td><td>${i.date}</td><td class="wrap small">${h(i.items.map((x) => x.name).join('، '))}</td><td>${money(i.total)}</td><td>${money(invoiceRemaining(i))}</td><td>${i.cancelled ? '<span class="badge b-bad">ملغاة</span>' : `<span class="badge ${statusClass(i.status)}">${i.status}</span>`}</td><td><button class="btn sm" data-pi="${i.id}">طباعة</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا يوجد</td></tr>'}
  </tbody></table></div></div>`;
  const nav = () => { const p = new URLSearchParams(); if ($('#sFrom').value) p.set('from', $('#sFrom').value); if ($('#sTo').value) p.set('to', $('#sTo').value); if (!$('#sDet').checked) p.set('d', '0'); location.hash = `#/customer/${c.id}?${p}`; };
  $('#sFrom').onchange = nav; $('#sTo').onchange = nav; $('#sDet').onchange = nav;
  $('#sPrint').onclick = () => printStatement(c, from, to, detailed);
  $('#cPay').onclick = () => paymentModal(c.id);
  $('#cEdit').onclick = () => customerModal(c);
  if ($('#cDel')) $('#cDel').onclick = () => { if (confirm('حذف العريس نهائياً؟')) act(() => api('DELETE', 'customers/' + c.id), 'تم الحذف').then(() => (location.hash = '#/customers')).catch(() => {}); };
  $$('[data-pi]', main).forEach((b) => (b.onclick = () => printInvoice(byId(S.invoices, b.dataset.pi))));
  $$('[data-pr]', main).forEach((b) => (b.onclick = () => printReceipt(byId(S.payments, b.dataset.pr))));
}

// ---------- الطلبيات ----------
function vInvoices(main, _id, q) {
  const t = todayStr();
  main.innerHTML = topBar('الطلبيات', '', `<a class="btn gold" href="#/pos">+ طلبية جديدة</a>`) + `
  <div class="filters">
    <label class="f">من<input class="in" type="date" id="fFrom" value="${q.get('from') || addDays(t, -60)}"></label>
    <label class="f">إلى<input class="in" type="date" id="fTo" value="${q.get('to') || ''}"></label>
    <label class="f">الحالة<select class="in" id="fSt"><option value="">الكل</option>${S.statuses.map((s) => `<option>${s}</option>`).join('')}<option value="c">ملغاة</option></select></label>
    <label class="f" style="flex:1">بحث<input class="in" id="fQ" placeholder="رقم، اسم…"></label>
  </div>
  <div class="tbl-wrap"><table><thead><tr><th>رقم</th><th>التاريخ</th><th>العريس</th><th>المناسبة</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th>بواسطة</th><th></th></tr></thead><tbody id="iBody"></tbody><tfoot id="iFoot"></tfoot></table></div>`;
  const draw = () => {
    const from = $('#fFrom').value, to = $('#fTo').value, st = $('#fSt').value, qq = $('#fQ').value.trim();
    const rows = S.invoices.filter((i) => (!from || i.date >= from) && (!to || i.date <= to)
      && (st === 'c' ? i.cancelled : st ? !i.cancelled && i.status === st : true)
      && (!qq || String(i.no) === qq || custName(byId(S.customers, i.customerId)).includes(qq))).sort((a, b) => b.no - a.no);
    let tot = 0, rem = 0;
    $('#iBody').innerHTML = rows.map((i) => {
      const c = byId(S.customers, i.customerId), r = invoiceRemaining(i);
      if (!i.cancelled) { tot += i.total; rem += r; }
      return `<tr class="${i.cancelled ? 'cancel' : ''}"><td>${i.no}</td><td>${i.date}</td><td><a href="#/customer/${i.customerId}">${h(custName(c))}</a></td><td>${h(i.eventDate || '')}</td><td>${money(i.total)}</td><td class="${r > 0 ? 'pos' : ''}">${money(r)}</td>
        <td>${i.cancelled ? '<span class="badge b-bad">ملغاة</span>' : `<select class="in" style="padding:3px 6px;width:auto" data-st="${i.id}">${S.statuses.map((s) => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td>
        <td class="small muted">${h(i.createdByName || '')}</td>
        <td class="btns"><button class="btn sm" data-pi="${i.id}">طباعة</button>${!i.cancelled && (isAdmin() || i.createdBy === S.me.id) ? `<a class="btn sm" href="#/pos?edit=${i.id}">تعديل</a>` : ''}${!i.cancelled && r > 0 ? `<button class="btn sm" data-pay="${i.id}">دفعة</button>` : ''}${!i.cancelled && isAdmin() ? `<button class="btn sm danger" data-cx="${i.id}">إلغاء</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">لا يوجد طلبيات</td></tr>';
    $('#iFoot').innerHTML = `<tr><td colspan="4">${rows.length} طلبية</td><td>${money(tot)}</td><td>${money(rem)}</td><td colspan="3"></td></tr>`;
    $$('[data-st]', main).forEach((s) => (s.onchange = () => act(() => api('POST', `invoices/${s.dataset.st}/status`, { status: s.value }), 'تم تحديث الحالة').catch(() => {})));
    $$('[data-pi]', main).forEach((b) => (b.onclick = () => printInvoice(byId(S.invoices, b.dataset.pi))));
    $$('[data-pay]', main).forEach((b) => (b.onclick = () => { const i = byId(S.invoices, b.dataset.pay); paymentModal(i.customerId, i.id); }));
    $$('[data-cx]', main).forEach((b) => (b.onclick = () => { const reason = prompt('سبب إلغاء الطلبية؟'); if (reason !== null) act(() => api('POST', `invoices/${b.dataset.cx}/cancel`, { reason }), 'تم إلغاء الطلبية').catch(() => {}); }));
  };
  ['fFrom', 'fTo', 'fSt'].forEach((x) => ($('#' + x).onchange = draw)); $('#fQ').oninput = draw; draw();
}

// ---------- الدفعات ----------
function vPayments(main) {
  const t = todayStr();
  main.innerHTML = topBar('الدفعات (سندات القبض)', '', `<button class="btn gold" id="addP">+ قبض دفعة</button>`) + `
  <div class="filters">
    <label class="f">من<input class="in" type="date" id="fFrom" value="${t.slice(0, 8)}01"></label>
    <label class="f">إلى<input class="in" type="date" id="fTo" value=""></label>
    <label class="f">الطريقة<select class="in" id="fM"><option value="">الكل</option>${S.methods.map((m) => `<option>${m}</option>`).join('')}</select></label>
    <label class="f">المستخدم<select class="in" id="fU"><option value="">الكل</option>${S.users.map((u) => `<option value="${u.id}">${h(u.name)}</option>`).join('')}</select></label>
    <label class="f" style="flex:1">بحث<input class="in" id="fQ" placeholder="اسم العريس، رقم السند…"></label>
  </div>
  <div id="pSum" class="btns mb"></div>
  <div class="tbl-wrap"><table><thead><tr><th>رقم</th><th>التاريخ</th><th>العريس</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th><th>بواسطة</th><th></th></tr></thead><tbody id="pBody"></tbody></table></div>`;
  const draw = () => {
    const from = $('#fFrom').value, to = $('#fTo').value, m = $('#fM').value, u = $('#fU').value, qq = $('#fQ').value.trim();
    const rows = S.payments.filter((p) => (!from || p.date >= from) && (!to || p.date <= to) && (!m || p.method === m) && (!u || p.createdBy === u)
      && (!qq || String(p.no) === qq || custName(byId(S.customers, p.customerId)).includes(qq))).sort((a, b) => b.no - a.no);
    const live = rows.filter((p) => !p.cancelled);
    const byM = {}; live.forEach((p) => (byM[p.method] = (byM[p.method] || 0) + p.amount));
    $('#pSum').innerHTML = `<span class="badge" style="font-size:14px;padding:6px 12px">المجموع: ${money(live.reduce((s, p) => s + p.amount, 0))}</span>` + Object.entries(byM).map(([k, v]) => `<span class="badge">${k}: ${money(v)}</span>`).join('');
    $('#pBody').innerHTML = rows.map((p) => `<tr class="${p.cancelled ? 'cancel' : ''}"><td>${p.no}</td><td>${p.date}</td><td><a href="#/customer/${p.customerId}">${h(custName(byId(S.customers, p.customerId)))}</a></td><td><b>${money(p.amount)}</b></td><td>${p.method}</td><td class="wrap small">${h(p.note)}${p.cancelled ? ` <span class="badge b-bad">ملغى: ${h(p.cancelReason || '')}</span>` : ''}</td><td class="small muted">${h(p.createdByName || '')}</td>
      <td class="btns"><button class="btn sm" data-pr="${p.id}">سند</button>${!p.cancelled && isAdmin() ? `<button class="btn sm danger" data-cx="${p.id}">إلغاء</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">لا يوجد دفعات</td></tr>';
    $$('[data-pr]', main).forEach((b) => (b.onclick = () => printReceipt(byId(S.payments, b.dataset.pr))));
    $$('[data-cx]', main).forEach((b) => (b.onclick = () => { const reason = prompt('سبب إلغاء السند؟'); if (reason !== null) act(() => api('POST', `payments/${b.dataset.cx}/cancel`, { reason }), 'تم إلغاء السند').catch(() => {}); }));
  };
  ['fFrom', 'fTo', 'fM', 'fU'].forEach((x) => ($('#' + x).onchange = draw)); $('#fQ').oninput = draw; draw();
  $('#addP').onclick = () => paymentModal();
}

// ---------- أعمار الذمم ----------
const BUCKETS = [[0, 30, '0 - 30 يوم'], [31, 60, '31 - 60'], [61, 90, '61 - 90'], [91, 1e9, 'أكثر من 90']];
function agingData(asOf, basis) {
  const rows = [];
  for (const c of S.customers) {
    const { debits, extraCredit } = allocate(c.id, asOf);
    const balance = r2(debits.reduce((s, d) => s + d.remaining, 0) - extraCredit);
    if (Math.abs(balance) < 0.005) continue;
    const b = [0, 0, 0, 0];
    let oldest = '';
    for (const d of debits) if (d.remaining > 0) {
      const ref = basis === 'event' && d.kind === 'inv' && d.ref.eventDate ? d.ref.eventDate : d.date;
      const age = Math.max(0, daysBetween(ref, asOf));
      const k = BUCKETS.findIndex(([a, z]) => age >= a && age <= z);
      b[k] = r2(b[k] + d.remaining);
      if (!oldest || ref < oldest) oldest = ref;
    }
    rows.push({ c, balance, b, oldest, last: lastPayment(c.id) });
  }
  return rows.sort((x, y) => y.balance - x.balance);
}
function vAging(main, _id, q) {
  const asOf = q.get('asof') || todayStr(), basis = q.get('basis') || 'inv', show = q.get('show') || 'debt';
  let rows = agingData(asOf, basis);
  if (show === 'debt') rows = rows.filter((r) => r.balance > 0);
  if (show === 'over30') rows = rows.filter((r) => r.balance > 0 && r.b[1] + r.b[2] + r.b[3] > 0);
  const tot = [0, 0, 0, 0], total = rows.reduce((s, r) => { r.b.forEach((v, i) => (tot[i] += v)); return s + r.balance; }, 0);
  main.innerHTML = topBar('أعمار الذمم', 'المبالغ المستحقة على العرسان مقسمة حسب عمر الدين (الدفعات تُخصم من الأقدم أولاً)', `<button class="btn pri" id="aPrint">طباعة</button>`) + `
  <div class="filters">
    <label class="f">حتى تاريخ<input class="in" type="date" id="aAsOf" value="${asOf}"></label>
    <label class="f">احتساب العمر من<select class="in" id="aBasis"><option value="inv" ${basis === 'inv' ? 'selected' : ''}>تاريخ الطلبية</option><option value="event" ${basis === 'event' ? 'selected' : ''}>تاريخ المناسبة</option></select></label>
    <label class="f">عرض<select class="in" id="aShow"><option value="debt" ${show === 'debt' ? 'selected' : ''}>كل من عليه رصيد</option><option value="over30" ${show === 'over30' ? 'selected' : ''}>المتأخرين أكثر من 30 يوم</option><option value="all" ${show === 'all' ? 'selected' : ''}>الكل (مع الأرصدة الدائنة)</option></select></label>
  </div>
  <div class="grid g4 mb">${BUCKETS.map((bk, i) => `<div class="card stat ${i === 3 && tot[3] > 0 ? 'gold' : ''}"><div class="l">${bk[2]}</div><div class="v">${money(tot[i])}</div></div>`).join('')}</div>
  <div class="tbl-wrap"><table><thead><tr><th>العريس</th><th>الجوال</th><th>تاريخ العرس</th><th>الرصيد</th>${BUCKETS.map((b) => `<th>${b[2]}</th>`).join('')}<th>آخر دفعة</th><th></th></tr></thead><tbody>
    ${rows.map((r) => { const wa = waLink(r.c.phone, reminderText(r.c)); return `<tr class="click" data-c="${r.c.id}"><td><b>${h(custName(r.c))}</b></td><td class="ltr">${h(r.c.phone)}</td><td>${h(r.c.weddingDate)}</td><td class="${r.balance > 0 ? 'pos' : 'neg'}"><b>${money(r.balance)}</b></td>${r.b.map((v, i) => `<td class="${v > 0 && i >= 2 ? 'pos' : ''}">${v ? money(v) : '—'}</td>`).join('')}<td>${r.last || '<span class="muted">لا يوجد</span>'}</td><td>${wa && r.balance > 0 ? `<a class="btn sm wa" target="_blank" href="${wa}" onclick="event.stopPropagation()">مطالبة</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">لا يوجد ذمم 🎉</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">${rows.length} عريس</td><td>${money(total)}</td>${tot.map((v) => `<td>${money(v)}</td>`).join('')}<td colspan="2"></td></tr></tfoot></table></div>`;
  const nav = () => (location.hash = `#/aging?asof=${$('#aAsOf').value}&basis=${$('#aBasis').value}&show=${$('#aShow').value}`);
  ['aAsOf', 'aBasis', 'aShow'].forEach((x) => ($('#' + x).onchange = nav));
  $$('[data-c]', main).forEach((r) => (r.onclick = () => (location.hash = '#/customer/' + r.dataset.c)));
  $('#aPrint').onclick = () => printAging(rows, tot, total, asOf, basis);
}

// ---------- الخدمات ----------
function vServices(main) {
  if (!isAdmin()) return vDashboard(main);
  main.innerHTML = topBar('الخدمات والأسعار', 'هذه الأسعار الافتراضية — يمكن تغيير السعر داخل كل طلبية', `<button class="btn gold" id="addS">+ خدمة جديدة</button>`) + `
  <div class="tbl-wrap"><table><thead><tr><th>اسم الخدمة</th><th>السعر</th><th>الوحدة</th><th>فعالة</th><th></th></tr></thead><tbody>
  ${S.services.map((s) => `<tr data-s="${s.id}"><td><input class="in" data-f="name" value="${h(s.name)}"></td><td><input class="in num-in" style="width:120px" type="number" step="any" data-f="price" value="${s.price}"></td>
    <td><input class="in" style="width:110px" data-f="unit" value="${h(s.unit)}" list="units"></td><td><input type="checkbox" data-f="active" ${s.active !== false ? 'checked' : ''}></td>
    <td class="btns"><button class="btn sm pri" data-save>حفظ</button><button class="btn sm danger" data-del>حذف</button></td></tr>`).join('')}
  </tbody></table></div>
  <datalist id="units"><option>خدمة</option><option>صورة</option><option>قطعة</option><option>ساعة</option><option>ألبوم</option></datalist>
  <p class="muted small">ملاحظة: الوحدة "خدمة" أو "قطعة" تُضاف بكمية 1 مباشرة، وأي وحدة أخرى (مثل "صورة") يسألك البرنامج عن العدد.</p>`;
  const val = (tr) => ({ name: $('[data-f=name]', tr).value, price: $('[data-f=price]', tr).value, unit: $('[data-f=unit]', tr).value, active: $('[data-f=active]', tr).checked });
  $$('[data-s]', main).forEach((tr) => {
    $('[data-save]', tr).onclick = () => act(() => api('PUT', 'services/' + tr.dataset.s, val(tr)), 'تم الحفظ').catch(() => {});
    $('[data-del]', tr).onclick = () => { if (confirm('حذف الخدمة؟ (الطلبيات القديمة لا تتأثر)')) act(() => api('DELETE', 'services/' + tr.dataset.s), 'تم الحذف').catch(() => {}); };
  });
  $('#addS').onclick = () => {
    const m = modal('خدمة جديدة', `<label class="f">اسم الخدمة<input class="in" id="nsName"></label><div class="grid g2"><label class="f">السعر<input class="in num-in" type="number" step="any" id="nsPrice"></label><label class="f">الوحدة<input class="in" id="nsUnit" value="خدمة" list="units"></label></div>`, `<button class="btn pri" id="nsSave">إضافة</button><button class="btn" data-close>إلغاء</button>`);
    $('#nsSave').onclick = () => act(() => api('POST', 'services', { name: $('#nsName').value, price: $('#nsPrice').value, unit: $('#nsUnit').value }), 'تمت الإضافة').then(m.close).catch(() => {});
  };
}

// ---------- المستخدمين ----------
function vUsers(main) {
  if (!isAdmin()) return vDashboard(main);
  main.innerHTML = topBar('المستخدمين', 'الموظف: يضيف عرسان وطلبيات ودفعات ويرى الكشوفات. المدير: كل شيء + إلغاء وتعديل الأسعار والإعدادات.', `<button class="btn gold" id="addU">+ مستخدم</button>`) + `
  <div class="tbl-wrap"><table><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${S.users.map((u) => `<tr><td><b>${h(u.name)}</b></td><td class="ltr">${h(u.username)}</td><td>${u.role === 'admin' ? '<span class="badge b-ready">مدير</span>' : '<span class="badge">موظف</span>'}</td><td>${u.active ? '<span class="badge b-done">فعال</span>' : '<span class="badge b-bad">موقوف</span>'}</td><td><button class="btn sm" data-u="${u.id}">تعديل</button></td></tr>`).join('')}
  </tbody></table></div>`;
  const form = (u) => {
    u = u || { role: 'staff', active: true };
    const m = modal(u.id ? 'تعديل مستخدم' : 'مستخدم جديد', `
      <label class="f">الاسم<input class="in" id="uName" value="${h(u.name || '')}"></label>
      ${u.id ? '' : '<label class="f">اسم الدخول (إنجليزي)<input class="in" id="uUser" dir="ltr"></label>'}
      <label class="f">${u.id ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور'}<input class="in" id="uPass" dir="ltr"></label>
      <div class="grid g2"><label class="f">الصلاحية<select class="in" id="uRole"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>موظف</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>مدير</option></select></label>
      ${u.id ? `<label class="f">الحالة<select class="in" id="uAct"><option value="1">فعال</option><option value="0" ${u.active ? '' : 'selected'}>موقوف</option></select></label>` : ''}</div>`,
      `<button class="btn pri" id="uSave">حفظ</button><button class="btn" data-close>إلغاء</button>`);
    $('#uSave').onclick = () => {
      const body = { name: $('#uName').value, password: $('#uPass').value, role: $('#uRole').value };
      const p = u.id ? api('PUT', 'users/' + u.id, { ...body, active: $('#uAct').value === '1' }) : api('POST', 'users', { ...body, username: $('#uUser').value });
      act(() => p, 'تم الحفظ').then(m.close).catch(() => {});
    };
  };
  $('#addU').onclick = () => form();
  $$('[data-u]', main).forEach((b) => (b.onclick = () => form(byId(S.users, b.dataset.u))));
}

// ---------- الإعدادات ----------
function vSettings(main) {
  const s = S.settings;
  main.innerHTML = topBar(isAdmin() ? 'الإعدادات' : 'حسابي', '') + `
  ${isAdmin() ? `<div class="card mb"><h3>بيانات الاستوديو (تظهر على الفواتير والكشوفات)</h3>
    <div class="grid g2">
      <label class="f">اسم الاستوديو<input class="in" id="sName" value="${h(s.studioName)}"></label>
      <label class="f">وصف قصير<input class="in" id="sSub" value="${h(s.subtitle)}"></label>
      <label class="f">الهاتف<input class="in" id="sPhone" value="${h(s.phone)}"></label>
      <label class="f">العنوان<input class="in" id="sAddr" value="${h(s.address)}"></label>
      <label class="f">رمز العملة<input class="in" id="sCur" value="${h(s.currency)}"></label>
      <label class="f">نص أسفل الفاتورة<input class="in" id="sFoot" value="${h(s.invoiceFooter)}"></label>
      <label class="f">الشعار<input type="file" accept="image/*" id="sLogo" class="in"></label>
      <div>${s.logo ? `<img src="${h(s.logo)}" style="max-height:70px;border-radius:8px"> <button class="btn sm danger" id="sLogoDel">إزالة الشعار</button>` : '<span class="muted small">لا يوجد شعار</span>'}</div>
    </div><div class="btns mt"><button class="btn pri" id="sSave">حفظ</button></div></div>` : ''}
  <div class="card mb"><h3>تغيير كلمة المرور (${h(S.me.name)})</h3>
    <div class="row"><label class="f">كلمة المرور الحالية<input class="in" type="password" id="pOld" dir="ltr"></label><label class="f">الجديدة<input class="in" type="password" id="pNew" dir="ltr"></label><button class="btn pri" id="pSave" style="flex:0 0 auto">تغيير</button></div></div>
  ${isAdmin() ? `<div class="card"><h3>النسخ الاحتياطي</h3>
    <p class="muted small">البرنامج يحفظ نسخة يومية تلقائياً على السيرفر. ويمكنك أيضاً تنزيل نسخة على جهازك.</p>
    <div class="btns"><a class="btn pri" href="/api/backup">تنزيل نسخة احتياطية</a><label class="btn">استرجاع من نسخة…<input type="file" accept=".json" id="restore" hidden></label></div></div>` : ''}`;
  let logo = s.logo || '';
  if (isAdmin()) {
    $('#sLogo').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image(); img.onload = () => {
        const k = Math.min(1, 320 / Math.max(img.width, img.height)); const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        logo = cv.toDataURL('image/png'); toast('تم تجهيز الشعار — اضغط حفظ');
      }; img.src = URL.createObjectURL(f);
    };
    if ($('#sLogoDel')) $('#sLogoDel').onclick = () => { logo = ''; act(() => api('PUT', 'settings', { ...collect(), logo: '' }), 'تمت إزالة الشعار').then(start).catch(() => {}); };
    const collect = () => ({ studioName: $('#sName').value, subtitle: $('#sSub').value, phone: $('#sPhone').value, address: $('#sAddr').value, currency: $('#sCur').value, invoiceFooter: $('#sFoot').value, logo });
    $('#sSave').onclick = () => act(() => api('PUT', 'settings', collect()), 'تم الحفظ').then(start).catch(() => {});
    $('#restore').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المختارة (يُحفظ نسخة من الحالي على السيرفر قبل الاستبدال). متابعة؟')) return;
      try { const data = JSON.parse(await f.text()); await api('POST', 'restore', data); toast('تم الاسترجاع'); await start(); } catch (err) { toast(err.message, true); }
    };
  }
  $('#pSave').onclick = () => act(() => api('POST', 'me/password', { oldPassword: $('#pOld').value, newPassword: $('#pNew').value }), 'تم تغيير كلمة المرور').catch(() => {});
}

// ---------- الطباعة ----------
function docHead(title) {
  const s = S.settings;
  return `<div class="dh"><div><h1>${h(s.studioName)}</h1><div>${h(s.subtitle || '')}</div><div>${h(s.phone || '')} ${s.address ? ' · ' + h(s.address) : ''}</div></div>${s.logo ? `<img src="${h(s.logo)}">` : ''}</div><div class="dt">${title}</div>`;
}
function doPrint(html) {
  $('#print-area').innerHTML = `<div class="doc">${html}<div class="foot"><span>${h(S.settings.invoiceFooter || '')}</span><span>طُبع بواسطة ${h(S.me.name)} — ${new Date().toLocaleString('en-GB')}</span></div></div>`;
  const imgs = $$('#print-area img');
  Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))).then(() => setTimeout(() => window.print(), 50));
}
function printInvoice(inv) {
  if (!inv) return;
  const c = byId(S.customers, inv.customerId);
  const paidOn = S.payments.filter((p) => p.invoiceId === inv.id && !p.cancelled).reduce((s, p) => s + p.amount, 0);
  const bal = balances().get(c.id) || 0;
  doPrint(docHead(`فاتورة / طلبية رقم ${inv.no}${inv.cancelled ? ' (ملغاة)' : ''}`) + `
    <div class="meta"><div>العريس: <b>${h(custName(c))}</b></div><div>التاريخ: <b class="num">${inv.date}</b></div>
    <div>الجوال: <b class="num">${h(c.phone || '')}</b></div><div>تاريخ المناسبة: <b class="num">${h(inv.eventDate || '—')}</b></div>
    ${inv.dueDate ? `<div>موعد التسليم: <b>${inv.dueDate}</b></div>` : ''}</div>
    <table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>
    ${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td>${h(it.name)}</td><td>${fmt(it.qty)} ${h(it.unit && it.unit !== 'خدمة' ? it.unit : '')}</td><td>${money(it.price)}</td><td>${money(it.total)}</td></tr>`).join('')}
    </tbody></table>
    <table class="sum"><tr><td>المجموع</td><td>${money(inv.subtotal)}</td></tr>${inv.discount ? `<tr><td>الخصم</td><td>${money(inv.discount)}</td></tr>` : ''}<tr><td>الإجمالي</td><td><b>${money(inv.total)}</b></td></tr>
    ${paidOn ? `<tr><td>المدفوع على هذه الطلبية</td><td>${money(paidOn)}</td></tr>` : ''}<tr><td>إجمالي الرصيد المستحق على الحساب</td><td><b>${money(bal)}</b></td></tr></table>
    ${inv.notes ? `<p>ملاحظات: ${h(inv.notes)}</p>` : ''}
    <div class="sign"><div>توقيع العريس</div><div>${h(S.settings.studioName)}</div></div>`);
}
function printReceipt(p) {
  if (!p) return;
  const c = byId(S.customers, p.customerId);
  const inv = p.invoiceId && byId(S.invoices, p.invoiceId);
  doPrint(docHead(`سند قبض رقم ${p.no}${p.cancelled ? ' (ملغى)' : ''}`) + `
    <div class="meta"><div>التاريخ: <b class="num">${p.date}</b></div><div>طريقة الدفع: <b>${h(p.method)}</b></div></div>
    <p style="font-size:15px;line-height:2.2">استلمنا من السيد/ <b>${h(custName(c))}</b><br>مبلغاً وقدره: <b style="font-size:20px">${money(p.amount)}</b><br>
    وذلك عن: <b>${h(p.note || (inv ? 'دفعة على طلبية رقم ' + inv.no : 'دفعة على الحساب'))}</b></p>
    <table class="sum"><tr><td>الرصيد المتبقي على الحساب</td><td><b>${money(balanceOf(c.id))}</b></td></tr></table>
    <div class="sign"><div>المستلم: ${h(p.createdByName || '')}</div><div>التوقيع</div></div>`);
}
function printStatement(c, from, to, detailed) {
  const st = statementRows(c.id, from, to);
  doPrint(docHead(`كشف حساب ${detailed ? 'تفصيلي' : ''}`) + `
    <div class="meta"><div>العريس: <b>${h(custName(c))}</b></div><div>الفترة: <b>${from ? `<span class="num">${from}</span>` : 'من البداية'} — <span class="num">${to || todayStr()}</span></b></div>
    <div>الجوال: <b class="num">${h(c.phone || '')}</b></div><div>تاريخ العرس: <b class="num">${h(c.weddingDate || '—')}</b></div></div>
    ${statementTable(st, detailed, true)}
    <table class="sum"><tr><td>الرصيد المستحق</td><td><b>${money(st.closing)}</b></td></tr></table>`);
}
function printAging(rows, tot, total, asOf, basis) {
  doPrint(docHead(`تقرير أعمار الذمم حتى ${asOf}`) + `<p class="small">العمر محسوب من ${basis === 'event' ? 'تاريخ المناسبة' : 'تاريخ الطلبية'}</p>
    <table><thead><tr><th>العريس</th><th>الجوال</th><th>الرصيد</th>${BUCKETS.map((b) => `<th>${b[2]}</th>`).join('')}<th>آخر دفعة</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${h(custName(r.c))}</td><td class="ltr">${h(r.c.phone)}</td><td><b>${money(r.balance)}</b></td>${r.b.map((v) => `<td>${v ? money(v) : '—'}</td>`).join('')}<td>${r.last || '—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2">المجموع (${rows.length})</td><td>${money(total)}</td>${tot.map((v) => `<td>${money(v)}</td>`).join('')}<td></td></tr></tfoot></table>`);
}

// ---------- تشغيل ----------
async function start() {
  try { await load(); } catch { return renderLogin(); }
  renderShell(); route();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
start();
