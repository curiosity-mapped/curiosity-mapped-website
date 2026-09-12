/*
 * Unit tests for the loan calculator's arithmetic.
 *
 * Zero dependencies: `node --test "tests/**\/*.test.mjs"`.
 *
 * The file loads docs/js/loan.js itself, through the `typeof module` guard at
 * the end of that file, so what is tested is the code the browser runs rather
 * than a second copy of the mathematics living here.
 *
 * Every expected value below was derived independently -- by hand, or with an
 * arbitrary-precision decimal implementation written for the purpose -- and
 * never by running the implementation and recording what it said. That
 * distinction is the whole value of the file. tests/compound.test.mjs states the
 * same rule and explains what went wrong on the page that taught it.
 *
 * No source research document was supplied for this page. Nothing here is taken
 * on trust from one if it appears later: the figures in this file are the
 * reference, and a document that disagrees with them is the thing that is wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../docs/js/loan.js');
const M = require('../docs/js/mortgage.js');

/* The three lines every case repeats: annual percent in, rounded payment out. */
const periodic = (annualPercent, f) => annualPercent / 100 / f;
const round2 = (x) => Math.round(x * 100) / 100;
const pay = (P, annualPercent, years, f = 12) =>
  round2(L.payment(P, periodic(annualPercent, f), Math.round(years * f)));

const model = (over = {}) =>
  L.buildModel({ principal: 25000, ratePct: 7, years: 5, frequencyKey: '12', extra: null, ...over });

const sched = (P, annualPercent, years, f = 12, extraCents = 0) => {
  const i = periodic(annualPercent, f);
  const n = Math.round(years * f);
  return L.buildSchedule(P, i, n, round2(L.payment(P, i, n)), extraCents);
};

const sumBy = (rows, key) => rows.reduce((a, r) => a + r[key], 0);

/* ================================================================
 * The payment
 * ================================================================ */

test('payment: the four reference scenarios', () => {
  /* Computed to 50 significant digits with an independent decimal
     implementation, then rounded here to the six places the assertion needs. */
  assert.equal(L.payment(25000, 0.07 / 12, 60).toFixed(6), '495.029964');
  assert.equal(L.payment(10000, 0.10 / 12, 36).toFixed(6), '322.671872');
  assert.equal(L.payment(400000, 0.065 / 12, 360).toFixed(6), '2528.272094');
  assert.equal(L.payment(500, 0.2499 / 12, 6).toFixed(6), '89.511590');

  assert.equal(pay(25000, 7, 5), 495.03);
  assert.equal(pay(10000, 10, 3), 322.67);
  assert.equal(pay(400000, 6.5, 30), 2528.27);
  assert.equal(pay(500, 24.99, 0.5), 89.51);
});

test('payment: agrees with the mortgage engine where the two overlap', () => {
  /* Two sibling pages that disagreed about one formula would be a cost paid by
     the reader. At f = 12 these are the same calculation and must stay so. */
  for (const [P, ratePct, years] of [[10000, 10, 3], [400000, 6.5, 30], [320000, 6, 30]]) {
    const i = periodic(ratePct, 12);
    const n = years * 12;
    assert.ok(Math.abs(L.payment(P, i, n) - M.monthlyPayment(P, i, n)) < 1e-9,
      `loan and mortgage engines must agree: ${P} at ${ratePct}% over ${years}y`);
  }
});

test('payment: the two algebraic forms agree', () => {
  /* The page mentions the growth form in prose as the one readers meet
     elsewhere. If it were not identical, saying so would be a lie. */
  for (const [P, i, n] of [[25000, 0.07 / 12, 60], [1000, 0.3 / 26, 520], [400000, 0.065 / 12, 360]]) {
    const growth = P * i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1);
    assert.ok(Math.abs(L.payment(P, i, n) - growth) < 1e-6, `forms must agree at ${P}/${i}/${n}`);
  }
});

test('payment: zero and near-zero interest divide the principal', () => {
  assert.equal(L.payment(25000, 0, 60), 25000 / 60);
  /* NEAR_ZERO_RATE is 1e-9, and the threshold exists because the closed form
     loses all significance in its own denominator below it. */
  assert.equal(L.payment(25000, 1e-10, 60), 25000 / 60);
  assert.ok(L.payment(25000, 1e-8, 60) > 25000 / 60, 'above the threshold the formula runs');
});

test('payment: returns NaN rather than Infinity on impossible inputs', () => {
  for (const [P, i, n] of [[0, 0.01, 60], [-1, 0.01, 60], [25000, 0.01, 0], [25000, 0.01, -1]]) {
    assert.ok(Number.isNaN(L.payment(P, i, n)), `expected NaN for ${P}/${i}/${n}`);
  }
});

test('payment: a one-payment loan does not leak its float artefact', () => {
  /* $1,000 at 12% for one month is exactly $1,010. The double is
     1009.9999999999991, and the page must never show that. */
  const raw = L.payment(1000, 0.01, 1);
  assert.equal(raw, 1009.9999999999991);
  assert.equal(L.money(round2(raw)), '$1,010.00');
});

/* ================================================================
 * The schedule
 * ================================================================ */

