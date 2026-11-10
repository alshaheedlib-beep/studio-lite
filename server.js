// Studio Lite — برنامج محاسبة لايت للاستوديوهات
// بدون أي مكتبات خارجية: يحتاج Node.js 18 أو أحدث فقط
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3100', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SESSION_DAYS = 30;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------- أدوات ----------
const uid = () => crypto.randomBytes(8).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, user) {
  if (!user || !user.salt) return false;
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

let SECRET;
if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

function signToken(userId, ver) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${userId}.${ver}.${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userId, ver, exp, sig] = parts;
  const expect = crypto.createHmac('sha256', SECRET).update(`${userId}.${ver}.${exp}`).digest('hex');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (Date.now() > Number(exp)) return null;
  const user = db.users.find((u) => u.id === userId && u.active !== false);
  if (!user || String(user.tokenVer || 0) !== ver) return null;
  return user;
}

// ---------- قاعدة البيانات (ملف JSON) ----------
function seed() {
  const mk = (name, username, role, pass) => {
    const { salt, hash } = hashPassword(pass);
    return { id: uid(), name, username, role, salt, hash, active: true, tokenVer: 0 };
  };
  const sv = (name, price, unit) => ({ id: uid(), name, price, unit, active: true });
  return {
    version: 1,
    settings: {
      studioName: process.env.STUDIO_NAME || 'استوديو',
      subtitle: 'استوديو تصوير',
      phone: '', address: '', currency: '₪',
      invoiceFooter: 'شكراً لاختياركم — ألف مبروك',
    },
    // SEED_STAFF مثال: "محمد:mohammad,احمد:ahmad,محمود:mahmoud" — كلمة المرور الأولى 1234
    users: [
      mk('المدير', 'admin', 'admin', process.env.ADMIN_PASSWORD || 'admin123'),
      ...String(process.env.SEED_STAFF || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
        const [name, username] = x.split(':');
        return mk(name.trim(), (username || name).trim().toLowerCase(), 'staff', '1234');
      }),
    ],
    services: [
      sv('تصوير حفلة العرسان', 2500, 'خدمة'),
      sv('تصوير حديقة', 300, 'خدمة'),
      sv('تصوير الغداء', 350, 'خدمة'),
      sv('تصوير زفة السيارات', 300, 'خدمة'),
      sv('تصوير حفلة الشباب', 500, 'خدمة'),
      sv('تصوير المباركة', 500, 'خدمة'),
      sv('طباعة صور', 1, 'صورة'),
      sv('طباعة فوم', 100, 'قطعة'),
      sv('طباعة زجاج 50×70', 150, 'قطعة'),
      sv('طباعة صورة خشب', 120, 'قطعة'),
    ],
    customers: [],
    invoices: [],
    payments: [],
    counters: { invoice: 0, payment: 0, customer: 0 },
  };
}

let db;
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
  db = seed();
  save();
  console.log('تم إنشاء قاعدة بيانات جديدة. دخول المدير: admin / ' + (process.env.ADMIN_PASSWORD ? '(من ADMIN_PASSWORD)' : 'admin123'));
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  dailyBackup();
}
function dailyBackup() {
  const f = path.join(BACKUP_DIR, `db-${today()}.json`);
  if (fs.existsSync(f)) return;
  fs.copyFileSync(DB_FILE, f);
  const files = fs.readdirSync(BACKUP_DIR).filter((x) => x.startsWith('db-')).sort();
  while (files.length > 60) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
}

// ---------- HTTP ----------
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
const fail = (res, status, msg) => send(res, status, { error: msg });

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active !== false });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/manifest.webmanifest') {
    const name = db.settings.studioName || 'Studio';
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({
      name, short_name: name.slice(0, 12), lang: 'ar', dir: 'rtl', start_url: '/', scope: '/', display: 'standalone',
      background_color: '#f2f4f1', theme_color: '#1d3557',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    }));
  }
  if (p === '/' || !path.extname(p)) p = '/index.html';
  if (p === '/index.html') {
    return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
      if (err) return fail(res, 500, 'error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html.replace(/\{\{STUDIO_NAME\}\}/g, escHtml(db.settings.studioName || 'Studio')));
    });
  }
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return fail(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// محاولات الدخول
const loginAttempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const a = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
  loginAttempts.set(ip, a);
  return a.length >= 10;
}

