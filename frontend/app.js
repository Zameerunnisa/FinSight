// FinSight frontend: talks to the backend at /api and renders charts, metrics, and simulations.
var API = '/api';
var state = {
  settings: { openingBalance: 0, reserve: 0 },
  transactions: [],
  scheduled: [],
  scenarios: [],
};
var range = 30;
var lastScenario = null;

function $(id) {
  return document.getElementById(id);
}
function today() {
  return FinSight.iso(new Date());
}
function inr(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function niceDate(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

// ---------- API client ----------
async function api(path, method, body) {
  var res = await fetch(API + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  var json = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
function showMessage(msg, isError) {
  var box = $('message');
  box.textContent = msg;
  box.style.background = isError ? '#fee2e2' : '#dcfce7';
  box.style.color = isError ? '#991b1b' : '#15803d';
  box.hidden = false;
  setTimeout(function () {
    box.hidden = true;
  }, 5000);
}
function showError(e) {
  showMessage(e.message || String(e), true);
}
async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    showError(e);
  }
}
async function load() {
  state = await api('/data');
  render();
}

// ---------- Chart formatting & drawing ----------
function compact(v) {
  var a = Math.abs(v);
  if (a >= 100000) return (v / 100000).toFixed(1).replace('.0', '') + 'L';
  if (a >= 1000) return Math.round(v / 1000) + 'k';
  return String(Math.round(v));
}

// Draws SVG chart with confidence bands & binds hover tooltips
function drawChart(svg, series, reserve, corridor, tooltipEl) {
  var W = 700,
    H = 290,
    L = 55,
    R = 15,
    T = 20,
    B = 32;
  var values = [0, reserve];

  series.forEach(function (s) {
    s.points.forEach(function (p) {
      values.push(p.balance);
    });
  });

  if (corridor) {
    corridor.optimistic.forEach(function (p) {
      values.push(p.balance);
    });
    corridor.pessimistic.forEach(function (p) {
      values.push(p.balance);
    });
  }

  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (max === min) max = min + 100;

  var n = series[0].points.length;
  function x(i) {
    return L + ((W - L - R) * i) / (n - 1 || 1);
  }
  function y(v) {
    return T + (H - T - B) * (1 - (v - min) / (max - min));
  }

  var out = '';

  // Background grid lines
  for (var k = 0; k <= 4; k++) {
    var v = min + ((max - min) * k) / 4;
    out +=
      '<line x1="' +
      L +
      '" x2="' +
      (W - R) +
      '" y1="' +
      y(v) +
      '" y2="' +
      y(v) +
      '" stroke="#e2e8f0" stroke-width="1"/>' +
      '<text x="' +
      (L - 8) +
      '" y="' +
      (y(v) + 4) +
      '" text-anchor="end" font-size="11" font-weight="500" fill="#64748b">' +
      compact(v) +
      '</text>';
  }

  // Zero-balance baseline
  out +=
    '<line x1="' +
    L +
    '" x2="' +
    (W - R) +
    '" y1="' +
    y(0) +
    '" y2="' +
    y(0) +
    '" stroke="#94a3b8" stroke-width="1.5"/>';

  // Reserve threshold line
  if (reserve > 0) {
    out +=
      '<line x1="' +
      L +
      '" x2="' +
      (W - R) +
      '" y1="' +
      y(reserve) +
      '" y2="' +
      y(reserve) +
      '" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="5 4"/>' +
      '<text x="' +
      (W - R) +
      '" y="' +
      (y(reserve) - 5) +
      '" text-anchor="end" font-size="11" font-weight="600" fill="#b45309">&#9888; Reserve threshold (' +
      compact(reserve) +
      ')</text>';
  }

  // Confidence Corridor (shaded band between optimistic and pessimistic projections)
  if (corridor && corridor.optimistic && corridor.pessimistic) {
    var polyPoints = [];
    for (var i = 0; i < n; i++) {
      polyPoints.push(x(i).toFixed(1) + ',' + y(corridor.optimistic[i].balance).toFixed(1));
    }
    for (var j = n - 1; j >= 0; j--) {
      polyPoints.push(x(j).toFixed(1) + ',' + y(corridor.pessimistic[j].balance).toFixed(1));
    }
    out +=
      '<polygon points="' +
      polyPoints.join(' ') +
      '" fill="rgba(99, 102, 241, 0.12)" stroke="rgba(99, 102, 241, 0.35)" stroke-width="1" stroke-dasharray="3 3"/>';
  }

  // Primary Series curves
  series.forEach(function (s) {
    var pts = s.points
      .map(function (p, i) {
        return x(i).toFixed(1) + ',' + y(p.balance).toFixed(1);
      })
      .join(' ');
    out +=
      '<polyline fill="none" stroke="' +
      s.color +
      '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' +
      pts +
      '"/>';
  });

  // Date labels along the X axis
  var indices = [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1];
  indices.forEach(function (i) {
    var anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    out +=
      '<text x="' +
      x(i) +
      '" y="' +
      (H - 8) +
      '" text-anchor="' +
      anchor +
      '" font-size="11" font-weight="500" fill="#64748b">' +
      niceDate(series[0].points[i].date) +
      '</text>';
  });

  // Series Legends (if multi-series comparison)
  if (series.length > 1) {
    series.forEach(function (s, idx) {
      out +=
        '<rect x="' +
        (L + 12 + idx * 160) +
        '" y="4" width="12" height="12" rx="3" fill="' +
        s.color +
        '"/>' +
        '<text x="' +
        (L + 30 + idx * 160) +
        '" y="14" font-size="12" font-weight="600" fill="#334155">' +
        esc(s.label) +
        '</text>';
    });
  }

  // Interactive crosshair element placeholder
  out +=
    '<line id="ch-line" x1="0" y1="' +
    T +
    '" x2="0" y2="' +
    (H - B) +
    '" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="3 3" style="display:none;"/>';
  out +=
    '<circle id="ch-dot" cx="0" cy="0" r="5" fill="#4f46e5" stroke="#fff" stroke-width="2" style="display:none;"/>';

  svg.innerHTML = out;

  // Hover & mousemove event handler
  if (tooltipEl) {
    var chLine = svg.querySelector('#ch-line');
    var chDot = svg.querySelector('#ch-dot');

    svg.onmousemove = function (e) {
      var rect = svg.getBoundingClientRect();
      var clientX = e.clientX - rect.left;
      var frac = Math.max(0, Math.min(1, (clientX - L) / (W - L - R)));
      var idx = Math.round(frac * (n - 1));
      var pt = series[0].points[idx];
      if (!pt) return;

      var px = x(idx);
      var py = y(pt.balance);

      chLine.setAttribute('x1', px);
      chLine.setAttribute('x2', px);
      chLine.style.display = 'block';

      chDot.setAttribute('cx', px);
      chDot.setAttribute('cy', py);
      chDot.style.display = 'block';

      // Check scheduled events on this date
      var eventsOnDay = (state.scheduled || []).filter(function (s) {
        return FinSight.occurrences(s, pt.date, pt.date).length > 0;
      });
      var subText = '';
      if (eventsOnDay.length > 0) {
        subText =
          eventsOnDay
            .map(function (ev) {
              return (ev.type === 'income' ? '+ ' : '- ') + esc(ev.name) + ' (' + inr(ev.amount) + ')';
            })
            .join('<br>') ;
      }

      var html =
        '<div class="tt-date">' +
        niceDate(pt.date) +
        '</div><div class="tt-bal">' +
        inr(pt.balance) +
        '</div>' +
        (subText ? '<div class="tt-sub">' + subText + '</div>' : '');

      tooltipEl.innerHTML = html;
      tooltipEl.style.left = (px / W) * 100 + '%';
      tooltipEl.style.top = (py / H) * 100 + '%';
      tooltipEl.hidden = false;
    };

    svg.onmouseleave = function () {
      chLine.style.display = 'none';
      chDot.style.display = 'none';
      tooltipEl.hidden = true;
    };
  }
}

// ---------- Rendering Logic ----------
function render() {
  var t = today();
  var reserve = Number(state.settings.reserve) || 0;
  var balance = FinSight.currentBalance(state, t);
  var safe = FinSight.safeToSpend(state, { today: t });
  var f30 = FinSight.forecast(state, { today: t, days: 30 });
  var health = FinSight.healthScore(state, t);

  // Stats Bar Cards with Health Score and Runway
  $('stats').innerHTML =
    stat('Current Balance', inr(balance), 'Opening balance + net logs', balance < 0) +
    stat('Safe to Spend', inr(safe), 'Liquid discretionary allowance', safe === 0) +
    statHealth('Health Score', health.score + ' / 100', health.grade, health.status) +
    stat('Cash Runway', health.runwayMonths + ' mo', 'Liquid buffer vs monthly burn', health.runwayMonths < 2) +
    stat('Avg Daily Spend', inr(f30.avgDaily), 'Trailing 30-day mean', false) +
    stat('30d Minimum', inr(f30.lowest.balance), 'on ' + niceDate(f30.lowest.date), f30.lowest.balance < 0);

  // Recommendations Banner
  var w = $('warning');
  if (f30.shortfallDate) {
    w.className = 'banner danger';
    w.textContent =
      'Likely shortfall on ' +
      niceDate(f30.shortfallDate) +
      ': projected balance falls below zero. Reduce non-essential commitments.';
  } else if (f30.belowReserveDate) {
    w.className = 'banner warn';
    w.textContent =
      'Safety warning: projected to drop below your reserve on ' +
      niceDate(f30.belowReserveDate) +
      '. Maintain minimum emergency buffer.';
  } else {
    w.className = 'banner ok';
    w.textContent =
      'Healthy cash flow: projected balance remains above your reserve over the next 30 days.';
  }

  // Primary Forecast Chart with Confidence Band
  var fr = FinSight.forecast(state, { today: t, days: range });
  drawChart(
    $('chart'),
    [{ label: 'Projected balance', color: '#4f46e5', points: fr.points }],
    reserve,
    { optimistic: fr.optimistic, pessimistic: fr.pessimistic },
    $('chart-tooltip')
  );

  // Category Breakdown Rendering
  renderCategories(t);

  // Form Field Sync
  if (document.activeElement !== $('set-opening')) $('set-opening').value = state.settings.openingBalance;
  if (document.activeElement !== $('set-reserve')) $('set-reserve').value = state.settings.reserve;

  renderLists();
}

function stat(label, value, sub, negative) {
  return (
    '<div class="stat"><div class="label">' +
    esc(label) +
    '</div><div class="value' +
    (negative ? ' neg' : '') +
    '">' +
    esc(value) +
    '</div><div class="sub">' +
    esc(sub) +
    '</div></div>'
  );
}

function statHealth(label, value, grade, status) {
  var badgeClass = grade.replace('+', '-plus');
  return (
    '<div class="stat"><div class="label">' +
    esc(label) +
    '<span class="score-badge ' +
    badgeClass +
    '">' +
    esc(grade) +
    '</span></div><div class="value">' +
    esc(value) +
    '</div><div class="sub">' +
    esc(status) +
    '</div></div>'
  );
}

function delBtn(col, id) {
  return (
    '<button class="del" data-col="' +
    col +
    '" data-id="' +
    esc(id) +
    '" title="Delete">&times;</button>'
  );
}

function renderCategories(todayDate) {
  var catData = FinSight.categorySpend(state, 30, todayDate);
  $('category-total').textContent = 'Total: ' + inr(catData.total);

  if (!catData.categories.length) {
    $('category-list').innerHTML =
      '<p class="hint">No expenses logged in the last 30 days. Add everyday spending or load demo data.</p>';
    return;
  }

  var html = catData.categories
    .map(function (c) {
      return (
        '<div class="category-bar-row">' +
        '<div class="cat-info"><span>' +
        esc(c.category) +
        ' (' +
        c.percentage +
        '%)</span><span>' +
        inr(c.amount) +
        '</span></div>' +
        '<div class="cat-track"><div class="cat-fill" style="width:' +
        c.percentage +
        '%"></div></div>' +
        '</div>'
      );
    })
    .join('');

  $('category-list').innerHTML = html;
}

function renderLists() {
  var tx = state.transactions
    .slice()
    .sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    })
    .slice(0, 15);

  $('tx-list').innerHTML = tx.length
    ? tx
        .map(function (r) {
          return (
            '<li><div>' +
            esc(r.category) +
            '<div class="meta">' +
            niceDate(r.date) +
            (r.note ? ' - ' + esc(r.note) : '') +
            '</div></div>' +
            '<div><span class="amt ' +
            r.type +
            '">' +
            (r.type === 'income' ? '+' : '-') +
            inr(r.amount) +
            '</span> ' +
            delBtn('transactions', r.id) +
            '</div></li>'
          );
        })
        .join('')
    : '<li class="meta">No transactions yet. Click "Load demo data" or log an entry.</li>';

  var sch = state.scheduled.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : 1;
  });

  var repeatLabels = {
    monthly: 'Monthly from ',
    biweekly: 'Bi-weekly from ',
    weekly: 'Weekly from ',
    quarterly: 'Quarterly from ',
    yearly: 'Annually from ',
    none: 'Once on ',
  };

  $('sch-list').innerHTML = sch.length
    ? sch
        .map(function (r) {
          var prefix = repeatLabels[r.repeat] || 'Repeats from ';
          return (
            '<li><div>' +
            esc(r.name) +
            '<div class="meta">' +
            prefix +
            niceDate(r.date) +
            '</div></div>' +
            '<div><span class="amt ' +
            r.type +
            '">' +
            (r.type === 'income' ? '+' : '-') +
            inr(r.amount) +
            '</span> ' +
            delBtn('scheduled', r.id) +
            '</div></li>'
          );
        })
        .join('')
    : '<li class="meta">No scheduled bills or recurring income set.</li>';

  $('scenario-list').innerHTML = state.scenarios.length
    ? state.scenarios
        .map(function (r) {
          return (
            '<li><div>' +
            esc(r.name) +
            '<div class="meta">' +
            esc(r.verdict) +
            '</div></div><div>' +
            delBtn('scenarios', r.id) +
            '</div></li>'
          );
        })
        .join('')
    : '<li class="meta">No saved scenarios. Run the simulator to test decisions.</li>';
}

