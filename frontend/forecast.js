// FinSight calculations. Pure functions: no DOM, no network, easy to test.
// Dates are plain 'YYYY-MM-DD' strings.
const FinSight = (function () {
  function parse(s) {
    const p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function iso(d) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function addDays(s, n) {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function diffDays(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  // All dates an item happens on between from..to (inclusive).
  // Supports: 'none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'
  function occurrences(item, from, to) {
    const repeat = item.repeat || 'none';
    const base = parse(item.date);
    const fromDate = parse(from);
    const toDate = parse(to);

    if (repeat === 'none') {
      return item.date >= from && item.date <= to ? [item.date] : [];
    }

    const out = [];

    if (repeat === 'weekly') {
      let cur = new Date(base);
      // Fast-forward to roughly before 'from' if base is way in the past
      if (cur < fromDate) {
        const diffWeeks = Math.floor((fromDate - cur) / (7 * 86400000));
        if (diffWeeks > 0) cur.setDate(cur.getDate() + diffWeeks * 7);
      }
      while (cur <= toDate) {
        const dStr = iso(cur);
        if (dStr >= from && dStr <= to) out.push(dStr);
        cur.setDate(cur.getDate() + 7);
      }
      return out;
    }

    if (repeat === 'biweekly') {
      let cur = new Date(base);
      if (cur < fromDate) {
        const diff2Weeks = Math.floor((fromDate - cur) / (14 * 86400000));
        if (diff2Weeks > 0) cur.setDate(cur.getDate() + diff2Weeks * 14);
      }
      while (cur <= toDate) {
        const dStr = iso(cur);
        if (dStr >= from && dStr <= to) out.push(dStr);
        cur.setDate(cur.getDate() + 14);
      }
      return out;
    }

    if (repeat === 'monthly') {
      for (let k = 0; k < 1200; k++) {
        const first = new Date(base.getFullYear(), base.getMonth() + k, 1);
        const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const d = iso(new Date(first.getFullYear(), first.getMonth(), Math.min(base.getDate(), lastDay)));
        if (d > to) break;
        if (d >= from) out.push(d);
      }
      return out;
    }

    if (repeat === 'quarterly') {
      for (let k = 0; k < 400; k++) {
        const targetMonth = base.getMonth() + k * 3;
        const first = new Date(base.getFullYear(), targetMonth, 1);
        const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const d = iso(new Date(first.getFullYear(), first.getMonth(), Math.min(base.getDate(), lastDay)));
        if (d > to) break;
        if (d >= from) out.push(d);
      }
      return out;
    }

    if (repeat === 'yearly') {
      for (let k = 0; k < 100; k++) {
        const targetYear = base.getFullYear() + k;
        const lastDay = new Date(targetYear, base.getMonth() + 1, 0).getDate();
        const d = iso(new Date(targetYear, base.getMonth(), Math.min(base.getDate(), lastDay)));
        if (d > to) break;
        if (d >= from) out.push(d);
      }
      return out;
    }

    return item.date >= from && item.date <= to ? [item.date] : [];
  }

  // Opening balance + everything logged up to today.
  function currentBalance(data, today) {
    let b = Number(data.settings?.openingBalance) || 0;
    (data.transactions || []).forEach(function (t) {
      if (t.date <= today) b += t.type === 'income' ? t.amount : -t.amount;
    });
    return b;
  }

  // Average everyday spending per day over the last 30 days.
  function avgDailySpend(data, today) {
    const from = addDays(today, -29);
    let sum = 0;
    (data.transactions || []).forEach(function (t) {
      if (t.type === 'expense' && t.date >= from && t.date <= today) sum += t.amount;
    });
    return sum / 30;
  }

  // Category breakdown of spending over the past N days.
  function categorySpend(data, days = 30, todayStr) {
    const t = todayStr || iso(new Date());
    const from = addDays(t, -(days - 1));
    const breakdown = {};
    let total = 0;

    (data.transactions || []).forEach(function (item) {
      if (item.type === 'expense' && item.date >= from && item.date <= t) {
        const cat = item.category || 'General';
        breakdown[cat] = (breakdown[cat] || 0) + item.amount;
        total += item.amount;
      }
    });

    const categories = Object.keys(breakdown)
      .map(function (cat) {
        const amt = breakdown[cat];
        return {
          category: cat,
          amount: amt,
          percentage: total > 0 ? Math.round((amt / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return { total, categories, days };
  }

  // Safe-to-spend = balance - bills due in next 30 days - reserve (never below 0).
  // opts.extras: [{day, amount}] hypothetical expenses.
  function safeToSpend(data, opts = {}) {
    const today = opts.today || iso(new Date());
    const extras = opts.extras || [];
    let obligations = 0;

    (data.scheduled || []).forEach(function (s) {
      if (s.type !== 'expense') return;
      obligations += occurrences(s, addDays(today, 1), addDays(today, 30)).length * s.amount;
    });

    extras.forEach(function (e) {
      if (e.day <= 30) obligations += e.amount;
    });

    const reserve = Number(data.settings?.reserve) || 0;
    return Math.max(0, currentBalance(data, today) - obligations - reserve);
  }

  // Day-by-day projected balance with optimistic & pessimistic corridors.
  // opts: today, days (7/30/60), extras [{day, amount}], delayIncomeDays
  function forecast(data, opts = {}) {
    const today = opts.today || iso(new Date());
    const days = opts.days || 30;
    const extras = opts.extras || [];
    const delay = opts.delayIncomeDays || 0;
    const avg = avgDailySpend(data, today);
    const change = new Array(days + 1).fill(0);

    extras.forEach(function (e) {
      if (e.day >= 0 && e.day <= days) change[e.day] -= e.amount;
    });

    (data.scheduled || []).forEach(function (item) {
      occurrences(item, addDays(today, 1), addDays(today, days)).forEach(function (d) {
        const eff = item.type === 'income' && delay > 0 ? addDays(d, delay) : d;
        const off = diffDays(today, eff);
        if (off < 1 || off > days) return;
        change[off] += item.type === 'income' ? item.amount : -item.amount;
      });
    });

    let bal = currentBalance(data, today) + change[0];
    let balOpt = bal;
    let balPess = bal;

    const points = [{ date: today, balance: bal }];
    const optimistic = [{ date: today, balance: balOpt }];
    const pessimistic = [{ date: today, balance: balPess }];

    // Optimistic: 15% reduction in everyday spend
    const optDaily = avg * 0.85;
    // Pessimistic: 25% increase in everyday spend (unexpected minor expenses)
    const pessDaily = avg * 1.25;

    for (let i = 1; i <= days; i++) {
      bal += change[i] - avg;
      balOpt += change[i] - optDaily;
      balPess += change[i] - pessDaily;

      const d = addDays(today, i);
      points.push({ date: d, balance: Math.round(bal) });
      optimistic.push({ date: d, balance: Math.round(balOpt) });
      pessimistic.push({ date: d, balance: Math.round(balPess) });
    }

    const reserve = Number(data.settings?.reserve) || 0;
    let lowest = points[0];
    let shortfallDate = null;
    let belowReserveDate = null;

    points.forEach(function (p) {
      if (p.balance < lowest.balance) lowest = p;
      if (shortfallDate === null && p.balance < 0) shortfallDate = p.date;
      if (belowReserveDate === null && p.balance < reserve) belowReserveDate = p.date;
    });

    // Monthly burn rate (scheduled bills due in 30 days + 30 days everyday spend)
    let monthlyBills = 0;
    (data.scheduled || []).forEach(function (s) {
      if (s.type === 'expense') {
        monthlyBills += occurrences(s, addDays(today, 1), addDays(today, 30)).length * s.amount;
      }
    });
    const monthlyBurn = monthlyBills + avg * 30;
    const curBal = currentBalance(data, today);
    const liquidBuffer = Math.max(0, curBal - reserve);
    const runwayMonths = monthlyBurn > 0 ? Number((liquidBuffer / monthlyBurn).toFixed(1)) : 99.9;

    return {
      points: points,
      optimistic: optimistic,
      pessimistic: pessimistic,
      avgDaily: Math.round(avg),
      monthlyBurn: Math.round(monthlyBurn),
      runwayMonths: runwayMonths,
      lowest: lowest,
      end: points[points.length - 1],
      shortfallDate: shortfallDate,
      belowReserveDate: belowReserveDate,
    };
  }

  // Financial Health Score (0 - 100)
  function healthScore(data, today) {
    const t = today || iso(new Date());
    const curBal = currentBalance(data, t);
    const reserve = Number(data.settings?.reserve) || 0;
    const f30 = forecast(data, { today: t, days: 30 });
    const safe = safeToSpend(data, { today: t });

    let score = 0;
    const recommendations = [];

    // 1. Reserve Buffer (Max 30 pts)
    if (reserve > 0) {
      const ratio = curBal / reserve;
      if (ratio >= 2.0) {
        score += 30;
      } else if (ratio >= 1.0) {
        score += Math.round(20 + 10 * (ratio - 1));
      } else if (ratio > 0.5) {
        score += Math.round(10 + 10 * (ratio - 0.5));
        recommendations.push('Top up your safety reserve; current balance is below target.');
      } else {
        score += Math.max(0, Math.round(ratio * 20));
        recommendations.push('Critical: Your balance is far below your minimum reserve.');
      }
    } else {
      score += 20; // Default when no reserve set
      recommendations.push('Set an emergency reserve in Settings to safeguard your finances.');
    }

    // 2. Cash Runway (Max 30 pts)
    if (f30.runwayMonths >= 6) {
      score += 30;
    } else if (f30.runwayMonths >= 3) {
      score += 22;
    } else if (f30.runwayMonths >= 1) {
      score += 14;
      recommendations.push('Your runway is under 3 months. Review discretionary spending.');
    } else {
      score += 5;
      recommendations.push('Urgent: Your liquid runway is less than 30 days.');
    }

    // 3. Shortfall & Solvency (Max 25 pts)
    if (!f30.shortfallDate && !f30.belowReserveDate) {
      score += 25;
    } else if (!f30.shortfallDate && f30.belowReserveDate) {
      score += 15;
      recommendations.push('Balance projected to dip below reserve on ' + f30.belowReserveDate);
    } else {
      score += 0;
      recommendations.push('Deficit warning: Account balance projected below zero on ' + f30.shortfallDate);
    }

    // 4. Safe-to-Spend Liquidity (Max 15 pts)
    if (safe > 0) {
      score += 15;
    } else {
      score += 5;
      recommendations.push('Safe-to-spend is zero. Postpone non-essential purchases.');
    }

    let grade = 'A';
    let status = 'Excellent';
    if (score >= 90) {
      grade = 'A+';
      status = 'Excellent';
    } else if (score >= 75) {
      grade = 'A';
      status = 'Healthy';
    } else if (score >= 60) {
      grade = 'B';
      status = 'Fair';
    } else if (score >= 45) {
      grade = 'C';
      status = 'Caution';
    } else {
      grade = 'D';
      status = 'At Risk';
    }

    if (recommendations.length === 0) {
      recommendations.push('Your cash flow is well-hedged with healthy liquidity reserves!');
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      grade: grade,
      status: status,
      recommendations: recommendations,
      runwayMonths: f30.runwayMonths,
    };
  }

  return {
    iso: iso,
    addDays: addDays,
    diffDays: diffDays,
    occurrences: occurrences,
    currentBalance: currentBalance,
    avgDailySpend: avgDailySpend,
    categorySpend: categorySpend,
    safeToSpend: safeToSpend,
    forecast: forecast,
    healthScore: healthScore,
  };
})();

if (typeof module !== 'undefined') module.exports = FinSight;