// ---------- التحقق من البيانات ----------
function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('الفاتورة بدون أصناف');
  return items.slice(0, 200).map((it) => {
    const qty = round2(it.qty);
    const price = round2(it.price);
    const name = str(it.name, 150);
    if (!name) throw new Error('اسم الصنف مطلوب');
    if (!(qty > 0)) throw new Error('الكمية غير صحيحة: ' + name);
    if (price < 0) throw new Error('السعر غير صحيح: ' + name);
    return { serviceId: str(it.serviceId, 40), name, unit: str(it.unit, 20), qty, price, total: round2(qty * price) };
  });
}
function cleanCustomer(b, existing = {}) {
  const groom = str(b.groom, 120);
  if (!groom) throw new Error('اسم العريس مطلوب');
  return {
    ...existing,
    groom,
    bride: str(b.bride, 120),
    phone: str(b.phone, 30),
    phone2: str(b.phone2, 30),
    weddingDate: isDate(b.weddingDate) ? b.weddingDate : '',
    address: str(b.address, 200),
    notes: str(b.notes, 1000),
    openingBalance: round2(b.openingBalance),
  };
}
const METHODS = ['نقدي', 'تحويل بنكي', 'شيك', 'تطبيق دفع'];
const STATUSES = ['جديدة', 'قيد التنفيذ', 'جاهزة', 'تم التسليم'];

