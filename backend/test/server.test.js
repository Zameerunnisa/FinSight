const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.USE_MEMORY = '1';

describe('FinSight Backend API Tests', () => {
  let server;
  const baseUrl = 'http://127.0.0.1:8089';

  before(async () => {
    const { startServer } = require('../server.js');
    server = startServer(8089, '127.0.0.1');
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function req(path, opts = {}) {
    const res = await fetch(baseUrl + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, data: json, headers: res.headers };
  }

  test('GET /api/health returns ok status and storage type', async () => {
    const res = await req('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.storage, 'memory');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('POST /api/seed populates synthetic demo data and settings', async () => {
    const res = await req('/api/seed', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);

    const dataRes = await req('/api/data');
    assert.equal(dataRes.status, 200);
    assert.ok(dataRes.data.transactions.length >= 30);
    assert.ok(dataRes.data.scheduled.length >= 5);
    assert.equal(dataRes.data.settings.reserve, 15000);
  });

  test('POST /api/scheduled supports all recurrence intervals', async () => {
    const intervals = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    for (const rep of intervals) {
      const res = await req('/api/scheduled', {
        method: 'POST',
        body: {
          name: `Test ${rep}`,
          type: 'expense',
          amount: 500,
          date: '2026-10-15',
          repeat: rep,
        },
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.repeat, rep);
    }
  });

  test('GET /api/export/csv and POST /api/import/csv works smoothly', async () => {
    const exportRes = await req('/api/export/csv');
    assert.equal(exportRes.status, 200);
    assert.ok(typeof exportRes.data === 'string');
    assert.ok(exportRes.data.startsWith('date,type,amount,category,note'));

    const sampleCsv = `date,type,amount,category,note
2026-10-10,expense,450,"Cafe","Latte and pastry"
2026-10-10,income,5000,"Bonus","Performance reward"`;

    const importRes = await req('/api/import/csv', {
      method: 'POST',
      body: { csv: sampleCsv },
    });
    assert.equal(importRes.status, 200);
    assert.equal(importRes.data.imported, 2);
  });
});