test('schedule: the reference scenario, row for row', () => {
  const s = sched(25000, 7, 5);
  assert.equal(s.count, 60);

  /* Independently computed, in integer cents. */
  const expected = {
    1: [49503, 14583, 34920, 2465080],
    2: [49503, 14380, 35123, 2429957],
    30: [49503, 8167, 41336, 1358782],
    60: [49505, 287, 49218, 0]
  };
  for (const k of Object.keys(expected)) {
    const r = s.rows[Number(k) - 1];
    const [paid, interest, principal, balance] = expected[k];
    assert.equal(r.paymentCents, paid, `payment ${k} amount`);
    assert.equal(r.interestCents, interest, `payment ${k} interest`);
    assert.equal(r.principalCents, principal, `payment ${k} principal`);
    assert.equal(r.balanceCents, balance, `payment ${k} balance`);
  }

  assert.equal(s.totalPaidCents, 2970182);
  assert.equal(s.totalInterestCents, 470182);
  assert.equal(s.finalPaymentCents, 49505);
});

test('schedule: total paid is read off the schedule, never from n times M', () => {
  /*
   * This is a two-cent difference, and it is pinned so the distinction cannot
   * silently regress. 60 payments of $495.03 is $29,701.80; the schedule totals
   * $29,701.82, because the last payment absorbs the rounding. A headline that
   * disagreed with its own table by two cents would undermine the whole page.
   */
  const s = sched(25000, 7, 5);
  assert.equal(s.totalPaidCents, 2970182);
  assert.equal(49503 * 60, 2970180);
  assert.notEqual(s.totalPaidCents, 49503 * 60);
  assert.equal(s.totalPaidCents - 49503 * 60, 2);
});

test('schedule: the identity that makes the table readable', () => {
  const s = sched(25000, 7, 5);
  for (const r of s.rows) {
    assert.equal(r.interestCents + r.principalCents, r.paymentCents,
      `payment ${r.n}: interest plus principal must equal the payment exactly`);
  }
  assert.equal(sumBy(s.rows, 'principalCents'), L.toCents(25000));
  assert.equal(sumBy(s.rows, 'interestCents'), s.totalInterestCents);
  assert.equal(sumBy(s.rows, 'paymentCents'), s.totalPaidCents);
  assert.equal(s.totalInterestCents + L.toCents(25000), s.totalPaidCents);
});

test('schedule: zero interest is the principal divided n ways', () => {
  const s = sched(25000, 0, 5);
  assert.equal(s.totalInterestCents, 0);
  assert.equal(s.totalPaidCents, L.toCents(25000));
  for (const r of s.rows) assert.equal(r.interestCents, 0, `row ${r.n} carries no interest`);
});

test('schedule: is bounded by MAX_PAYMENTS', () => {
  assert.equal(L.MAX_PAYMENTS, 2080);
  const s = L.buildSchedule(25000, 0.07 / 52, 5000, 50, 0);
  assert.ok(s.rows.length <= L.MAX_PAYMENTS, 'never longer than the cap');
});

/* ================================================================
 * The degenerate case: a loan that does not amortize
 *
 * As n grows, M tends to P*i from above. Once rounded to cents it can equal the
 * first period's interest exactly, at which point principal is zero forever and
 * a `while (balance > 0)` loop never terminates. This is not a theoretical
 * hazard: a sweep of realistic inputs finds it in thousands of combinations.
 * ================================================================ */

test('degenerate: a payment that equals the first interest still terminates', () => {
  /* $1,000 at 30% over 31 years monthly. M rounds to $25.00 and the first
     month's interest is exactly $25.00. Independently confirmed. */
  const s = sched(1000, 30, 31);
  assert.equal(L.toCents(pay(1000, 30, 31)), 2500);
  assert.equal(s.rows[0].interestCents, 2500);
  assert.equal(s.rows[0].principalCents, 0, 'nothing comes off the balance');

  /* The loop is bounded by n, so it ends; the residual falls due on the last
     row, which is the honest depiction rather than a hidden failure. */
  assert.equal(s.count, 372);
  assert.equal(s.rows[s.rows.length - 1].balanceCents, 0);
  assert.equal(s.finalPaymentCents, 102500);

  const m = model({ principal: 1000, ratePct: 30, years: 31 });
  assert.equal(m.doesNotAmortize, true, 'the model flags it so the panel can warn');
  assert.equal(m.finalPaymentOutsized, true);
});

test('degenerate: a tiny payment on a long weekly term still terminates', () => {
  /* $100 at 5% over 40 years weekly: a ten-cent payment and a final payment
     many times its size. Capping the term contains it; the warning names it. */
  const m = model({ principal: 100, ratePct: 5, years: 40, frequencyKey: '52' });
  assert.ok(m.count <= L.MAX_PAYMENTS);
  assert.equal(m.schedule.rows[m.schedule.rows.length - 1].balanceCents, 0);
  assert.ok(Number.isFinite(m.totalPaidCents));
});

/* ================================================================
 * Payment frequency
 * ================================================================ */