// ---------- المسارات ----------
async function api(req, res, url) {
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;

  if (resource === 'login' && method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (tooMany(ip)) return fail(res, 429, 'محاولات كثيرة، حاول بعد ربع ساعة');
    const b = await readBody(req);
    const user = db.users.find((u) => u.username.toLowerCase() === str(b.username, 60).toLowerCase() && u.active !== false);
    if (!user || !checkPassword(b.password || '', user)) {
      loginAttempts.get(ip).push(Date.now());
      return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    const token = signToken(user.id, user.tokenVer || 0);
    const secure = (req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': `sl_token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure}` });
  }
  if (resource === 'logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sl_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
  }
  if (resource === 'public-settings') {
    return send(res, 200, { studioName: db.settings.studioName, subtitle: db.settings.subtitle });
  }

  const me = verifyToken(getCookie(req, 'sl_token'));
  if (!me) return fail(res, 401, 'يجب تسجيل الدخول');
  const isAdmin = me.role === 'admin';
  const adminOnly = () => { if (!isAdmin) { fail(res, 403, 'هذه العملية للمدير فقط'); return false; } return true; };
  const stamp = { createdBy: me.id, createdByName: me.name, createdAt: nowIso() };

  // كل البيانات دفعة واحدة (نسخة لايت — البيانات صغيرة)
  if (resource === 'state' && method === 'GET') {
    return send(res, 200, {
      me: publicUser(me),
      settings: db.settings,
      users: db.users.map(publicUser),
      services: db.services,
      customers: db.customers,
      invoices: db.invoices,
      payments: db.payments,
      methods: METHODS,
      statuses: STATUSES,
      serverDate: today(),
    });
  }

  if (resource === 'me' && id === 'password' && method === 'POST') {
    const b = await readBody(req);
    if (!checkPassword(b.oldPassword || '', me)) return fail(res, 400, 'كلمة المرور الحالية غير صحيحة');
    if (str(b.newPassword, 100).length < 4) return fail(res, 400, 'كلمة المرور الجديدة قصيرة (4 أحرف على الأقل)');
    Object.assign(me, hashPassword(b.newPassword));
    save();
    return send(res, 200, { ok: true });
  }

  // ---- العرسان (الزبائن) ----
  if (resource === 'customers') {
    const b = method === 'GET' ? {} : await readBody(req);
    if (method === 'POST' && !id) {
      const c = cleanCustomer(b);
      const dup = db.customers.find((x) => x.phone && c.phone && x.phone === c.phone);
      if (dup && !b.force) return fail(res, 409, `رقم الجوال مسجل مسبقاً للعريس: ${dup.groom}`);
      db.counters.customer = (db.counters.customer || 0) + 1;
      const rec = { id: uid(), no: db.counters.customer, ...c, ...stamp };
      db.customers.push(rec); save();
      return send(res, 200, rec);
    }
    const c = db.customers.find((x) => x.id === id);
    if (!c) return fail(res, 404, 'العريس غير موجود');
    if (method === 'PUT') {
      Object.assign(c, cleanCustomer(b, c), { updatedAt: nowIso(), updatedByName: me.name });
      save(); return send(res, 200, c);
    }
    if (method === 'DELETE') {
      if (!adminOnly()) return;
      const used = db.invoices.some((i) => i.customerId === id) || db.payments.some((p) => p.customerId === id);
      if (used) return fail(res, 400, 'لا يمكن حذف عريس عليه حركات. ألغِ حركاته أولاً.');
      db.customers = db.customers.filter((x) => x.id !== id); save();
      return send(res, 200, { ok: true });
    }
  }

  // ---- الطلبيات / الفواتير ----
  if (resource === 'invoices') {
    const b = method === 'GET' ? {} : await readBody(req);
    if (method === 'POST' && !id) {
      const customer = db.customers.find((x) => x.id === b.customerId);
      if (!customer) throw new Error('اختر العريس أولاً');
      const items = cleanItems(b.items);
      const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
      const discount = Math.min(Math.max(round2(b.discount), 0), subtotal);
      const total = round2(subtotal - discount);
      db.counters.invoice += 1;
      const inv = {
        id: uid(), no: db.counters.invoice, customerId: customer.id,
        date: isDate(b.date) ? b.date : today(),
        eventDate: isDate(b.eventDate) ? b.eventDate : (customer.weddingDate || ''),
        dueDate: isDate(b.dueDate) ? b.dueDate : '',
        items, subtotal, discount, total,
        notes: str(b.notes, 1000), status: STATUSES.includes(b.status) ? b.status : 'جديدة',
        cancelled: false, ...stamp,
      };
      db.invoices.push(inv);
      let payment = null;
      const paid = round2(b.paidNow);
      if (paid > 0) {
        db.counters.payment += 1;
        payment = { id: uid(), no: db.counters.payment, customerId: customer.id, invoiceId: inv.id, date: inv.date, amount: paid, method: METHODS.includes(b.method) ? b.method : 'نقدي', note: `دفعة على طلبية رقم ${inv.no}`, cancelled: false, ...stamp };
        db.payments.push(payment);
      }
      save();
      return send(res, 200, { invoice: inv, payment });
    }
    const inv = db.invoices.find((x) => x.id === id);
    if (!inv) return fail(res, 404, 'الطلبية غير موجودة');
    if (method === 'POST' && action === 'status') {
      if (!STATUSES.includes(b.status)) return fail(res, 400, 'حالة غير صحيحة');
      inv.status = b.status; inv.updatedAt = nowIso(); inv.updatedByName = me.name;
      save(); return send(res, 200, inv);
    }
    if (method === 'PUT') {
      if (inv.cancelled) return fail(res, 400, 'الطلبية ملغاة');
      if (!isAdmin && inv.createdBy !== me.id) return fail(res, 403, 'تعديل طلبيات الآخرين للمدير فقط');
      const items = cleanItems(b.items);
      const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
      const discount = Math.min(Math.max(round2(b.discount), 0), subtotal);
      Object.assign(inv, {
        items, subtotal, discount, total: round2(subtotal - discount),
        date: isDate(b.date) ? b.date : inv.date,
        eventDate: isDate(b.eventDate) ? b.eventDate : inv.eventDate,
        dueDate: isDate(b.dueDate) ? b.dueDate : '',
        notes: str(b.notes, 1000), updatedAt: nowIso(), updatedByName: me.name,
      });
      save(); return send(res, 200, inv);
    }
    if (method === 'POST' && action === 'cancel') {
      if (!adminOnly()) return;
      inv.cancelled = true; inv.cancelReason = str(b.reason, 300); inv.cancelledAt = nowIso(); inv.cancelledByName = me.name;
      save(); return send(res, 200, inv);
    }
  }

  // ---- الدفعات (سندات القبض) ----
  if (resource === 'payments') {
    const b = method === 'GET' ? {} : await readBody(req);
    if (method === 'POST' && !id) {
      const customer = db.customers.find((x) => x.id === b.customerId);
      if (!customer) throw new Error('اختر العريس أولاً');
      const amount = round2(b.amount);
      if (!(amount > 0)) throw new Error('المبلغ غير صحيح');
      db.counters.payment += 1;
      const p = {
        id: uid(), no: db.counters.payment, customerId: customer.id,
        invoiceId: db.invoices.some((i) => i.id === b.invoiceId) ? b.invoiceId : '',
        date: isDate(b.date) ? b.date : today(), amount,
        method: METHODS.includes(b.method) ? b.method : 'نقدي',
        note: str(b.note, 500), cancelled: false, ...stamp,
      };
      db.payments.push(p); save();
      return send(res, 200, p);
    }
    const p = db.payments.find((x) => x.id === id);
    if (!p) return fail(res, 404, 'الدفعة غير موجودة');
    if (method === 'POST' && action === 'cancel') {
      if (!adminOnly()) return;
      p.cancelled = true; p.cancelReason = str(b.reason, 300); p.cancelledAt = nowIso(); p.cancelledByName = me.name;
      save(); return send(res, 200, p);
    }
  }

  // ---- الخدمات ----
  if (resource === 'services') {
    if (!adminOnly()) return;
    const b = method === 'GET' ? {} : await readBody(req);
    const clean = (x) => {
      const name = str(x.name, 150);
      if (!name) throw new Error('اسم الخدمة مطلوب');
      return { name, price: Math.max(0, round2(x.price)), unit: str(x.unit, 20) || 'خدمة', active: x.active !== false };
    };
    if (method === 'POST' && !id) { const s = { id: uid(), ...clean(b) }; db.services.push(s); save(); return send(res, 200, s); }
    const s = db.services.find((x) => x.id === id);
    if (!s) return fail(res, 404, 'الخدمة غير موجودة');
    if (method === 'PUT') { Object.assign(s, clean(b)); save(); return send(res, 200, s); }
    if (method === 'DELETE') { db.services = db.services.filter((x) => x.id !== id); save(); return send(res, 200, { ok: true }); }
  }

  // ---- المستخدمين ----
  if (resource === 'users') {
    if (!adminOnly()) return;
    const b = method === 'GET' ? {} : await readBody(req);
    if (method === 'POST' && !id) {
      const username = str(b.username, 60).toLowerCase();
      if (!/^[a-z0-9_.-]{3,}$/.test(username)) throw new Error('اسم الدخول بالإنجليزي (3 أحرف أو أكثر)');
      if (db.users.some((u) => u.username === username)) throw new Error('اسم الدخول مستخدم');
      if (str(b.password, 100).length < 4) throw new Error('كلمة المرور 4 أحرف على الأقل');
      const u = { id: uid(), name: str(b.name, 60) || username, username, role: b.role === 'admin' ? 'admin' : 'staff', active: true, tokenVer: 0, ...hashPassword(b.password) };
      db.users.push(u); save(); return send(res, 200, publicUser(u));
    }
    const u = db.users.find((x) => x.id === id);
    if (!u) return fail(res, 404, 'المستخدم غير موجود');
    if (method === 'PUT') {
      const role = b.role === 'admin' ? 'admin' : 'staff';
      const active = b.active !== false;
      if (u.id === me.id && (role !== 'admin' || !active)) throw new Error('لا يمكنك إزالة صلاحية المدير عن نفسك');
      u.name = str(b.name, 60) || u.name; u.role = role;
      if (u.active !== active) u.tokenVer = (u.tokenVer || 0) + 1;
      u.active = active;
      if (b.password) {
        if (str(b.password, 100).length < 4) throw new Error('كلمة المرور 4 أحرف على الأقل');
        Object.assign(u, hashPassword(b.password)); u.tokenVer = (u.tokenVer || 0) + 1;
      }
      save(); return send(res, 200, publicUser(u));
    }
  }

  // ---- الإعدادات ----
  if (resource === 'settings' && method === 'PUT') {
    if (!adminOnly()) return;
    const b = await readBody(req);
    const s = db.settings;
    s.studioName = str(b.studioName, 80) || s.studioName;
    s.subtitle = str(b.subtitle, 120);
    s.phone = str(b.phone, 60);
    s.address = str(b.address, 200);
    s.currency = str(b.currency, 5) || '₪';
    s.invoiceFooter = str(b.invoiceFooter, 300);
    if (typeof b.logo === 'string' && (b.logo === '' || b.logo.startsWith('data:image/')) && b.logo.length < 400000) s.logo = b.logo;
    save(); return send(res, 200, s);
  }

  // ---- النسخ الاحتياطي ----
  if (resource === 'backup' && method === 'GET') {
    if (!adminOnly()) return;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="studio-backup-${today()}.json"` });
    return res.end(JSON.stringify(db));
  }
  if (resource === 'restore' && method === 'POST') {
    if (!adminOnly()) return;
    const b = await readBody(req);
    if (!b || !Array.isArray(b.users) || !Array.isArray(b.customers) || !Array.isArray(b.invoices) || !Array.isArray(b.payments) || !b.settings) throw new Error('ملف النسخة غير صالح');
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `before-restore-${Date.now()}.json`));
    db = b; db.counters = db.counters || { invoice: 0, payment: 0, customer: 0 };
    save(); return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'غير موجود');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res);
  } catch (e) {
    if (!res.headersSent) fail(res, 400, e.message || 'خطأ');
  }
});
server.listen(PORT, HOST, () => console.log(`Studio Lite يعمل على http://${HOST}:${PORT}  (البيانات: ${DATA_DIR})`));
