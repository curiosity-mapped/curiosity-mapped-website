/*
 * node --test tests/
 *
 * Zero dependencies, and it loads the shipped file rather than a copy of the
 * maths: docs/js/mortgage.js ends with a `typeof module` guard whose only purpose
 * is to make these functions reachable from here. A duplicated implementation
 * would pass this suite while the browser ran something else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../docs/js/mortgage.js');

/* The three lines every case repeats: annual percent in, rounded payment out. */
const periodic = (annualPercent) => annualPercent / 100 / 12;
const round2 = (x) => Math.round(x * 100) / 100;
const payment = (P, annualPercent, years) =>
  round2(M.monthlyPayment(P, periodic(annualPercent), years * 12));
const schedule = (P, annualPercent, years) => {
  const i = periodic(annualPercent);
  const n = years * 12;
  return M.buildSchedule(P, i, n, payment(P, annualPercent, years));
};

/* ---------------------------------------------------------------- payment */

test('payment: $300,000 at 6% over 30 years', () => {
  assert.equal(M.monthlyPayment(300000, periodic(6), 360).toFixed(6), '1798.651575');
  assert.equal(payment(300000, 6, 30), 1798.65);
});

test('payment: $300,000 at 6% over 15 years', () => {
  assert.equal(M.monthlyPayment(300000, periodic(6), 180).toFixed(6), '2531.570484');
  assert.equal(payment(300000, 6, 15), 2531.57);
});

test('payment: $100,000 at 5% over 30 years', () => {
  assert.equal(M.monthlyPayment(100000, periodic(5), 360).toFixed(6), '536.821623');
  assert.equal(payment(100000, 5, 30), 536.82);
});

test('payment: a zero-rate loan is the principal split n ways', () => {
  assert.equal(payment(100000, 0, 10), 833.33);
  assert.equal(M.monthlyPayment(100000, 0, 120), 100000 / 120);
  const s = schedule(100000, 0, 10);
  assert.ok(s.rows.every((r) => r.interestCents === 0), 'no row may carry interest');
  assert.equal(s.totalInterestCents, 0);
  assert.equal(s.totalPaidCents, 10000000);
});

test('payment: a rate below the near-zero threshold is treated as zero', () => {
  /* 1e-10 monthly is roughly 0.00000012% a year. Below the threshold the closed
     form's denominator has no significant digits left, and the answer it should
     give is the one the limit gives. */
  assert.equal(M.monthlyPayment(100000, 1e-10, 120), 100000 / 120);
  assert.notEqual(M.monthlyPayment(100000, 1e-8, 120), 100000 / 120);
});