test('frequency: the four cadences, asserted exactly', () => {
  /*
   * $25,000 at 7% over 5 years. Every figure independently computed. The point
   * of asserting all of it is that this table is the evidence for the claim the
   * page makes in prose, and prose whose evidence drifts becomes a lie quietly.
   *
   *   cadence        n   payment   paid/yr    interest     EAR       final
   *   Monthly       60   $495.03  $5,940.36  $4,701.82  7.2290%    $495.03+
   *   Semimonthly  120   $247.21  $5,933.04  $4,665.88  7.2399%
   *   Biweekly     130   $228.18  $5,932.68  $4,662.85  7.2407%
   *   Weekly       260   $114.02  $5,929.04  $4,646.62  7.2458%
   */
  const expected = {
    '12': { n: 60, payment: 49503, paidPerYear: 594036, interest: 470182, final: 49505, ear: '7.2290%' },
    '24': { n: 120, payment: 24721, paidPerYear: 593304, interest: 466588, final: 24789, ear: '7.2399%' },
    '26': { n: 130, payment: 22818, paidPerYear: 593268, interest: 466285, final: 22763, ear: '7.2407%' },
    '52': { n: 260, payment: 11402, paidPerYear: 592904, interest: 464662, final: 11544, ear: '7.2458%' }
  };

  const rows = L.frequencyTable(25000, 7, 5);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const e = expected[row.key];
    assert.ok(e, `unexpected cadence ${row.key}`);
    assert.equal(row.n, e.n, `${row.freq.label}: payment count`);
    assert.equal(row.paymentCents, e.payment, `${row.freq.label}: payment`);
    assert.equal(row.paidPerYearCents, e.paidPerYear, `${row.freq.label}: paid per year`);
    assert.equal(row.totalInterestCents, e.interest, `${row.freq.label}: total interest`);
    assert.equal(row.finalPaymentCents, e.final, `${row.freq.label}: final payment`);
    assert.equal(L.pctEar(row.ear), e.ear, `${row.freq.label}: effective annual rate`);
  }
});

test('frequency: the annual outlay is what the prose claims it is', () => {
  /*
   * The page's central sentence about cadence is that changing when you pay
   * barely changes anything, because you pay about the same each year. That is
   * a quantitative claim and this is its test: $11.32 across a $5,935 outlay.
   *
   * Without it, a reader comparing only the interest column would conclude that
   * paying weekly saves $55.20, which is false -- those are four different
   * contracts, not one loan at four cadences.
   */
  const paid = L.frequencyTable(25000, 7, 5).map((r) => r.paidPerYearCents);
  const spread = Math.max(...paid) - Math.min(...paid);
  assert.equal(spread, 1132, 'the annual outlay spread is $11.32');
  assert.ok(spread < 1200, 'the prose says the cadences pay about the same each year');

  const interest = L.frequencyTable(25000, 7, 5).map((r) => r.totalInterestCents);
  assert.equal(Math.max(...interest) - Math.min(...interest), 5520, 'the interest spread is $55.20');
});

test('frequency: interest falls as f rises while the effective rate rises', () => {
  /*
   * A DOCUMENTED EXCEPTION, and the reason this test exists is to pin that it
   * is understood rather than to guard a desirable property.
   *
   * Under i = r/f the nominal rate is not frequency-neutral: the effective
   * annual rate rises with f. At a fixed term in years, more frequent payments
   * also retire principal faster, so total interest falls. Both are true at
   * once, and neither is a saving. Nobody should later "fix" this into a claim
   * that weekly payments are cheaper.
   */
  const rows = L.frequencyTable(25000, 7, 5);
  for (let k = 1; k < rows.length; k++) {
    assert.ok(rows[k].ear > rows[k - 1].ear,
      `effective annual rate must rise with f: ${rows[k].freq.label}`);
    assert.ok(rows[k].totalInterestCents < rows[k - 1].totalInterestCents,
      `total interest must fall as f rises: ${rows[k].freq.label}`);
  }
});

test('frequency: every cadence is fully described, and none is hardcoded', () => {
  assert.equal(L.FREQUENCIES.length, 4);
  for (const f of L.FREQUENCIES) {
    for (const field of ['key', 'f', 'label', 'adverb', 'adjective', 'period', 'each']) {
      assert.ok(f[field] != null && f[field] !== '', `${f.key} must carry ${field}`);
    }
    assert.equal(L.frequency(f.key), f, 'lookup by key round-trips');
    assert.equal(L.frequency(Number(f.key)), f, 'lookup coerces a number key');
  }
  assert.deepEqual(L.FREQUENCIES.map((f) => f.f), [12, 24, 26, 52]);
  /* Semimonthly and biweekly are not the same thing, and the select carries both
     precisely so that the page can say so. */
  assert.notEqual(L.frequency('24').f, L.frequency('26').f);
  assert.equal(L.frequency('nonsense'), null);
});

test('frequency: the day-count fact #assumptions has to disclose', () => {
  /*
   * 26 biweekly payments span 26 x 14 = 364 days, and 52 weekly payments span
   * 52 x 7 = 364. A year is 365.2425 days, so "5 years" at either cadence is
   * really 4.983 years. The model treats n = years * f as exact and the page
   * must say so; this pins which cadences the disclosure applies to.
   */
  assert.equal(L.frequency('12').calendarExact, true);
  assert.equal(L.frequency('24').calendarExact, true);
  assert.equal(L.frequency('26').calendarExact, false);
  assert.equal(L.frequency('52').calendarExact, false);
  assert.equal(26 * L.frequency('26').daysPerPeriod, 364);
  assert.equal(52 * L.frequency('52').daysPerPeriod, 364);
  assert.equal((5 * 364 / 365.2425).toFixed(3), '4.983');
});

/* ================================================================
 * The yearly rollup
 * ================================================================ */

test('yearly: groups by the cadence, not by a hardcoded twelve', () => {
  for (const [key, f] of [['12', 12], ['24', 24], ['26', 26], ['52', 52]]) {
    const m = model({ frequencyKey: key });
    assert.equal(m.yearly.length, 5, `${key}: five years of rows`);
    for (const y of m.yearly) {
      assert.equal(y.payments, f, `${key}: year ${y.year} holds ${f} payments`);
    }
    assert.equal(m.yearly[m.yearly.length - 1].endingBalanceCents, 0);
    assert.equal(sumBy(m.yearly, 'principalCents'), L.toCents(25000));
    assert.equal(sumBy(m.yearly, 'interestCents'), m.totalInterestCents);
  }
});

