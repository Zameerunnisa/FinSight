// FinSight frontend: talks to the backend at /api and draws everything.
var API = '/api';
var state = { settings: { openingBalance: 0, reserve: 0 }, transactions: [], scheduled: [], scenarios: [] };
var range = 30;
var lastScenario = null;

function $(id) { return document.getElementById(id); }
function today() { return FinSight.iso(new Date()); }
function inr(n) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}
function esc(s) { // user text is stored, so always escape it before putting it in HTML
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function niceDate(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ---------- API ----------
async function api(path, method, body) {
  var res = await fetch(API + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  var json = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
function showError(e) {
  var box = $('message');
  box.textContent = e.message || String(e);
  box.hidden = false;
  setTimeout(function () { box.hidden = true; }, 6000);
}
async function guarded(fn) {
  try { await fn(); } catch (e) { showError(e); }
}
async function load() {
  state = await api('/data');
  render();
}

// ---------- chart ----------
function compact(v) {
  var a = Math.abs(v);
  if (a >= 100000) return (v / 100000).toFixed(1).replace('.0', '') + 'L';
  if (a >= 1000) return Math.round(v / 1000) + 'k';
  return String(Math.round(v));
}
// series: [{label, color, points:[{date, balance}]}]
function drawChart(svg, series, reserve) {
  var W = 700, H = 280, L = 55, R = 15, T = 18, B = 30;
  var values = [0, reserve];
  series.forEach(function (s) { s.points.forEach(function (p) { values.push(p.balance); }); });
  var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
  if (max === min) max = min + 1;
  var n = series[0].points.length;
  function x(i) { return L + (W - L - R) * i / (n - 1 || 1); }
  function y(v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); }
  var out = '';
  for (var k = 0; k <= 4; k++) {
    var v = min + (max - min) * k / 4;
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e5e7eb"/>' +
      '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="#6b7280">' + compact(v) + '</text>';
  }
  out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#9ca3af"/>';
  if (reserve > 0) {
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(reserve) + '" y2="' + y(reserve) + '" stroke="#f59e0b" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - R) + '" y="' + (y(reserve) - 4) + '" text-anchor="end" font-size="11" fill="#b45309">reserve</text>';
  }
  series.forEach(function (s) {
    var pts = s.points.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.balance).toFixed(1); }).join(' ');
    out += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2.5" points="' + pts + '"/>';
  });
  [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) {
    out += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') +
      '" font-size="11" fill="#6b7280">' + niceDate(series[0].points[i].date) + '</text>';
  });
  if (series.length > 1) {
    series.forEach(function (s, idx) {
      out += '<rect x="' + (L + 8 + idx * 140) + '" y="4" width="10" height="10" fill="' + s.color + '"/>' +
        '<text x="' + (L + 22 + idx * 140) + '" y="13" font-size="12" fill="#374151">' + esc(s.label) + '</text>';
    });
  }
  svg.innerHTML = out;
}

// ---------- rendering ----------
function render() {
  var t = today();
  var reserve = Number(state.settings.reserve) || 0;
  var balance = FinSight.currentBalance(state, t);
  var safe = FinSight.safeToSpend(state, { today: t });
  var f30 = FinSight.forecast(state, { today: t, days: 30 });

  // stats
  $('stats').innerHTML =
    stat('Current balance', inr(balance), 'Opening balance + logged transactions', balance < 0) +
    stat('Safe to spend', inr(safe), 'Balance - bills (30 days) - reserve') +
    stat('Avg daily spending', inr(f30.avgDaily), 'Last 30 days') +
    stat('Lowest balance (30 days)', inr(f30.lowest.balance), 'on ' + niceDate(f30.lowest.date), f30.lowest.balance < 0);

  // warning
  var w = $('warning');
  if (f30.shortfallDate) {
    w.className = 'banner danger';
    w.textContent = 'Likely shortfall on ' + niceDate(f30.shortfallDate) + ': your balance is projected to go below zero.';
  } else if (f30.belowReserveDate) {
    w.className = 'banner warn';
    w.textContent = 'Low-balance warning: projected to drop below your reserve on ' + niceDate(f30.belowReserveDate) + '.';
  } else {
    w.className = 'banner ok';
    w.textContent = 'On track: no shortfall or low-balance warning in the next 30 days.';
  }

  // forecast chart
  var fr = FinSight.forecast(state, { today: t, days: range });
  drawChart($('chart'), [{ label: 'Projected balance', color: '#1a3c6e', points: fr.points }], reserve);

  // settings fields (do not overwrite while typing)
  if (document.activeElement !== $('set-opening')) $('set-opening').value = state.settings.openingBalance;
  if (document.activeElement !== $('set-reserve')) $('set-reserve').value = state.settings.reserve;

  renderLists();
}
function stat(label, value, sub, negative) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value' + (negative ? ' neg' : '') + '">' +
    esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
}
function delBtn(col, id) {
  return '<button class="del" data-col="' + col + '" data-id="' + esc(id) + '" title="Delete">&times;</button>';
}
function renderLists() {
  var tx = state.transactions.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 12);
  $('tx-list').innerHTML = tx.length ? tx.map(function (r) {
    return '<li><div>' + esc(r.category) + '<div class="meta">' + niceDate(r.date) + (r.note ? ' - ' + esc(r.note) : '') + '</div></div>' +
      '<div><span class="amt ' + r.type + '">' + (r.type === 'income' ? '+' : '-') + inr(r.amount) + '</span> ' + delBtn('transactions', r.id) + '</div></li>';
  }).join('') : '<li class="meta">Nothing yet. Add a transaction or load demo data.</li>';

  var sch = state.scheduled.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  $('sch-list').innerHTML = sch.length ? sch.map(function (r) {
    return '<li><div>' + esc(r.name) + '<div class="meta">' + (r.repeat === 'monthly' ? 'Monthly from ' : 'Once on ') + niceDate(r.date) + '</div></div>' +
      '<div><span class="amt ' + r.type + '">' + (r.type === 'income' ? '+' : '-') + inr(r.amount) + '</span> ' + delBtn('scheduled', r.id) + '</div></li>';
  }).join('') : '<li class="meta">No bills or salary yet.</li>';

  $('scenario-list').innerHTML = state.scenarios.length ? state.scenarios.map(function (r) {
    return '<li><div>' + esc(r.name) + '<div class="meta">' + esc(r.verdict) + '</div></div><div>' + delBtn('scenarios', r.id) + '</div></li>';
  }).join('') : '<li class="meta">No saved scenarios.</li>';
}