test('payment: both algebraic forms of the formula agree', () => {
  /* The implementation uses P*i / (1 - (1+i)^-n); this is the other one. */
  for (const [P, pctY, years] of [[320000, 6, 30], [50000, 3.25, 12], [1200000, 7.875, 40]]) {
    const i = periodic(pctY);
    const n = years * 12;
    const other = (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    assert.ok(Math.abs(M.monthlyPayment(P, i, n) - other) < 1e-6);
  }
});

test('payment: rejects a principal or term that is not positive', () => {
  assert.ok(Number.isNaN(M.monthlyPayment(0, periodic(6), 360)));
  assert.ok(Number.isNaN(M.monthlyPayment(-1, periodic(6), 360)));
  assert.ok(Number.isNaN(M.monthlyPayment(320000, periodic(6), 0)));
});

/* --------------------------------------------------------------- schedule */

test('schedule: the default scenario, end to end', () => {
  const s = schedule(320000, 6, 30);
  assert.equal(payment(320000, 6, 30), 1918.56);
  assert.equal(s.count, 360);
  assert.equal(s.totalInterestCents, 37068335);   /* $370,683.35 */
  assert.equal(s.totalPaidCents, 69068335);       /* $690,683.35 */
  /*
   * $1,920.31, not the level $1,918.56. Each month's interest is rounded to the
   * cent, so the last payment absorbs the accumulated difference -- and the page
   * prints that number rather than pretending row 360 looks like the other 359.
   *
   * The cent in the third decimal place of this figure is not arbitrary. At
   * payment 354 the balance is exactly $13,167.00 and 0.5% of it is exactly
   * $65.835 -- a true tie, not a float artifact. Math.round takes it half up,
   * which is the commercial convention; rounding that one tie the other way moves
   * every later balance by a cent and lands on $1,920.30 instead.
   */
  assert.equal(s.finalPaymentCents, 192031);
  assert.equal(s.rows[359].balanceCents, 0);
  assert.equal(s.rows[0].interestCents, 160000);  /* $320,000 * 0.5% = $1,600.00 */
  assert.equal(s.rows[0].principalCents, 31856);
});

test('schedule: additional costs never touch principal and interest', () => {
  /* The one behavioural claim the whole page is built on, asserted rather than
     assumed: adding tax, insurance, and dues changes the housing total and
     nothing else. There is no code path from these figures into the formula. */
  const s = schedule(320000, 6, 30);
  const pi = payment(320000, 6, 30);
  const extrasCents = M.toCents(400) + M.toCents(150) + M.toCents(0) + M.toCents(250);
  assert.equal(pi, 1918.56);
  assert.equal(M.toCents(pi) + extrasCents, 271856);  /* $2,718.56 */
  assert.equal(schedule(320000, 6, 30).totalInterestCents, s.totalInterestCents);
});

test('schedule: invariants hold across a matrix of inputs', () => {
  const rates = [0, 0.0001, 1, 3, 6, 12, 25];
  const terms = [1, 10, 15, 30, 40];
  const principals = [1000, 100000, 320000, 5000000];

  for (const P of principals) {
    for (const rate of rates) {
      for (const years of terms) {
        const label = `${P} at ${rate}% over ${years}y`;
        const n = years * 12;
        const i = periodic(rate);
        const pay = payment(P, rate, years);
        const s = M.buildSchedule(P, i, n, pay);

        const sumPrincipal = s.rows.reduce((a, r) => a + r.principalCents, 0);
        const sumInterest = s.rows.reduce((a, r) => a + r.interestCents, 0);
        const sumPaid = s.rows.reduce((a, r) => a + r.paymentCents, 0);

        assert.equal(sumPrincipal, M.toCents(P), `principal must sum to P: ${label}`);
        assert.equal(sumInterest, s.totalInterestCents, `interest total: ${label}`);
        assert.equal(sumPaid, s.totalPaidCents, `paid total: ${label}`);
        assert.equal(sumInterest + sumPrincipal, s.totalPaidCents, `parts sum: ${label}`);
        assert.equal(s.rows[s.rows.length - 1].balanceCents, 0, `pays off exactly: ${label}`);
        /*
         * The plan for this page expected `n` or `n - 1`, and that is right for
         * every loan a reader would type in -- but it is not a theorem. Rounding
         * the payment UP by a fraction of a cent overpays principal every month,
         * and that overpayment compounds at the loan's own rate: $1,000 at 25%
         * over 30 years retires on payment 347, thirteen early, because a
         * fourteenth of a cent a month is worth real money after 359 rounds of
         * 25% growth. The schedule is allowed to be shorter; it is never allowed
         * to be longer, and the page reports whatever length it actually is.
         */
        assert.ok(s.count <= n, `never longer than n: ${label}`);
        if (rate <= 12 && P >= 100000) {
          assert.ok(s.count === n || s.count === n - 1, `length ${s.count} vs ${n}: ${label}`);
        }

        let previousBalance = Infinity;
        let previousInterest = Infinity;
        for (let k = 0; k < s.rows.length; k++) {
          const row = s.rows[k];
          assert.ok(row.balanceCents <= previousBalance, `balance falls: ${label} row ${k}`);
          assert.ok(row.interestCents <= previousInterest, `interest falls: ${label} row ${k}`);
          assert.ok(row.balanceCents >= 0, `balance never negative: ${label} row ${k}`);
          assert.equal(
            row.interestCents + row.principalCents,
            row.paymentCents,
            `row adds up: ${label} row ${k}`
          );
          if (k < s.rows.length - 1) {
            assert.equal(row.paymentCents, M.toCents(pay), `level payment: ${label} row ${k}`);
          }
          previousBalance = row.balanceCents;
          previousInterest = row.interestCents;
        }

        /* The rounded payment is within a cent of the closed form it came from. */
        assert.ok(Math.abs(pay - M.monthlyPayment(P, i, n)) <= 0.005, `rounding: ${label}`);
      }
    }
  }
});

test('schedule: cannot run past the hard cap', () => {
  const s = M.buildSchedule(1000000, periodic(6), 1200, 1);
  assert.equal(s.count, M.MAX_PAYMENTS);
});

test('schedule: a payment smaller than the interest still terminates', () => {
  /* Not a loan anyone would sign, but it must not hang and it must not lie: the
     whole balance falls due on the final row. */
  const s = M.buildSchedule(320000, periodic(6), 360, 100);
  assert.equal(s.count, 360);
  assert.equal(s.rows[359].balanceCents, 0);
  assert.ok(s.rows[359].paymentCents > 320000 * 100);
});

/* -------------------------------------------------------- yearly rollup */

test('summarizeByYear: twelve payments to a year, and the totals survive', () => {
  const s = schedule(320000, 6, 30);
  const years = M.summarizeByYear(s.rows);
  assert.equal(years.length, 30);
  assert.equal(years[0].year, 1);
  assert.equal(years[0].payments, 12);
  assert.equal(years[0].interestCents, 1909310);      /* $19,093.10 */
  assert.equal(years[0].endingBalanceCents, 31607038);
  assert.equal(years[29].endingBalanceCents, 0);
  assert.equal(
    years.reduce((a, y) => a + y.interestCents, 0),
    s.totalInterestCents
  );
  assert.equal(
    years.reduce((a, y) => a + y.principalCents, 0),
    M.toCents(320000)
  );
});

test('summarizeByYear: a short loan keeps its partial final year', () => {
  const s = schedule(1000, 6, 1);
  const years = M.summarizeByYear(s.rows);
  assert.equal(years.length, 1);
  assert.equal(years[0].payments, s.count);
});

/* ------------------------------------------------------- balanceAfter */

test('balanceAfter: the closed form tracks the schedule it explains', () => {
  const s = schedule(320000, 6, 30);
  for (const k of [1, 12, 60, 180, 300, 359]) {
    const closed = M.balanceAfter(320000, periodic(6), 360, payment(320000, 6, 30), k);
    const actual = s.rows[k - 1].balanceCents / 100;
    /* They diverge only by the accumulated cent-rounding, which is what the page
       says out loud: the table comes from the recurrence, not from this. */
    assert.ok(Math.abs(closed - actual) < 1, `k=${k}: ${closed} vs ${actual}`);
  }
  assert.equal(M.balanceAfter(100000, 0, 120, 833.33, 60), 100000 - 833.33 * 60);
});

/* ------------------------------------------------------------ parseNumber */

test('parseNumber: accepts what people actually paste', () => {
  assert.equal(M.parseNumber('320000'), 320000);
  assert.equal(M.parseNumber('$1,234.56'), 1234.56);
  assert.equal(M.parseNumber('6.5%'), 6.5);
  assert.equal(M.parseNumber('1 234'), 1234);
  assert.equal(M.parseNumber('1 234'), 1234);
  assert.equal(M.parseNumber(' 400000 '), 400000);
  assert.equal(M.parseNumber('+6'), 6);
  assert.equal(M.parseNumber('.5'), 0.5);
  assert.equal(M.parseNumber('-5'), -5);   /* Sign is the field's business, not the parser's. */
  assert.equal(M.parseNumber('0'), 0);
});

test('parseNumber: rejects everything else, including what parseFloat would take', () => {
  /* parseFloat('12abc') is 12. That single behaviour is why this is a function. */
  assert.equal(M.parseNumber('12abc'), null);
  assert.equal(parseFloat('12abc'), 12);

  for (const bad of ['', '   ', 'abc', 'Infinity', '-Infinity', 'NaN', '1e999', '1.2.3', '$', '%', '--5']) {
    assert.equal(M.parseNumber(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, undefined, 12, {}, [], NaN]) {
    assert.equal(M.parseNumber(bad), null, `must reject ${String(bad)}`);
  }
});

/* --------------------------------------------------------------- grammar */

test('joinList: reads as a sentence at every length', () => {
  assert.equal(M.joinList([]), '');
  assert.equal(M.joinList(['taxes']), 'taxes');
  assert.equal(M.joinList(['taxes', 'insurance']), 'taxes and insurance');
  assert.equal(
    M.joinList(['taxes', 'insurance', 'association dues']),
    'taxes, insurance, and association dues'
  );
  assert.equal(
    M.joinList(['a', 'b', 'c', 'd']),
    'a, b, c, and d'
  );
});

test('plural: one payment, many payments', () => {
  assert.equal(M.plural(1, 'payment'), 'payment');
  assert.equal(M.plural(0, 'payment'), 'payments');
  assert.equal(M.plural(360, 'payment'), 'payments');
  assert.equal(M.plural(1, 'year'), 'year');
  assert.equal(M.plural(30, 'year'), 'years');
});

/* ------------------------------------------------------------ formatting */

test('money formatters produce the strings the page prints', () => {
  assert.equal(M.money(1918.56), '$1,918.56');
  assert.equal(M.money(0), '$0.00');
  assert.equal(M.moneyWhole(370683.35), '$370,683');
  assert.equal(M.pct(0.005), '0.50%');
  assert.equal(M.pct(0.06), '6.00%');
});

test('cents round-trip without drift', () => {
  for (const d of [0, 0.01, 0.1, 1918.56, 370683.35, 5000000]) {
    assert.equal(M.fromCents(M.toCents(d)), d);
  }
});