/* ================================================================
 * balanceAfter: the closed form the prose cites
 * ================================================================ */

test('balanceAfter: tracks the schedule it does not build', () => {
  const m = model();
  for (const k of [1, 12, 30, 48, 59]) {
    const closed = L.balanceAfter(25000, m.periodicRate, 60, m.payment, k);
    const actual = L.fromCents(m.schedule.rows[k - 1].balanceCents);
    assert.ok(Math.abs(closed - actual) < 0.05,
      `payment ${k}: closed form ${closed} against schedule ${actual}`);
  }
  assert.equal(L.balanceAfter(25000, 0, 60, 25000 / 60, 60), 0);
});

/* ================================================================
 * The matrix sweep. Four dimensions, because frequency is a variable here.
 * ================================================================ */

test('schedule: invariants hold across a matrix of inputs', () => {
  const rates = [0, 0.0001, 1, 5, 7, 12, 25, 36, 60];
  const terms = [0.5, 1, 3, 5, 7, 10, 30, 40];
  const principals = [100, 1000, 25000, 400000, 5000000];
  const cadences = ['12', '24', '26', '52'];

  for (const P of principals) {
    for (const ratePct of rates) {
      for (const years of terms) {
        for (const key of cadences) {
          const f = L.frequency(key).f;
          const n = Math.round(years * f);
          if (n > L.MAX_PAYMENTS) continue;
          const label = `${P} at ${ratePct}% over ${years}y ${key}/yr`;

          const m = L.buildModel({ principal: P, ratePct, years, frequencyKey: key, extra: null });
          const s = m.schedule;

          assert.equal(sumBy(s.rows, 'principalCents'), L.toCents(P), `principal must sum to P: ${label}`);
          assert.equal(sumBy(s.rows, 'interestCents'), s.totalInterestCents, `interest column: ${label}`);
          assert.equal(sumBy(s.rows, 'paymentCents'), s.totalPaidCents, `paid column: ${label}`);
          assert.equal(s.totalInterestCents + L.toCents(P), s.totalPaidCents, `totals identity: ${label}`);
          assert.equal(s.rows[s.rows.length - 1].balanceCents, 0, `pays off exactly: ${label}`);
          assert.ok(s.count <= n, `never longer than n: ${label}`);
          assert.ok(s.count >= 1, `always at least one row: ${label}`);

          let previous = Infinity;
          for (let k = 0; k < s.rows.length; k++) {
            const r = s.rows[k];
            assert.equal(r.interestCents + r.principalCents, r.paymentCents, `row ${r.n} identity: ${label}`);
            assert.ok(r.balanceCents >= 0, `row ${r.n} balance is never negative: ${label}`);
            assert.ok(r.balanceCents <= previous, `row ${r.n} balance never rises: ${label}`);
            previous = r.balanceCents;
            if (k < s.rows.length - 1) {
              assert.equal(r.paymentCents, m.paymentCents, `row ${r.n} carries the level payment: ${label}`);
            }
          }

          assert.ok(Math.abs(m.payment - m.unroundedPayment) <= 0.005, `rounding: ${label}`);

          for (const field of ['payment', 'periodicRate', 'ear', 'totalPaidCents', 'totalInterestCents']) {
            assert.ok(Number.isFinite(m[field]), `${field} must be finite: ${label}`);
          }
          for (const s2 of [L.money(m.payment), L.moneyCents(m.totalPaidCents),
            L.moneyCents(m.totalInterestCents), L.pctEar(m.ear), L.pctSig(m.periodicRate),
            L.integer(m.n), L.payoffText(m.count, f), L.durationText(years)]) {
            assert.ok(!/NaN|Infinity|∞/.test(s2), `formatted output must be clean: ${label} -> ${s2}`);
          }
        }
      }
    }
  }
});

/* ================================================================
 * Monotonicity. Every one of these was run across the sweep during design and
 * held without exception; they are assertions so that stays true.
 * ================================================================ */

test('sanity: the payment moves the way the page says it does', () => {
  const at = (over) => model(over).payment;

  let previous = 0;
  for (const principal of [1000, 5000, 25000, 100000, 400000]) {
    const p = at({ principal });
    assert.ok(p > previous, `payment rises with principal at ${principal}`);
    previous = p;
  }

  previous = 0;
  for (const ratePct of [0, 1, 5, 7, 12, 25, 36, 60]) {
    const p = at({ ratePct });
    assert.ok(p > previous, `payment rises with rate at ${ratePct}%`);
    previous = p;
  }

  previous = Infinity;
  let interest = 0;
  for (const years of [1, 3, 5, 10, 20, 30, 40]) {
    const m = model({ years });
    assert.ok(m.payment < previous, `payment falls as the term lengthens at ${years}y`);
    assert.ok(m.totalInterestCents > interest, `total interest rises with the term at ${years}y`);
    previous = m.payment;
    interest = m.totalInterestCents;
  }
});

test('sanity: at zero interest a longer term saves nothing', () => {
  /*
   * The mortgage suite enforces the analogue, and the reason is the same: a term
   * comparison that claims a saving when total interest is zero at every term is
   * the single easiest false sentence to write on a page like this.
   */
  let previous = -1;
  for (const years of [1, 5, 10, 30, 40]) {
    const m = model({ ratePct: 0, years });
    assert.equal(m.totalInterestCents, 0, `zero rate, zero interest at ${years}y`);
    assert.equal(m.totalPaidCents, L.toCents(25000), `zero rate, total equals principal at ${years}y`);
    assert.ok(m.totalInterestCents >= previous, 'never claim a saving that does not exist');
    previous = m.totalInterestCents;
  }
});

