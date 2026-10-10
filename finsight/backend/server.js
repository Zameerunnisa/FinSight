// FinSight backend: a small Express API that stores data in Cloud Firestore.
// Local testing without Google Cloud:  USE_MEMORY=1 node server.js
const express = require('express');
const path = require('path');

const USE_MEMORY = process.env.USE_MEMORY === '1';
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1'; // Nginx talks to us on localhost only
const PREFIX = 'finsight_';

let db = null;
if (!USE_MEMORY) {
  const { Firestore } = require('@google-cloud/firestore');
  db = new Firestore(); // uses the VM's service account automatically
}

// ---------- storage layer (Firestore, or memory for local testing) ----------
const mem = { transactions: {}, scheduled: {}, scenarios: {}, settings: { openingBalance: 0, reserve: 0 } };
let counter = 0;

async function listAll(col) {
  if (USE_MEMORY) return Object.entries(mem[col]).map(([id, v]) => ({ id, ...v }));
  const snap = await db.collection(PREFIX + col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function addDoc(col, data) {
  if (USE_MEMORY) {
    const id = 'm' + ++counter;
    mem[col][id] = data;
    return { id, ...data };
  }
  const ref = await db.collection(PREFIX + col).add(data);
  return { id: ref.id, ...data };
}
async function deleteDoc(col, id) {
  if (USE_MEMORY) { delete mem[col][id]; return; }
  await db.collection(PREFIX + col).doc(id).delete();
}
async function clearAll(col) {
  const docs = await listAll(col);
  for (const d of docs) await deleteDoc(col, d.id);
}
async function getSettings() {
  if (USE_MEMORY) return mem.settings;
  const d = await db.collection(PREFIX + 'settings').doc('demo').get();
  return d.exists ? d.data() : { openingBalance: 0, reserve: 0 };
}
async function saveSettings(s) {
  if (USE_MEMORY) { mem.settings = s; return s; }
  await db.collection(PREFIX + 'settings').doc('demo').set(s);
  return s;
}

// ---------- validation ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
function money(v, name, allowZero) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9 || (!allowZero && n === 0)) throw bad(name + ' must be a valid amount');
  return n;
}
function text(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function dateStr(v) { if (!DATE_RE.test(v)) throw bad('date must be YYYY-MM-DD'); return v; }

function cleanTx(b) {
  if (!['income', 'expense'].includes(b.type)) throw bad('type must be income or expense');
  return { type: b.type, amount: money(b.amount, 'amount'), date: dateStr(b.date), category: text(b.category, 40) || 'General', note: text(b.note, 80) };
}
function cleanScheduled(b) {
  if (!['income', 'expense'].includes(b.type)) throw bad('type must be income or expense');
  const name = text(b.name, 60);
  if (!name) throw bad('name is required');
  const repeat = b.repeat === 'monthly' ? 'monthly' : 'none';
  return { name, type: b.type, amount: money(b.amount, 'amount'), date: dateStr(b.date), repeat };
}
function cleanScenario(b) {
  const p = b.params || {};
  return {
    name: text(b.name, 80) || 'Scenario',
    verdict: text(b.verdict, 200),
    params: {
      purchase: money(p.purchase || 0, 'purchase', true), purchaseDay: money(p.purchaseDay || 0, 'purchaseDay', true),
      extra: money(p.extra || 0, 'extra', true), extraDay: money(p.extraDay || 0, 'extraDay', true),
      delay: money(p.delay || 0, 'delay', true),
    },
    createdAt: new Date().toISOString(),
  };
}

// ---------- demo data (synthetic only) ----------
function isoDate(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function seedDemo() {
  for (const c of ['transactions', 'scheduled', 'scenarios']) await clearAll(c);
  await saveSettings({ openingBalance: 45000, reserve: 5000 });
  const cats = ['Food', 'Transport', 'Groceries', 'Entertainment', 'Shopping'];
  for (let i = 0; i < 30; i++) {
    await addDoc('transactions', { type: 'expense', amount: 250 + ((i * 137) % 300), date: isoDate(-i), category: cats[i % cats.length], note: 'Demo spending' });
  }
  await addDoc('transactions', { type: 'income', amount: 3000, date: isoDate(-15), category: 'Freelance', note: 'Demo income' });
  const sched = [
    { name: 'Salary', type: 'income', amount: 45000, date: isoDate(12), repeat: 'monthly' },
    { name: 'Rent', type: 'expense', amount: 15000, date: isoDate(4), repeat: 'monthly' },
    { name: 'Internet', type: 'expense', amount: 799, date: isoDate(7), repeat: 'monthly' },
    { name: 'Streaming', type: 'expense', amount: 499, date: isoDate(2), repeat: 'monthly' },
    { name: 'Semester fee', type: 'expense', amount: 12000, date: isoDate(20), repeat: 'none' },
  ];
  for (const s of sched) await addDoc('scheduled', s);
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { // one JSON line per request -> shows up in Cloud Logging
  res.on('finish', () => console.log(JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode })));
  next();
});
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true, storage: USE_MEMORY ? 'memory' : 'firestore' }));

app.get('/api/data', wrap(async (req, res) => {
  const [settings, transactions, scheduled, scenarios] = await Promise.all([
    getSettings(), listAll('transactions'), listAll('scheduled'), listAll('scenarios'),
  ]);
  res.json({ settings, transactions, scheduled, scenarios });
}));

app.put('/api/settings', wrap(async (req, res) => {
  res.json(await saveSettings({ openingBalance: Number(req.body.openingBalance) || 0, reserve: money(req.body.reserve || 0, 'reserve', true) }));
}));

app.post('/api/transactions', wrap(async (req, res) => res.status(201).json(await addDoc('transactions', cleanTx(req.body)))));
app.post('/api/scheduled', wrap(async (req, res) => res.status(201).json(await addDoc('scheduled', cleanScheduled(req.body)))));
app.post('/api/scenarios', wrap(async (req, res) => res.status(201).json(await addDoc('scenarios', cleanScenario(req.body)))));

for (const col of ['transactions', 'scheduled', 'scenarios']) {
  app.delete('/api/' + col + '/:id', wrap(async (req, res) => { await deleteDoc(col, req.params.id); res.json({ ok: true }); }));
}

app.post('/api/seed', wrap(async (req, res) => { await seedDemo(); res.json({ ok: true }); }));

// Local development convenience: also serve the frontend. (On the VM, Nginx does this.)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

app.listen(PORT, HOST, () => console.log('FinSight API on http://' + HOST + ':' + PORT + ' (storage: ' + (USE_MEMORY ? 'memory' : 'firestore') + ')'));
