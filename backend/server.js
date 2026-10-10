// FinSight backend: a resilient Express API that stores data in Cloud Firestore.
// Local testing without Google Cloud:  USE_MEMORY=1 node server.js
const express = require('express');
const path = require('path');
const fs = require('fs');

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
const mem = {
  transactions: {},
  scheduled: {},
  scenarios: {},
  settings: { openingBalance: 0, reserve: 0 },
};
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
  if (USE_MEMORY) {
    delete mem[col][id];
    return;
  }
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
  if (USE_MEMORY) {
    mem.settings = s;
    return s;
  }
  await db.collection(PREFIX + 'settings').doc('demo').set(s);
  return s;
}

// ---------- validation ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_REPEATS = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function money(v, name, allowZero) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9 || (!allowZero && n === 0))
    throw bad(name + ' must be a valid positive amount');
  return n;
}
function text(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function dateStr(v) {
  if (!DATE_RE.test(v)) throw bad('date must be YYYY-MM-DD');
  return v;
}

function cleanTx(b) {
  if (!['income', 'expense'].includes(b.type)) throw bad('type must be income or expense');
  return {
    type: b.type,
    amount: money(b.amount, 'amount'),
    date: dateStr(b.date),
    category: text(b.category, 40) || 'General',
    note: text(b.note, 80),
  };
}
function cleanScheduled(b) {
  if (!['income', 'expense'].includes(b.type)) throw bad('type must be income or expense');
  const name = text(b.name, 60);
  if (!name) throw bad('name is required');
  const repeat = VALID_REPEATS.includes(b.repeat) ? b.repeat : 'none';
  return {
    name,
    type: b.type,
    amount: money(b.amount, 'amount'),
    date: dateStr(b.date),
    repeat,
  };
}
function cleanScenario(b) {
  const p = b.params || {};
  return {
    name: text(b.name, 80) || 'Scenario',
    verdict: text(b.verdict, 200),
    params: {
      purchase: money(p.purchase || 0, 'purchase', true),
      purchaseDay: money(p.purchaseDay || 0, 'purchaseDay', true),
      extra: money(p.extra || 0, 'extra', true),
      extraDay: money(p.extraDay || 0, 'extraDay', true),
      delay: money(p.delay || 0, 'delay', true),
    },
    createdAt: new Date().toISOString(),
  };
}

// ---------- demo data (synthetic only) ----------
function isoDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

async function seedDemo() {
  for (const c of ['transactions', 'scheduled', 'scenarios']) await clearAll(c);
  await saveSettings({ openingBalance: 65000, reserve: 15000 });

  const cats = ['Groceries', 'Dining Out', 'Transit', 'Utilities', 'Shopping', 'Healthcare'];
  for (let i = 0; i < 30; i++) {
    await addDoc('transactions', {
      type: 'expense',
      amount: 250 + ((i * 137) % 450),
      date: isoDate(-i),
      category: cats[i % cats.length],
      note: 'Everyday spend #' + (30 - i),
    });
  }
  await addDoc('transactions', {
    type: 'income',
    amount: 12000,
    date: isoDate(-14),
    category: 'Freelance & Consulting',
    note: 'Client milestone payment',
  });

  const sched = [
    { name: 'Monthly Salary', type: 'income', amount: 55000, date: isoDate(10), repeat: 'monthly' },
    { name: 'House Rent', type: 'expense', amount: 18000, date: isoDate(3), repeat: 'monthly' },
    { name: 'Broadband Fiber', type: 'expense', amount: 999, date: isoDate(6), repeat: 'monthly' },
    { name: 'Weekly Fitness Center', type: 'expense', amount: 750, date: isoDate(2), repeat: 'weekly' },
    { name: 'Cloud & SaaS Subscriptions', type: 'expense', amount: 1499, date: isoDate(15), repeat: 'monthly' },
    { name: 'Term Tuition Fee', type: 'expense', amount: 20000, date: isoDate(25), repeat: 'none' },
  ];
  for (const s of sched) await addDoc('scheduled', s);
}

// ---------- app & security middleware ----------
const app = express();
app.use(express.json({ limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Structured request logging (compatible with Google Cloud Logging)
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
      })
    );
  });
  next();
});