/* ================================================================
 * Extra payments
 * ================================================================ */

test('extras: zero extra is identical to no extra', () => {
  const none = model({ extra: null });
  const zero = model({ extra: 0 });
  assert.equal(zero.extraCents, 0);
  assert.equal(zero.totalPaidCents, none.totalPaidCents);
  assert.equal(zero.totalInterestCents, none.totalInterestCents);
  assert.equal(zero.count, none.count);
});

test('extras: never increase interest and never lengthen the term', () => {
  for (const extra of [1, 25, 100, 500, 5000]) {
    for (const key of ['12', '26']) {
      const base = model({ frequencyKey: key, extra: null });
      const m = model({ frequencyKey: key, extra });
      assert.ok(m.totalInterestCents <= base.totalInterestCents,
        `extra ${extra} at ${key}/yr must not raise interest`);
      assert.ok(m.count <= base.count, `extra ${extra} at ${key}/yr must not lengthen the term`);
      assert.equal(sumBy(m.schedule.rows, 'principalCents'), L.toCents(25000),
        `extra ${extra} at ${key}/yr still retires exactly the principal`);
      assert.ok(m.interestSavedCents >= 0);
      assert.ok(m.periodsSaved >= 0);
    }
  }
});

test('extras: the biweekly trick, which is a bigger payment and not a cadence', () => {
  /*
   * The thing people mean by "biweekly saves money": paying half the monthly
   * payment every two weeks makes 26 payments a year, which is thirteen monthly
   * payments' worth. Independently computed, and the numbers the page quotes.
   *
   * Half of $495.03 is $247.52 (rounded up from $247.515). The biweekly level
   * payment at this loan is $228.18, so the extra is $19.34 a period.
   */
  const m = model({ frequencyKey: '26', extra: 247.52 - 228.18 });
  assert.equal(m.paymentCents + m.extraCents, 24752, 'the period payment is half the monthly one');
  assert.equal(m.count, 119, 'retired in 119 payments');
  assert.equal(m.totalInterestCents, 421577, 'total interest is $4,215.77');

  const base = model();
  assert.equal(base.totalInterestCents - m.totalInterestCents, 48605, 'saves $486.05');
  assert.equal((119 / 26).toFixed(2), '4.58', 'and 4.58 years rather than 5');

  /* The saving comes from paying more, not from paying more often. This is the
     assertion that keeps the page honest about which it is. */
  assert.equal(24752 * 26 - base.paymentCents * 12, 49516, 'it costs $495.16 more per year');
  assert.ok(24752 * 26 > base.paymentCents * 12, 'the annual outlay is strictly larger');
});

/* ================================================================
 * parseNumber
 * ================================================================ */

test('parseNumber: accepts what a reader would paste', () => {
  assert.equal(L.parseNumber('25000'), 25000);
  assert.equal(L.parseNumber('$25,000.00'), 25000);
  assert.equal(L.parseNumber(' 25 000 '), 25000);
  assert.equal(L.parseNumber('7%'), 7);
  assert.equal(L.parseNumber('+7'), 7);
  assert.equal(L.parseNumber('-7'), -7);
  assert.equal(L.parseNumber('0'), 0);
  assert.equal(L.parseNumber('.5'), 0.5);
  assert.equal(L.parseNumber(' 1,234.56'), 1234.56);
});

test('parseNumber: rejects everything parseFloat would wave through', () => {
  for (const input of ['', '   ', 'abc', '12abc', 'Infinity', '-Infinity', 'NaN', '1e999',
    '1.2.3', '--5', null, undefined, 12, {}, [], true, NaN]) {
    assert.equal(L.parseNumber(input), null, `must reject ${JSON.stringify(input)}`);
  }
  /* The specific case the function exists for. */
  assert.equal(parseFloat('12abc'), 12);
  assert.equal(L.parseNumber('12abc'), null);
});

test('model: an invalid principal produces NaN, never Infinity', () => {
  for (const principal of [0, -1]) {
    const m = L.buildModel({ principal, ratePct: 7, years: 5, frequencyKey: '12', extra: null });
    assert.ok(Number.isNaN(m.unroundedPayment), `${principal} must give NaN`);
    assert.ok(!Number.isFinite(m.unroundedPayment) && !(m.unroundedPayment === Infinity),
      `${principal} must never give Infinity`);
  }
});

/* ================================================================
 * Formatting and grammar
 * ================================================================ */

test('formatting: the exact strings the page prints', () => {
  assert.equal(L.money(495.03), '$495.03');
  assert.equal(L.money(29701.82), '$29,701.82');
  assert.equal(L.moneyCents(2970182), '$29,701.82');
  assert.equal(L.moneyWhole(25000), '$25,000');
  assert.equal(L.moneyNatural(25000), '$25,000');
  assert.equal(L.moneyNatural(495.03), '$495.03');
  assert.equal(L.moneyNaturalCents(2500000), '$25,000');
  assert.equal(L.moneyNaturalCents(49503), '$495.03');
  assert.equal(L.pctTrim(0.07), '7%');
  assert.equal(L.pctTrim(0.07125), '7.125%');
  assert.equal(L.pctEar(0.0722900), '7.2290%');
  assert.equal(L.pctSig(0.07 / 12), '0.5833%');
  assert.equal(L.pctSig(0.07 / 26), '0.2692%');
  assert.equal(L.integer(2080), '2,080');
  assert.equal(L.numTrim(4.5769), '4.58');
  assert.equal(L.moneySigned(0), '$0.00');
  assert.equal(L.moneySigned(1234), '+$12.34');
  assert.equal(L.moneySigned(-1234), '−$12.34');
});