// ---------- What-If Simulator ----------
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
  var after = FinSight.forecast(state, {
    today: t,
    days: 60,
    extras: extras,
    delayIncomeDays: p.delay,
  });
  var safeBefore = FinSight.safeToSpend(state, { today: t });
  var safeAfter = FinSight.safeToSpend(state, { today: t, extras: extras });

  var v = $('verdict'),
    text;
  if (after.shortfallDate) {
    v.className = 'banner danger';
    text = 'High deficit risk: balance drops below zero on ' + niceDate(after.shortfallDate) + '.';
  } else if (after.belowReserveDate) {
    v.className = 'banner warn';
    text =
      'Reserve breach: balance would fall below your emergency safety threshold on ' +
      niceDate(after.belowReserveDate) +
      '.';
  } else {
    v.className = 'banner ok';
    text = 'Looks affordable: projected cash reserves remain well-hedged for 60 days.';
  }
  v.textContent = text;

  drawChart(
    $('chart2'),
    [
      { label: 'Without scenario', color: '#94a3b8', points: before.points },
      { label: 'With simulated decisions', color: '#e11d48', points: after.points },
    ],
    reserve,
    null,
    $('chart2-tooltip')
  );

  function row(label, a, b) {
    return '<tr><td>' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
  }
  function lowest(f) {
    return inr(f.lowest.balance) + ' (' + niceDate(f.lowest.date) + ')';
  }

  $('compare').innerHTML =
    '<tr><th>Decision Metric</th><th>Baseline</th><th>Simulated Scenario</th></tr>' +
    row('Lowest Balance', lowest(before), lowest(after)) +
    row('Balance after 60 Days', inr(before.end.balance), inr(after.end.balance)) +
    row(
      'First Cash Shortfall',
      before.shortfallDate ? niceDate(before.shortfallDate) : 'None',
      after.shortfallDate ? niceDate(after.shortfallDate) : 'None'
    ) +
    row(
      'Below Reserve Date',
      before.belowReserveDate ? niceDate(before.belowReserveDate) : 'Never',
      after.belowReserveDate ? niceDate(after.belowReserveDate) : 'Never'
    ) +
    row('Discretionary Safe-to-Spend', inr(safeBefore), inr(safeAfter));

  $('whatif-result').hidden = false;

  var parts = [];
  if (p.purchase > 0) parts.push('Purchase ' + inr(p.purchase) + ' in ' + p.purchaseDay + 'd');
  if (p.extra > 0) parts.push('Surprise ' + inr(p.extra) + ' in ' + p.extraDay + 'd');
  if (p.delay > 0) parts.push('Salary ' + p.delay + 'd late');
  lastScenario = { name: parts.join(', ') || 'No changes', verdict: text, params: p };
}