// In-memory rate limiting to prevent flood abuse
const requestCounts = new Map();
const cleanupTimer = setInterval(() => requestCounts.clear(), 60000);
if (cleanupTimer.unref) cleanupTimer.unref(); // Allow event loop to exit cleanly in tests
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const count = (requestCounts.get(ip) || 0) + 1;
  requestCounts.set(ip, count);
  if (count > 300) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---------- API Routes ----------
app.get('/api/health', (req, res) =>
  res.json({ ok: true, version: '1.1.0', storage: USE_MEMORY ? 'memory' : 'firestore' })
);

app.get(
  '/api/data',
  wrap(async (req, res) => {
    const [settings, transactions, scheduled, scenarios] = await Promise.all([
      getSettings(),
      listAll('transactions'),
      listAll('scheduled'),
      listAll('scenarios'),
    ]);
    res.json({ settings, transactions, scheduled, scenarios });
  })
);

app.put(
  '/api/settings',
  wrap(async (req, res) => {
    res.json(
      await saveSettings({
        openingBalance: Number(req.body.openingBalance) || 0,
        reserve: money(req.body.reserve || 0, 'reserve', true),
      })
    );
  })
);

app.post(
  '/api/transactions',
  wrap(async (req, res) => res.status(201).json(await addDoc('transactions', cleanTx(req.body))))
);

app.post(
  '/api/scheduled',
  wrap(async (req, res) => res.status(201).json(await addDoc('scheduled', cleanScheduled(req.body))))
);

app.post(
  '/api/scenarios',
  wrap(async (req, res) => res.status(201).json(await addDoc('scenarios', cleanScenario(req.body))))
);

for (const col of ['transactions', 'scheduled', 'scenarios']) {
  app.delete(
    '/api/' + col + '/:id',
    wrap(async (req, res) => {
      await deleteDoc(col, req.params.id);
      res.json({ ok: true });
    })
  );
}

app.post(
  '/api/seed',
  wrap(async (req, res) => {
    await seedDemo();
    res.json({ ok: true });
  })
);

// CSV Export
app.get(
  '/api/export/csv',
  wrap(async (req, res) => {
    const txs = await listAll('transactions');
    let csv = 'date,type,amount,category,note\n';
    txs
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .forEach((t) => {
        const safeNote = (t.note || '').replace(/"/g, '""');
        const safeCat = (t.category || '').replace(/"/g, '""');
        csv += `${t.date},${t.type},${t.amount},"${safeCat}","${safeNote}"\n`;
      });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="finsight_transactions.csv"');
    res.send(csv);
  })
);

// CSV Import
app.post(
  '/api/import/csv',
  wrap(async (req, res) => {
    const csvData = req.body.csv;
    if (!csvData || typeof csvData !== 'string') {
      throw bad('csv content required in request body');
    }
    const lines = csvData.trim().split('\n');
    let imported = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || (i === 0 && line.toLowerCase().startsWith('date'))) continue; // skip empty or header
      const parts = line.split(',');
      if (parts.length >= 3) {
        const date = parts[0].trim();
        const type = parts[1].trim().toLowerCase();
        const amount = Number(parts[2].trim());
        const category = parts[3] ? parts[3].replace(/^"|"$/g, '').trim() : 'Imported';
        const note = parts[4] ? parts[4].replace(/^"|"$/g, '').trim() : 'CSV Import';
        if (DATE_RE.test(date) && ['income', 'expense'].includes(type) && Number.isFinite(amount) && amount > 0) {
          await addDoc('transactions', { date, type, amount, category, note });
          imported++;
        }
      }
    }
    res.json({ ok: true, imported });
  })
);

// Serve frontend from either relative directory location
const possibleFrontendPaths = [
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, 'frontend'),
  path.join(process.cwd(), 'frontend'),
];
const frontendDir = possibleFrontendPaths.find((p) => fs.existsSync(p)) || possibleFrontendPaths[0];
app.use(express.static(frontendDir));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

let serverInstance = null;
function startServer(port = PORT, host = HOST) {
  serverInstance = app.listen(port, host, () =>
    console.log(
      `FinSight API v1.1.0 on http://${host}:${port} (storage: ${USE_MEMORY ? 'memory' : 'firestore'})`
    )
  );
  return serverInstance;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