test('grammar: joinList and plural at their boundaries', () => {
  assert.equal(L.joinList([]), '');
  assert.equal(L.joinList(['one']), 'one');
  assert.equal(L.joinList(['one', 'two']), 'one and two');
  assert.equal(L.joinList(['one', 'two', 'three']), 'one, two, and three');
  assert.equal(L.joinList(['one', 'two', 'three', 'four']), 'one, two, three, and four');
  assert.equal(L.plural(1, 'payment'), 'payment');
  assert.equal(L.plural(0, 'payment'), 'payments');
  assert.equal(L.plural(2, 'payment'), 'payments');
  assert.equal(L.plural(1, 'year'), 'year');
});

test('grammar: durations read the way a person says them', () => {
  assert.equal(L.durationText(1), '1 year');
  assert.equal(L.durationText(5), '5 years');
  assert.equal(L.durationText(0.5), '0.5 years');
  assert.equal(L.payoffText(60, 12), '5 years');
  assert.equal(L.payoffText(119, 26), '4 years and 7 months');
  assert.equal(L.payoffText(12, 12), '1 year');
  assert.equal(L.payoffText(6, 12), '6 months');
  assert.equal(L.payoffText(1, 12), '1 month');
  assert.equal(L.payoffText(1, 52), 'under a month');
  /* The rounding must never produce "4 years and 12 months". */
  for (let count = 1; count <= 2080; count++) {
    for (const f of [12, 24, 26, 52]) {
      assert.ok(!/12 months/.test(L.payoffText(count, f)), `${count}/${f} must roll over`);
    }
  }
});

/* ================================================================
 * Chart geometry
 * ================================================================ */

test('charts: paths are well formed and stay inside the frame', () => {
  assert.equal(L.CHART_W, 640);
  assert.equal(L.CHART_H, 240);

  for (const key of ['12', '26', '52']) {
    for (const ratePct of [0, 7, 36]) {
      const m = model({ frequencyKey: key, ratePct });
      const balances = [m.principal].concat(m.yearly.map((y) => L.fromCents(y.endingBalanceCents)));
      const max = m.principal;
      const label = `${key}/yr at ${ratePct}%`;

      for (const d of [L.seriesLine(balances, max), L.seriesArea(balances, max),
        L.seriesBand(balances.map(() => 0), balances, max)]) {
        assert.match(d, /^M-?[\d.]+,-?[\d.]+/, `path starts with a moveto: ${label}`);
        assert.ok(!/NaN|Infinity/.test(d), `path has no non-finite coordinate: ${label}`);
        for (const [, x, y] of d.matchAll(/([-\d.]+),([-\d.]+)/g)) {
          assert.ok(Number(x) >= 0 && Number(x) <= L.CHART_W, `x in frame: ${label}`);
          assert.ok(Number(y) >= 0 && Number(y) <= L.CHART_H, `y in frame: ${label}`);
        }
      }
    }
  }

  assert.equal(L.seriesLine([], 100), '');
  assert.equal(L.seriesArea([], 100), '');
  assert.equal(L.seriesBand([], [], 100), '');
  /* A single point has no span to divide by, and must not produce NaN. */
  assert.equal(L.seriesLine([50], 100), 'M0.00,120.00');
});

/* ================================================================
 * The sentence planner
 *
 * These are the tests that keep the page from lying. The arithmetic tests above
 * can all pass while a paragraph says something false about the numbers beside
 * it, and a false sentence next to a correct figure is worse than a wrong figure
 * on its own, because it teaches.
 * ================================================================ */

const SCENARIOS = [
  ['the default scenario', {}],
  ['zero rate', { ratePct: 0 }],
  ['near-zero rate', { ratePct: 1e-8 }],
  ['a single payment', { principal: 1000, ratePct: 12, years: 1 / 12 }],
  ['the degenerate case', { principal: 1000, ratePct: 30, years: 31 }],
  ['semimonthly', { frequencyKey: '24' }],
  ['biweekly', { frequencyKey: '26' }],
  ['weekly', { frequencyKey: '52' }],
  ['an extra payment', { extra: 100 }],
  ['an extra payment, biweekly', { frequencyKey: '26', extra: 19.34 }],
  ['an extra payment at zero rate', { ratePct: 0, extra: 100 }],
  ['a large extra payment', { extra: 5000 }],
  ['the longest term', { years: 40, frequencyKey: '52' }],
  ['the shortest term', { years: 0.5 }],
  ['the rate ceiling', { ratePct: 60 }]
];

