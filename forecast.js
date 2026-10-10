// FinSight calculations. Pure functions: no DOM, no network, easy to test.
// Dates are plain 'YYYY-MM-DD' strings.
const FinSight = (function () {
  function parse(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

  // All dates an item happens on between from..to (inclusive).
  function occurrences(item, from, to) {
    if (item.repeat !== 'monthly') return item.date >= from && item.date <= to ? [item.date] : [];
    const base = parse(item.date);
    const out = [];
    for (let k = 0; k < 1200; k++) {
      const first = new Date(base.getFullYear(), base.getMonth() + k, 1);
      const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const d = iso(new Date(first.getFullYear(), first.getMonth(), Math.min(base.getDate(), lastDay)));
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }

  // Opening balance + everything logged up to today.
  function currentBalance(data, today) {
    let b = Number(data.settings.openingBalance) || 0;
    data.transactions.forEach(function (t) {
      if (t.date <= today) b += t.type === 'income' ? t.amount : -t.amount;
    });
    return b;
  }

  // Average everyday spending per day over the last 30 days.
  function avgDailySpend(data, today) {
    const from = addDays(today, -29);
    let sum = 0;
    data.transactions.forEach(function (t) {
      if (t.type === 'expense' && t.date >= from && t.date <= today) sum += t.amount;
    });
    return sum / 30;
  }

  // Safe-to-spend = balance - bills due in next 30 days - reserve (never below 0).
  // opts.extras: [{day, amount}] hypothetical expenses.
  function safeToSpend(data, opts) {
    const today = opts.today;
    const extras = opts.extras || [];
    let obligations = 0;
    data.scheduled.forEach(function (s) {
      if (s.type !== 'expense') return;
      obligations += occurrences(s, addDays(today, 1), addDays(today, 30)).length * s.amount;
    });
    extras.forEach(function (e) { if (e.day <= 30) obligations += e.amount; });
    const reserve = Number(data.settings.reserve) || 0;
    return Math.max(0, currentBalance(data, today) - obligations - reserve);
  }

  // Day-by-day projected balance.
  // opts: today, days (7/30/60), extras [{day, amount}], delayIncomeDays
  function forecast(data, opts) {
    const today = opts.today;
    const days = opts.days || 30;
    const extras = opts.extras || [];
    const delay = opts.delayIncomeDays || 0;
    const avg = avgDailySpend(data, today);
    const change = new Array(days + 1).fill(0);

    extras.forEach(function (e) { if (e.day >= 0 && e.day <= days) change[e.day] -= e.amount; });

    data.scheduled.forEach(function (item) {
      occurrences(item, addDays(today, 1), addDays(today, days)).forEach(function (d) {
        const eff = item.type === 'income' && delay > 0 ? addDays(d, delay) : d;
        const off = diffDays(today, eff);
        if (off < 1 || off > days) return;
        change[off] += item.type === 'income' ? item.amount : -item.amount;
      });
    });

    let bal = currentBalance(data, today) + change[0];
    const points = [{ date: today, balance: bal }];
    for (let i = 1; i <= days; i++) {
      bal += change[i] - avg;
      points.push({ date: addDays(today, i), balance: bal });
    }

    const reserve = Number(data.settings.reserve) || 0;
    let lowest = points[0];
    let shortfallDate = null;
    let belowReserveDate = null;
    points.forEach(function (p) {
      if (p.balance < lowest.balance) lowest = p;
      if (shortfallDate === null && p.balance < 0) shortfallDate = p.date;
      if (belowReserveDate === null && p.balance < reserve) belowReserveDate = p.date;
    });
    return { points: points, avgDaily: avg, lowest: lowest, end: points[points.length - 1], shortfallDate: shortfallDate, belowReserveDate: belowReserveDate };
  }

  return { iso: iso, addDays: addDays, diffDays: diffDays, occurrences: occurrences, currentBalance: currentBalance, avgDailySpend: avgDailySpend, safeToSpend: safeToSpend, forecast: forecast };
})();

if (typeof module !== 'undefined') module.exports = FinSight;
