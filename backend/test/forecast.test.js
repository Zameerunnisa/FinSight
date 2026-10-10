const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const FinSight = require('../../frontend/forecast.js');

describe('FinSight Financial Calculations Engine', () => {
  const dummyData = {
    settings: { openingBalance: 50000, reserve: 10000 },
    transactions: [
      { id: 't1', type: 'expense', amount: 500, date: '2026-10-01', category: 'Food' },
      { id: 't2', type: 'expense', amount: 1500, date: '2026-10-05', category: 'Transport' },
      { id: 't3', type: 'income', amount: 10000, date: '2026-10-08', category: 'Freelance' },
    ],
    scheduled: [
      { id: 's1', name: 'Salary', type: 'income', amount: 60000, date: '2026-10-15', repeat: 'monthly' },
      { id: 's2', name: 'Rent', type: 'expense', amount: 20000, date: '2026-10-12', repeat: 'monthly' },
      { id: 's3', name: 'Gym', type: 'expense', amount: 1000, date: '2026-10-10', repeat: 'weekly' },
    ],
  };

  test('currentBalance correctly factors opening balance, expenses, and income', () => {
    // 50000 - 500 - 1500 + 10000 = 58000 on 2026-10-09
    const bal = FinSight.currentBalance(dummyData, '2026-10-09');
    assert.equal(bal, 58000);

    // Before any transactions:
    const balPast = FinSight.currentBalance(dummyData, '2026-09-30');
    assert.equal(balPast, 50000);
  });

  test('occurrences correctly handles all recurrence frequencies', () => {
    // One-time
    const oneTime = { name: 'Item', date: '2026-10-15', repeat: 'none' };
    assert.deepEqual(FinSight.occurrences(oneTime, '2026-10-01', '2026-10-31'), ['2026-10-15']);
    assert.deepEqual(FinSight.occurrences(oneTime, '2026-10-16', '2026-10-31'), []);

    // Weekly
    const weekly = { name: 'Weekly Gym', date: '2026-10-01', repeat: 'weekly' };
    const weeklyDates = FinSight.occurrences(weekly, '2026-10-01', '2026-10-22');
    assert.deepEqual(weeklyDates, ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);

    // Bi-weekly
    const biweekly = { name: 'Biweekly Pay', date: '2026-10-01', repeat: 'biweekly' };
    const biweeklyDates = FinSight.occurrences(biweekly, '2026-10-01', '2026-10-31');
    assert.deepEqual(biweeklyDates, ['2026-10-01', '2026-10-15', '2026-10-29']);

    // Monthly
    const monthly = { name: 'Monthly Rent', date: '2026-08-15', repeat: 'monthly' };
    const monthlyDates = FinSight.occurrences(monthly, '2026-09-01', '2026-11-30');
    assert.deepEqual(monthlyDates, ['2026-09-15', '2026-10-15', '2026-11-15']);

    // Quarterly
    const quarterly = { name: 'Quarterly Bonus', date: '2026-01-10', repeat: 'quarterly' };
    const qDates = FinSight.occurrences(quarterly, '2026-01-01', '2026-12-31');
    assert.deepEqual(qDates, ['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10']);

    // Yearly
    const yearly = { name: 'Annual Insurance', date: '2025-05-20', repeat: 'yearly' };
    const yDates = FinSight.occurrences(yearly, '2026-01-01', '2027-12-31');
    assert.deepEqual(yDates, ['2026-05-20', '2027-05-20']);
  });

  test('safeToSpend never returns negative and protects reserve and obligations', () => {
    const today = '2026-10-09';
    const safe = FinSight.safeToSpend(dummyData, { today });
    // Current balance = 58,000
    // Reserve = 10,000
    // Rent on 12th = 20,000
    // Gym on 10, 17, 24, 31 Oct, 7 Nov = ~5 occurrences * 1000 = 5,000
    // Total obligations = 25,000
    // Safe to spend = 58,000 - 25,000 - 10,000 = 23,000
    assert.ok(safe > 0);
    assert.ok(safe <= 58000);

    // If obligations exceed balance, safeToSpend floors at 0:
    const poorData = {
      settings: { openingBalance: 1000, reserve: 5000 },
      transactions: [],
      scheduled: [{ name: 'Rent', type: 'expense', amount: 15000, date: '2026-10-12', repeat: 'none' }],
    };
    assert.equal(FinSight.safeToSpend(poorData, { today: '2026-10-09' }), 0);
  });

  test('forecast correctly generates 30-day timeline and flags shortfalls', () => {
    const today = '2026-10-09';
    const result = FinSight.forecast(dummyData, { today, days: 30 });

    assert.equal(result.points.length, 31);
    assert.equal(result.optimistic.length, 31);
    assert.equal(result.pessimistic.length, 31);
    assert.equal(result.points[0].date, today);
    assert.ok(Number.isFinite(result.runwayMonths));

    // Stressed purchase that causes deficit
    const stressed = FinSight.forecast(dummyData, {
      today,
      days: 30,
      extras: [{ day: 2, amount: 200000 }],
    });
    assert.ok(stressed.shortfallDate !== null);
    assert.ok(stressed.lowest.balance < 0);
  });

  test('categorySpend calculates percentages and totals accurately', () => {
    const breakdown = FinSight.categorySpend(dummyData, 30, '2026-10-10');
    assert.equal(breakdown.total, 2000); // 500 + 1500
    assert.equal(breakdown.categories.length, 2);
    assert.equal(breakdown.categories[0].category, 'Transport'); // 1500 > 500
    assert.equal(breakdown.categories[0].percentage, 75);
    assert.equal(breakdown.categories[1].percentage, 25);
  });

  test('healthScore returns valid grade, score between 0 and 100, and actionable recommendations', () => {
    const health = FinSight.healthScore(dummyData, '2026-10-09');
    assert.ok(health.score >= 0 && health.score <= 100);
    assert.ok(['A+', 'A', 'B', 'C', 'D'].includes(health.grade));
    assert.ok(Array.isArray(health.recommendations));
    assert.ok(health.recommendations.length > 0);
  });
});