test('prose: no scenario produces a malformed sentence', () => {
  for (const [label, over] of SCENARIOS) {
    const m = model(over);
    const paragraphs = L.explainParagraphs(m);
    assert.equal(paragraphs.length, 5, `${label}: five slots, always`);

    for (const p of paragraphs.concat([L.summarySentence(m), L.chartDescription(m)])) {
      assert.equal(typeof p, 'string', `${label}: every slot is a string`);
      if (!p) continue;
      assert.ok(!/NaN|Infinity|undefined|null|∞/.test(p), `${label}: leaked a value -> ${p}`);
      assert.ok(!/ {2}/.test(p), `${label}: doubled space -> ${p}`);
      assert.ok(!/\s+[.,]/.test(p), `${label}: space before punctuation -> ${p}`);
      assert.ok(!/\$\s/.test(p), `${label}: empty money interpolation -> ${p}`);
      assert.ok(/[.?]$/.test(p.trim()), `${label}: unterminated sentence -> ${p}`);
      /* The page ships with no em dashes in copy, and the prose strings are copy
         the same way the markup is. Enforced here as well as over the HTML so a
         sentence added later cannot smuggle one in through the planner. */
      assert.ok(!p.includes('—'), `${label}: em dash in prose -> ${p}`);
    }
  }
});

test('prose: the cadence noun always comes from the model', () => {
  /*
   * The default scenario is monthly, so a hardcoded "monthly" anywhere in the
   * planner would stay invisible until a reader switched the select. This is the
   * test that finds it, and it is why every cadence word lives in FREQUENCIES.
   */
  for (const key of ['24', '26', '52']) {
    const m = model({ frequencyKey: key });
    const text = L.explainParagraphs(m).join(' ') + ' ' + L.summarySentence(m);
    /* Word boundaries matter here: "semimonthly" and "half-month" are the
       semimonthly cadence's own vocabulary, and flagging them would be flagging
       the correct answer. What must not appear is the monthly cadence's words. */
    assert.ok(!/\bmonthly\b|\ba month\b|\beach month\b/.test(text),
      `${key}/yr prose must not say monthly: ${text.match(/[^.]*month[^.]*\./) || ''}`);
    assert.ok(text.includes(m.freq.each) || text.includes(m.freq.adjective),
      `${key}/yr prose must name its own cadence`);
  }
  /* And the monthly scenario still reads as monthly rather than as a period. */
  assert.ok(L.explainParagraphs(model()).join(' ').includes('each month'));
});

test('prose: zero rate replaces the interest clauses rather than filling them', () => {
  /*
   * "$0.00 of interest" in four places is what a template produces. At zero rate
   * the sentences are different sentences.
   */
  const text = L.explainParagraphs(model({ ratePct: 0 })).join(' ');
  assert.ok(!text.includes('$0.00 is interest'), 'must not narrate zero interest as a split');
  assert.ok(!/interest share/.test(text), 'must not describe a share that does not exist');
  assert.ok(text.includes('there is no interest'), 'says plainly that there is none');
  assert.ok(text.includes('all of it principal'), 'and what the total is instead');
  /* Never a saving claim: total interest is zero at every term. */
  assert.ok(!/save|saving|cheaper|less interest/.test(text));
});

test('prose: a one-payment loan does not talk about a later payment', () => {
  const text = L.explainParagraphs(model({ principal: 1000, ratePct: 12, years: 1 / 12 })).join(' ');
  assert.ok(!text.includes('The first payment'), 'there is no first of one');
  assert.ok(!/By payment/.test(text), 'there is no midpoint to move to');
  assert.ok(!/Across all 1 payment/.test(text), 'and that phrase does not read');
  assert.ok(text.includes('The only payment is'), 'it says what it is instead');
});

test('prose: the degenerate case says so instead of describing a schedule', () => {
  const m = model({ principal: 1000, ratePct: 30, years: 31 });
  const text = L.explainParagraphs(m).join(' ');
  assert.equal(m.doesNotAmortize, true);
  assert.ok(text.includes('does not amortize'), 'names what is happening');
  assert.ok(!/interest share has fallen/.test(text), 'does not narrate a fall that never happens');
  assert.ok(text.includes(L.moneyCents(m.finalPaymentCents)), 'and states what comes due');
});

test('prose: an early payoff is never blamed on the wrong cause', () => {
  /*
   * Both of these sentences are true in exactly one case and false in the other,
   * and getting them the wrong way round is the most plausible regression in the
   * whole file: the schedule runs short either because rounding sent a little
   * extra to principal each period, or because the reader paid more. Only one of
   * those is rounding.
   */
  const rounded = model({ principal: 400000, ratePct: 6.5, years: 30 });
  const extra = model({ extra: 100 });

  const roundedText = L.explainParagraphs(rounded).join(' ');
  const extraText = L.explainParagraphs(extra).join(' ');

  assert.ok(extra.count < extra.n, 'the extra payment does retire it early');
  assert.ok(!/rounding the payment up/.test(extraText),
    'an extra payment must never be explained as rounding');
  assert.ok(!/absorbs what rounding/.test(extraText),
    'nor must its short final row be');
  assert.ok(/the extra had brought the balance down/.test(extraText),
    'it is explained as what it is');

  if (rounded.count < rounded.n) {
    assert.ok(/rounding the payment up/.test(roundedText),
      'and rounding is still explained as rounding when that is the cause');
  }
});

test('prose: the extras paragraph appears only when there is something to say', () => {
  assert.equal(L.explainParagraphs(model())[4], '', 'empty without an extra payment');
  assert.equal(L.explainParagraphs(model({ extra: 0 }))[4], '', 'empty at zero');
  assert.equal(L.explainParagraphs(model({ extra: null }))[4], '', 'empty at null');
  assert.ok(L.explainParagraphs(model({ extra: 100 }))[4].length > 0, 'present at 100');
});