// ---------- Event Listeners ----------
document.addEventListener('click', function (e) {
  var del = e.target.closest('.del');
  if (del) {
    guarded(async function () {
      await api('/' + del.dataset.col + '/' + encodeURIComponent(del.dataset.id), 'DELETE');
      await load();
    });
  }

  var tab = e.target.closest('#range-tabs button');
  if (tab) {
    range = Number(tab.dataset.range);
    document.querySelectorAll('#range-tabs button').forEach(function (b) {
      b.classList.toggle('active', b === tab);
    });
    render();
  }
});

$('seed-btn').addEventListener('click', function () {
  guarded(async function () {
    await api('/seed', 'POST');
    await load();
    showMessage('Demo dataset loaded successfully!');
  });
});

$('export-csv-btn').addEventListener('click', function () {
  window.location.href = API + '/export/csv';
});

$('import-csv-input').addEventListener('change', function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var content = ev.target.result;
    guarded(async function () {
      var res = await api('/import/csv', 'POST', { csv: content });
      await load();
      showMessage('Imported ' + res.imported + ' transactions from CSV!');
    });
  };
  reader.readAsText(file);
  e.target.value = ''; // reset file input
});

$('tx-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/transactions', 'POST', {
      type: $('tx-type').value,
      amount: $('tx-amount').value,
      date: $('tx-date').value,
      category: $('tx-category').value,
      note: $('tx-note').value,
    });
    $('tx-amount').value = '';
    $('tx-note').value = '';
    await load();
  });
});

$('sch-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/scheduled', 'POST', {
      name: $('sch-name').value,
      type: $('sch-type').value,
      amount: $('sch-amount').value,
      date: $('sch-date').value,
      repeat: $('sch-repeat').value,
    });
    $('sch-name').value = '';
    $('sch-amount').value = '';
    await load();
  });
});

$('settings-form').addEventListener('submit', function (e) {
  e.preventDefault();
  guarded(async function () {
    await api('/settings', 'PUT', {
      openingBalance: $('set-opening').value,
      reserve: $('set-reserve').value,
    });
    await load();
    showMessage('Settings updated.');
  });
});

$('whatif-form').addEventListener('submit', function (e) {
  e.preventDefault();
  runWhatIf();
});

$('save-scenario').addEventListener('click', function () {
  if (!lastScenario) return;
  guarded(async function () {
    await api('/scenarios', 'POST', lastScenario);
    await load();
  });
});

// Initial boot
$('tx-date').value = today();
$('sch-date').value = today();
guarded(load);