// ---------- What-If ----------
function readScenario() {
  return {
    purchase: Number($('wi-purchase').value) || 0,
    purchaseDay: Number($('wi-purchase-day').value) || 0,
    extra: Number($('wi-extra').value) || 0,
    extraDay: Number($('wi-extra-day').value) || 0,
    delay: Number($('wi-delay').value) || 0,
  };
}
function runWhatIf() {
  var p = readScenario();
  var t = today();
  var reserve = Number(state.settings.reserve) || 0;
  var extras = [];
  if (p.purchase > 0) extras.push({ day: p.purchaseDay, amount: p.purchase });
  if (p.extra > 0) extras.push({ day: p.extraDay, amount: p.extra });

  var before = FinSight.forecast(state, { today: t, days: 60 });
  var after = FinSight.forecast(state, { today: t, days: 60, extras: extras, delayIncomeDays: p.delay });
  var safeBefore = FinSight.safeToSpend(state, { today: t });
  var safeAfter = FinSight.safeToSpend(state, { today: t, extras: extras });

  var v = $('verdict'), text;
  if (after.shortfallDate) {
    v.className = 'banner danger';
    text = 'Not safe: you would run short on ' + niceDate(after.shortfallDate) + '.';
  } else if (after.belowReserveDate) {
    v.className = 'banner warn';
    text = 'Risky: balance would drop below your reserve on ' + niceDate(after.belowReserveDate) + '.';
  } else {
    v.className = 'banner ok';
    text = 'Looks affordable: balance stays above your reserve for 60 days.';
  }
  v.textContent = text;

  drawChart($('chart2'), [
    { label: 'Without changes', color: '#9ca3af', points: before.points },
    { label: 'With scenario', color: '#dc2626', points: after.points },
  ], reserve);

  function row(label, a, b) { return '<tr><td>' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>'; }
  function lowest(f) { return inr(f.lowest.balance) + ' (' + niceDate(f.lowest.date) + ')'; }
  $('compare').innerHTML = '<tr><th></th><th>Without</th><th>With scenario</th></tr>' +
    row('Lowest balance', lowest(before), lowest(after)) +
    row('Balance after 60 days', inr(before.end.balance), inr(after.end.balance)) +
    row('First shortfall', before.shortfallDate ? niceDate(before.shortfallDate) : 'None', after.shortfallDate ? niceDate(after.shortfallDate) : 'None') +
    row('Below reserve from', before.belowReserveDate ? niceDate(before.belowReserveDate) : 'Never', after.belowReserveDate ? niceDate(after.belowReserveDate) : 'Never') +
    row('Safe to spend now', inr(safeBefore), inr(safeAfter));

  $('whatif-result').hidden = false;
  var parts = [];
  if (p.purchase > 0) parts.push('Purchase ' + inr(p.purchase) + ' in ' + p.purchaseDay + 'd');
  if (p.extra > 0) parts.push('Expense ' + inr(p.extra) + ' in ' + p.extraDay + 'd');
  if (p.delay > 0) parts.push('Salary ' + p.delay + 'd late');
  lastScenario = { name: parts.join(', ') || 'No changes', verdict: text, params: p };
}

// ---------- events ----------
document.addEventListener('click', function (e) {
  var del = e.target.closest('.del');
  if (del) {
    guarded(async function () { await api('/' + del.dataset.col + '/' + encodeURIComponent(del.dataset.id), 'DELETE'); await load(); });
  }
  var tab = e.target.closest('#range-tabs button');
  if (tab) {
    range = Number(tab.dataset.range);
    document.querySelectorAll('#range-tabs button').forEach(function (b) { b.classList.toggle('active', b === tab); });
    render();
  }
});

$('seed-btn').addEventListener('click', function () {
  guarded(async function () { await api('/seed', 'POST'); await load(); });
});

$('tx-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/transactions', 'POST', {
      type: $('tx-type').value, amount: $('tx-amount').value, date: $('tx-date').value,
      category: $('tx-category').value, note: $('tx-note').value,
    });
    $('tx-amount').value = ''; $('tx-note').value = '';
    await load();
  });
});

$('sch-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/scheduled', 'POST', {
      name: $('sch-name').value, type: $('sch-type').value, amount: $('sch-amount').value,
      date: $('sch-date').value, repeat: $('sch-repeat').value,
    });
    $('sch-name').value = ''; $('sch-amount').value = '';
    await load();
  });
});

$('settings-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/settings', 'PUT', { openingBalance: $('set-opening').value, reserve: $('set-reserve').value });
    await load();
  });
});

$('whatif-form').addEventListener('submit', function (e) { e.preventDefault(); runWhatIf(); });

$('save-scenario').addEventListener('click', function () {
  if (!lastScenario) return;
  guarded(async function () { await api('/scenarios', 'POST', lastScenario); await load(); });
});

// ---------- start ----------
$('tx-date').value = today();
$('sch-date').value = today();
guarded(load);