test('prose: the extras paragraph says where the saving actually comes from', () => {
  /*
   * The sentence the section exists for. Every extra-payment feature invites the
   * reader to read the saving as something the schedule produced; it is the
   * arithmetic of having paid more, and the page has to say so.
   */
  const m = model({ extra: 100 });
  const p = L.explainParagraphs(m)[4];
  assert.ok(p.includes('comes from paying more, not from paying differently'));
  assert.ok(p.includes(L.moneyCents(m.extraCents * m.f)), 'and states the annual cost of it');
});

test('prose: never claims a saving the model has not computed', () => {
  /*
   * Extended from the mortgage suite's analogue to cover the cadence comparison,
   * which is this page's version of the same trap: total interest falls as f
   * rises, and calling that a saving would be false.
   */
  for (const [label, over] of SCENARIOS) {
    const m = model(over);
    const text = L.explainParagraphs(m).join(' ') + ' ' + L.summarySentence(m);
    if (m.extraCents > 0) continue; /* the one place a saving is computed */
    assert.ok(!/\bsaves\b|\bsaving\b|\bcheaper\b/.test(text),
      `${label}: claims a saving it did not compute -> ${text}`);
  }
});

test('prose: the live region is one sentence, not the essay', () => {
  for (const [label, over] of SCENARIOS) {
    const line = L.summarySentence(model(over));
    assert.ok(line.length < 160, `${label}: the live region stays short -> ${line}`);
    assert.ok(line.includes('payment:'), `${label}: it leads with the number`);
  }
  assert.equal(L.summarySentence(model({ frequencyKey: '26' })).slice(0, 18), 'Biweekly payment: ');
});

test('prose: the chart description is a description, not a caption', () => {
  const m = model();
  const d = L.chartDescription(m);
  assert.ok(d.includes(L.moneyNatural(m.principal)), 'says where the balance starts');
  assert.ok(d.includes('falls to zero'), 'and where it ends');
  assert.ok(/curved/.test(d), 'and what shape it is');
  assert.ok(/straight/.test(L.chartDescription(model({ ratePct: 0 }))), 'which is different at zero');
});

/* ================================================================
 * Sensitivity
 * ================================================================ */

test('sensitivity: every row is priced by the engine that priced the headline', () => {
  for (const [label, over] of SCENARIOS) {
    const m = model(over);
    const { rates, terms } = L.sensitivity(m);
    for (const row of rates.concat(terms)) {
      const check = L.scenario(m.principal, row.ratePct, row.years, m.f, m.extraCents);
      assert.equal(row.paymentCents, check.paymentCents, `${label}: row payment is re-derivable`);
      assert.equal(row.totalInterestCents, check.totalInterestCents, `${label}: row interest`);
      assert.ok(row.ratePct >= 0 && row.ratePct <= L.HARD_MAX_RATE, `${label}: no row the form would reject`);
      assert.ok(row.years > 0 && row.years <= L.HARD_MAX_YEARS, `${label}: no term the form would reject`);
    }
    assert.equal(rates.filter((r) => r.current).length, 1, `${label}: exactly one current rate row`);
    assert.equal(terms.filter((r) => r.current).length, 1, `${label}: exactly one current term row`);
  }
});

test('sensitivity: the current row has zero deltas, and deltas are subtractable', () => {
  const m = model();
  const { rates, terms } = L.sensitivity(m);
  for (const rows of [rates, terms]) {
    const current = rows.find((r) => r.current);
    assert.equal(current.paymentDeltaCents, 0);
    assert.equal(current.interestDeltaCents, 0);
    for (const row of rows) {
      /* A reader subtracting two printed cells must get the delta column. */
      assert.equal(row.paymentDeltaCents, row.paymentCents - m.paymentCents);
      assert.equal(row.interestDeltaCents, row.totalInterestCents - m.totalInterestCents);
    }
  }
});

test('sensitivity: stepRate survives binary arithmetic', () => {
  /* 6.1 - 0.5 is 5.6000000000000005, and the current row is found by equality. */
  assert.equal(L.stepRate(6.1, -0.5), 5.6);
  assert.equal(L.stepRate(7, 1), 8);
  assert.equal(L.stepRate(0.1, 0.2), 0.3);
  assert.equal(L.stepRate(24.99, -2), 22.99);
});

test('sensitivity: captions never claim a saving at a zero rate', () => {
  const m = model({ ratePct: 0 });
  const { rates, terms } = L.sensitivity(m);
  const caption = L.termCaptionText(m, terms);
  /* Tested against the affirmative phrasings the code can actually produce. The
     caption legitimately contains the word "save" inside its denial of one, and
     an assertion that cannot tell a claim from its negation is worse than none. */
  assert.ok(!/would save|cut the interest by|add .* in interest/.test(caption),
    `zero-rate term caption must not claim a saving -> ${caption}`);
  assert.ok(caption.includes('no interest for a shorter term to save'));
  for (const text of [caption, L.rateCaptionText(m, rates)]) {
    assert.ok(!/NaN|Infinity|undefined/.test(text));
    assert.ok(!text.includes('—'), 'no em dash in a caption');
  }
});

test('sensitivity: captions hold at every scenario', () => {
  for (const [label, over] of SCENARIOS) {
    const m = model(over);
    const { rates, terms } = L.sensitivity(m);
    for (const text of [L.rateCaptionText(m, rates), L.termCaptionText(m, terms)]) {
      assert.ok(!/NaN|Infinity|undefined|null/.test(text), `${label}: ${text}`);
      assert.ok(!/ {2}/.test(text), `${label}: doubled space`);
      assert.ok(!text.includes('—'), `${label}: em dash`);
      assert.ok(/\.$/.test(text.trim()), `${label}: unterminated -> ${text}`);
    }
  }
});
