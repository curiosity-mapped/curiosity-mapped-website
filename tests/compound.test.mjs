/*
 * node --test tests/
 *
 * Zero dependencies, and it loads the shipped file rather than a copy of the
 * maths: docs/js/compound.js ends with a `typeof module` guard whose only purpose
 * is to make these functions reachable from here. A duplicated implementation
 * would pass this suite while the browser ran something else.
 *
 * Every expected value below was derived by hand or from an independent route,
 * never by running the implementation and recording what it said. That
 * distinction is the whole value of the file.
 *
 * A NOTE ON THE SOURCE RESEARCH. The document this page was written from carries
 * several wrong figures, and they are wrong in the direction of looking
 * plausible. Its frequency ladder for $1,000 at 5% over 10 years reads
 * $1,640.71 / $1,649.01 / $1,653.30 / $1,654.21 / $1,654.23 for semiannual
 * through continuous; the correct values are $1,638.62 / $1,643.62 / $1,647.01 /
 * $1,648.66 / $1,648.72, and the document contradicts itself -- elsewhere it
 * gives the monthly figure as $1,647.01, which is right. It also has $500 at 8%
 * compounded monthly for 5 years as $734.66 (correct: $744.92) and $10,000 at
 * 10% monthly for 10 years as $27,059.68 (correct: $27,070.41). Nothing in this
 * suite is taken from it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../docs/js/compound.js');

/* The default scenario the page ships as static markup. */
const DEF = { principal: 1000, ratePct: 5, frequencyKey: '12', years: 10, unit: 'years', inflationPct: null };
const model = (over = {}) => C.buildModel({ ...DEF, ...over });
const round2 = (x) => Math.round(x * 100) / 100;
const fv = (P, ratePct, n, t) => round2(C.futureValue(P, ratePct / 100, n, t));

/* ------------------------------------------------------------ future value */

test('futureValue: the frequency ladder, $1,000 at 5% over 10 years', () => {
  /* Each is P(1+r/n)^(nt) evaluated independently; the last is Pe^(rt). */
  assert.equal(fv(1000, 5, 1, 10), 1628.89);
  assert.equal(fv(1000, 5, 2, 10), 1638.62);
  assert.equal(fv(1000, 5, 4, 10), 1643.62);
  assert.equal(fv(1000, 5, 12, 10), 1647.01);
  assert.equal(fv(1000, 5, 365, 10), 1648.66);
  assert.equal(fv(1000, 5, null, 10), 1648.72);

  /* 1.05^10 = 1.6288946267774414, exactly, to the digits a double carries. */
  assert.equal(C.futureValue(1000, 0.05, 1, 10).toFixed(6), '1628.894627');
  /* e^0.5 = 1.6487212707001282. */
  assert.equal(C.futureValue(1000, 0.05, null, 10).toFixed(6), '1648.721271');
});

test('futureValue: figures the source research got wrong', () => {
  /* Recomputed rather than copied. See the header. */
  assert.equal(fv(10000, 10, 12, 10), 27070.41);   /* document: 27,059.68 */
  assert.equal(fv(500, 3, 12, 5), 580.81);         /* document: 580.62 */
  assert.equal(fv(500, 5, 12, 5), 641.68);         /* document: 641.81 */
  assert.equal(fv(500, 8, 12, 5), 744.92);         /* document: 734.66 */
});

test('futureValue: figures the source research got right', () => {
  assert.equal(fv(1000, 7, 1, 5), 1402.55);
  assert.equal(fv(1000, 7, 1, 10), 1967.15);
  assert.equal(fv(1000, 7, 1, 20), 3869.68);
});

test('futureValue: a zero rate returns the principal, at every frequency and length', () => {
  for (const n of [1, 2, 4, 12, 365, null]) {
    for (const t of [0, 0.5, 1, 10, 100]) {
      assert.equal(C.futureValue(1000, 0, n, t), 1000, `n=${n} t=${t}`);
    }
  }
});

test('futureValue: zero time returns the principal, at every rate and frequency', () => {
  for (const n of [1, 2, 4, 12, 365, null]) {
    for (const ratePct of [-20, -1, 0, 5, 25]) {
      assert.equal(C.futureValue(1000, ratePct / 100, n, 0), 1000, `n=${n} r=${ratePct}`);
    }
  }
});

test('futureValue: fractional years are prorated by the exponent', () => {
  /* 1.05^0.5 = 1.024695076595960 */
  assert.equal(fv(1000, 5, 1, 0.5), 1024.70);
  /* (1+0.05/12)^18 */
  assert.equal(fv(1000, 5, 12, 1.5), 1077.72);
});

test('futureValue: a negative rate decays the balance rather than failing', () => {
  assert.equal(fv(1000, -1, 12, 10), 904.80);
  const m = model({ ratePct: -1 });
  assert.equal(round2(m.interest), -95.20);
  assert.ok(m.negative);
  /* The floor keeps 1 + r/n at or above 0.8 for every offered n, so no base can
     approach zero and no fractional exponent can produce NaN. */
  for (const n of [1, 2, 4, 12, 365, null]) {
    const v = C.futureValue(1000, C.HARD_MIN_RATE / 100, n, 100);
    assert.ok(isFinite(v) && v >= 0, `n=${n} gave ${v}`);
  }
});

test('futureValue: rejects a principal or a length that is not usable', () => {
  assert.ok(Number.isNaN(C.futureValue(0, 0.05, 12, 10)));
  assert.ok(Number.isNaN(C.futureValue(-1, 0.05, 12, 10)));
  assert.ok(Number.isNaN(C.futureValue(1000, 0.05, 12, -1)));
});

/* ------------------------------------------------ independent cross-checks */

test('cross-check: the effective-rate route reaches the same balance', () => {
  /*
   * A = P(1+r/n)^(nt) and A = P(1+EAR)^t are different expressions. They must
   * agree, and this is the one test in the file that cannot pass by the
   * implementation agreeing with itself.
   */
  for (const P of [0.01, 1000, 1e6, 1e8]) {
    for (const ratePct of [-20, -1, 0, 1, 5, 15, 25]) {
      for (const n of [1, 2, 4, 12, 365, null]) {
        for (const t of [0, 0.25, 1, 10, 50, 100]) {
          const r = ratePct / 100;
          const direct = C.futureValue(P, r, n, t);
          const viaEar = P * Math.pow(1 + C.effectiveAnnualRate(r, n), t);
          const label = `P=${P} r=${ratePct} n=${n} t=${t}`;
          assert.ok(isFinite(direct) && isFinite(viaEar), label);
          const scale = Math.max(Math.abs(direct), 1e-9);
          assert.ok(Math.abs(direct - viaEar) / scale < 1e-9, `${label}: ${direct} vs ${viaEar}`);
        }
      }
    }
  }
});

test('cross-check: more frequent compounding is worth more, and continuous is the ceiling', () => {
  const ladder = [1, 2, 4, 12, 365];
  for (const ratePct of [0.5, 1, 5, 15, 25]) {
    const r = ratePct / 100;
    for (const t of [1, 10, 50]) {
      let previous = -Infinity;
      for (const n of ladder) {
        const v = C.futureValue(1000, r, n, t);
        assert.ok(v > previous, `r=${ratePct} t=${t} n=${n}: ${v} must exceed ${previous}`);
        previous = v;
      }
      const cont = C.futureValue(1000, r, null, t);
      assert.ok(cont > previous, `r=${ratePct} t=${t}: continuous must exceed daily`);
    }
  }
});

test('cross-check: at a negative rate the ladder still rises', () => {
  /*
   * This is the counterintuitive one, and it is worth an assertion because the
   * obvious guess is wrong. More frequent compounding at a NEGATIVE rate leaves
   * MORE money, not less: -5% once takes the balance to 0.95, while -2.5% twice
   * takes it to 0.975^2 = 0.950625, because the second deduction comes off a
   * balance the first one already shrank. (1+r/n)^n rises toward e^r from below
   * whatever the sign of r, so continuous compounding is the ceiling in both
   * directions rather than the best case in one and the worst in the other.
   */
  let previous = -Infinity;
  for (const n of [1, 2, 4, 12, 365]) {
    const v = C.futureValue(1000, -0.05, n, 10);
    assert.ok(v > previous, `n=${n}: ${v} must exceed ${previous}`);
    previous = v;
  }
  const cont = C.futureValue(1000, -0.05, null, 10);
  assert.ok(cont > previous, 'continuous must be the ceiling at a negative rate too');
  /* 1000 * 0.95^10 = 598.7369, 1000 * e^-0.5 = 606.5307. */
  assert.equal(C.futureValue(1000, -0.05, 1, 10).toFixed(4), '598.7369');
  assert.equal(cont.toFixed(4), '606.5307');
});

test('cross-check: the discrete formula tends to the continuous one', () => {
  const cont = C.futureValue(1000, 0.05, null, 10);
  const near = C.futureValue(1000, 0.05, 1e7, 10);
  assert.ok(Math.abs(near - cont) / cont < 1e-6, `${near} vs ${cont}`);
});

test('cross-check: compound beats simple over a whole period, and loses inside one', () => {
  /*
   * The reversal is Bernoulli's inequality and it surprises people: (1+x)^k is
   * BELOW 1+kx for 0 < k < 1. Half a year of annual compounding really is worth
   * less than half a year of simple interest.
   */
  for (const ratePct of [1, 5, 15, 25]) {
    for (const n of [1, 2, 4, 12, 365]) {
      for (const t of [1, 10, 50]) {
        const r = ratePct / 100;
        assert.ok(C.futureValue(1000, r, n, t) >= C.simpleValue(1000, r, t) - 1e-9,
          `r=${ratePct} n=${n} t=${t}`);
      }
    }
  }
  assert.equal(fv(1000, 5, 1, 0.5), 1024.70);
  assert.equal(round2(C.simpleValue(1000, 0.05, 0.5)), 1025.00);
  assert.ok(C.futureValue(1000, 0.05, 1, 0.5) < C.simpleValue(1000, 0.05, 0.5));
});

test('cross-check: per-period rounding costs only what the page says it costs', () => {
  /*
   * A real account rounds every credit to the cent; the formula does not. The
   * page states the size of that difference, so the sentence is asserted here
   * rather than believed.
   */
  const rounded = (P, r, n, t) => {
    let balance = P;
    const periodRate = r / n;
    const periods = Math.round(n * t);
    for (let k = 0; k < periods; k++) balance += Math.round(balance * periodRate * 100) / 100;
    return balance;
  };
  const monthly = rounded(1000, 0.05, 12, 10) - C.futureValue(1000, 0.05, 12, 10);
  const daily = rounded(1000, 0.05, 365, 10) - C.futureValue(1000, 0.05, 365, 10);
  assert.ok(Math.abs(monthly) < 0.05, `monthly gap was ${monthly}`);
  assert.ok(Math.abs(daily) < 0.50, `daily gap was ${daily}`);
});

/* ------------------------------------------------- effective annual rate */

test('effectiveAnnualRate: what a year of the quoted rate actually comes to', () => {
  const ear = (ratePct, n) => Number((C.effectiveAnnualRate(ratePct / 100, n) * 100).toFixed(4));
  assert.equal(ear(5, 1), 5);
  assert.equal(ear(5, 2), 5.0625);
  assert.equal(ear(5, 4), 5.0945);
  assert.equal(ear(5, 12), 5.1162);
  assert.equal(ear(5, 365), 5.1267);
  assert.equal(ear(5, null), 5.1271);

  /* The three the source research states, and gets right. */
  assert.equal(ear(10, 2), 10.25);
  assert.equal(ear(12, 12), 12.6825);
  assert.equal(ear(5, null), 5.1271);

  /* Daily and continuous round to the same three decimals. That coincidence is
     the page's own punchline, so it is pinned here. */
  assert.equal(C.pctTrim(C.effectiveAnnualRate(0.05, 365)), '5.127%');
  assert.equal(C.pctTrim(C.effectiveAnnualRate(0.05, null)), '5.127%');
});

test('effectiveAnnualRate: a zero rate is exactly zero, not nearly', () => {
  for (const n of [1, 12, 365, null]) assert.equal(C.effectiveAnnualRate(0, n), 0);
  assert.equal(C.effectiveAnnualRate(1e-15, 12), 0);
});

test('effectiveAnnualRate: annual compounding is the identity', () => {
  for (const ratePct of [-20, -1, 1, 5, 25]) {
    assert.ok(Math.abs(C.effectiveAnnualRate(ratePct / 100, 1) - ratePct / 100) < 1e-15);
  }
});

/* ------------------------------------------------------------- doubling */

test('doublingYears: exact, and near enough to the Rule of 72 to quote it', () => {
  /* ln2/ln(1.08) = 9.006468, ln2/ln(1.06) = 11.895661. */
  assert.equal(C.doublingYears(0.08, 1).toFixed(4), '9.0065');
  assert.equal(C.doublingYears(0.06, 1).toFixed(4), '11.8957');
  /* ln2/ln(1.05) = 14.206699, the figure the source research quotes as 14.21. */
  assert.equal(C.doublingYears(0.05, 1).toFixed(2), '14.21');
  /* The default scenario: 13.89 years against the rule's 14.4. */
  assert.equal(C.doublingYears(0.05, 12).toFixed(4), '13.8918');
  assert.equal(C.doublingYears(0.05, null).toFixed(4), '13.8629');

  for (const ratePct of [6, 8, 10]) {
    const exact = C.doublingYears(ratePct / 100, 1);
    assert.ok(Math.abs(72 / ratePct - exact) < 0.5, `rule of 72 at ${ratePct}%`);
  }
});

test('doublingYears: null when there is no doubling to speak of', () => {
  assert.equal(C.doublingYears(0, 12), null);
  assert.equal(C.doublingYears(-0.05, 12), null);
  assert.equal(C.doublingYears(0, null), null);
});

/* ---------------------------------------------------------- real value */

test('realValue: the exact relation, not nominal minus inflation', () => {
  /* 1,647.0095 / 1.03^10, and 1.03^10 = 1.343916379. */
  assert.equal(round2(C.realValue(C.futureValue(1000, 0.05, 12, 10), 0.03, 10)), 1225.53);
  /* Zero inflation changes nothing; zero time changes nothing. */
  assert.equal(C.realValue(1647.01, 0, 10), 1647.01);
  assert.equal(C.realValue(1647.01, 0.03, 0), 1647.01);
  /* Deflation raises purchasing power rather than failing. */
  assert.ok(C.realValue(1000, -0.02, 10) > 1000);
});

test('realValue: 5% against 3% is 1.94% real, not 2%', () => {
  const real = Math.pow(C.realValue(C.futureValue(1000, 0.05, 1, 10), 0.03, 10) / 1000, 1 / 10) - 1;
  assert.equal((real * 100).toFixed(4), '1.9417');
  /* 7% against 3% is 3.88%, the other figure the source research states. */
  const other = Math.pow(C.realValue(C.futureValue(1000, 0.07, 1, 10), 0.03, 10) / 1000, 1 / 10) - 1;
  assert.equal((other * 100).toFixed(2), '3.88');
});

/* -------------------------------------------------------------- tables */

test('yearlyRows: the rows reconcile with the headline they sit under', () => {
  const m = model();
  assert.equal(m.yearly.length, 10);
  assert.equal(round2(m.yearly[0].interest), 51.16);
  assert.equal(round2(m.yearly[9].interest), 80.16);
  /* Interest earns interest, so every year earns more than the one before it. */
  for (let k = 1; k < m.yearly.length; k++) {
    assert.ok(m.yearly[k].interest > m.yearly[k - 1].interest, `year ${k + 1}`);
  }
  /* The last row IS the headline, not a number that resembles it. */
  assert.equal(m.yearly[9].balance, m.amount);
  const summed = m.yearly.reduce((a, y) => a + y.interest, 0);
  assert.ok(Math.abs(summed - m.interest) < 1e-9);
  assert.equal(round2(m.yearly[9].cumulative), round2(m.interest));
});

test('yearlyRows: a final part-year keeps its own row, marked', () => {
  const m = model({ years: 10.5 });
  assert.equal(m.yearly.length, 11);
  assert.equal(m.yearly[10].partial, true);
  assert.equal(m.yearly[10].at, 10.5);
  assert.equal(m.yearly[9].partial, false);
  assert.equal(m.yearly[10].balance, m.amount);
});

test('yearlyRows: bounded by the accepted horizon', () => {
  assert.equal(model({ years: 100 }).yearly.length, 100);
  assert.equal(model({ years: 1 }).yearly.length, 1);
  assert.equal(model({ years: 0.5 }).yearly.length, 1);
});

test('periodRows: the recurrence, shown where the closed form cannot show it', () => {
  const m = model();
  assert.equal(m.periodRows.length, C.PERIOD_ROWS);
  assert.equal(m.periodRows[0].opening, 1000);
  /* 1000 * 0.05/12 = 4.1666..., which is the point: it is not 5% of anything. */
  assert.equal(m.periodRows[0].interest.toFixed(6), '4.166667');
  /* Period 2 earns more than period 1 on the same rate. That is the whole idea. */
  assert.ok(m.periodRows[1].interest > m.periodRows[0].interest);
  for (let k = 0; k < m.periodRows.length; k++) {
    const row = m.periodRows[k];
    assert.ok(Math.abs(row.opening + row.interest - row.closing) < 1e-9, `row ${k}`);
    if (k) assert.equal(row.opening, m.periodRows[k - 1].closing);
  }
  /* And the tenth close matches the closed form at ten twelfths of a year. */
  const closed = C.futureValue(1000, 0.05, 12, 10 / 12);
  assert.ok(Math.abs(m.periodRows[9].closing - closed) < 1e-9);
});

test('periodRows: continuous compounding has no periods to list', () => {
  assert.deepEqual(model({ frequencyKey: 'continuous' }).periodRows, []);
  /* Nor does a horizon shorter than a single period. */
  assert.deepEqual(model({ frequencyKey: '1', years: 0.5 }).periodRows, []);
});

/* --------------------------------------------------------------- model */

test('buildModel: the default scenario, end to end', () => {
  const m = model();
  assert.equal(round2(m.amount), 1647.01);
  assert.equal(round2(m.interest), 647.01);
  assert.equal(m.periods, 120);
  assert.equal(m.periodicRate.toFixed(8), '0.00416667');
  assert.equal(m.partialPeriod, false);
  assert.equal(m.zero, false);
  assert.equal(m.negative, false);
  assert.equal(m.real, null);
  assert.equal(C.multiple(m.growth), '1.65×');
  /* The identity the result panel is built to make visible. */
  assert.ok(Math.abs(m.principal + m.interest - m.amount) < 1e-9);
});

test('buildModel: percent reaches the maths as a decimal, exactly once', () => {
  const m = model({ ratePct: 5 });
  assert.equal(m.rate, 0.05);
  assert.equal(m.ratePct, 5);
  assert.equal(m.periodicRate, 0.05 / 12);
  assert.equal(model({ ratePct: 6.125 }).rate, 0.06125);
});

test('buildModel: continuous compounding has no periodic rate and no period count', () => {
  const m = model({ frequencyKey: 'continuous' });
  assert.equal(m.n, null);
  assert.equal(m.periods, null);
  assert.equal(m.periodicRate, null);
  assert.equal(m.partialPeriod, false);
  assert.equal(round2(m.amount), 1648.72);
});

test('buildModel: the partial-period flag tracks n times t, not t alone', () => {
  assert.equal(model({ frequencyKey: '1', years: 10.5 }).partialPeriod, true);
  assert.equal(model({ frequencyKey: '12', years: 10.5 }).partialPeriod, false);
  assert.equal(model({ frequencyKey: '2', years: 10.25 }).partialPeriod, true);
  assert.equal(model({ frequencyKey: '4', years: 10.25 }).partialPeriod, false);
});

test('buildModel: months are carried as the years they are', () => {
  const m = model({ years: 1.5, unit: 'months' });
  assert.equal(m.durationText, '18 months');
  assert.equal(round2(m.amount), 1077.72);
  assert.equal(model({ years: 10, unit: 'years' }).durationText, '10 years');
  assert.equal(model({ years: 1, unit: 'years' }).durationText, '1 year');
  assert.equal(model({ years: 10.5, unit: 'years' }).durationText, '10.5 years');
});

test('buildModel: an unknown frequency is refused rather than guessed', () => {
  assert.equal(C.buildModel({ ...DEF, frequencyKey: 'hourly' }), null);
  assert.equal(C.frequency('12').n, 12);
  assert.equal(C.frequency('continuous').n, null);
  assert.equal(C.frequency('nope'), null);
});

test('buildModel: nothing the form accepts produces a non-finite figure', () => {
  for (const principal of [0.01, 1, 1000, 1e6, C.HARD_MAX_MONEY]) {
    for (const ratePct of [C.HARD_MIN_RATE, -1, 0, 1e-13, 5, C.WARN_RATE, C.HARD_MAX_RATE]) {
      for (const f of C.FREQUENCIES) {
        for (const years of [0, 0.001, 1, 10, C.WARN_YEARS, C.HARD_MAX_YEARS]) {
          const label = `${principal} @ ${ratePct}% ${f.key} for ${years}y`;
          const m = C.buildModel({
            principal, ratePct, frequencyKey: f.key, years, unit: 'years', inflationPct: 3
          });
          assert.ok(m, `must build: ${label}`);
          for (const field of ['amount', 'interest', 'ear', 'growth', 'simple', 'real']) {
            assert.ok(isFinite(m[field]), `${field} not finite: ${label} (${m[field]})`);
          }
          /* And no formatter may ever put NaN or Infinity in front of a reader. */
          for (const s of [C.money(m.amount), C.money(m.interest), C.pctTrim(m.ear),
                           C.multiple(m.growth), C.money(m.real), C.summarySentence(m)]) {
            assert.ok(!/NaN|Infinity|∞/.test(s), `${label} formatted as ${s}`);
          }
          assert.ok(m.amount >= 0, `negative balance: ${label}`);
          if (m.amount >= C.CENT_LIMIT) {
            assert.ok(!C.money(m.amount).includes('.'),
              `cents claimed above the limit: ${label}`);
          }
        }
      }
    }
  }
});

test('buildModel: the largest figure the form accepts is still a number', () => {
  const m = C.buildModel({
    principal: C.HARD_MAX_MONEY, ratePct: C.HARD_MAX_RATE,
    frequencyKey: '365', years: C.HARD_MAX_YEARS, unit: 'years', inflationPct: null
  });
  assert.ok(isFinite(m.amount));
  assert.ok(m.amount > 1e18 && m.amount < 1e19);
  /* Formats as currency rather than as scientific notation or a browser default. */
  assert.match(C.money(m.amount), /^\$[\d,]+$/);
  /*
   * Past about fifteen significant digits a double has no cents left to carry, so
   * the formatter drops them rather than printing a fabricated ".00". This is the
   * assertion behind the sentence the page makes about very large numbers.
   */
  assert.ok(m.amount > Number.MAX_SAFE_INTEGER);
  assert.ok(m.amount > C.CENT_LIMIT);
  assert.ok(!C.money(m.amount).includes('.'), 'no invented cents above the limit');
  /* And below the limit nothing changes: cents are exact and are printed. */
  assert.equal(C.money(C.CENT_LIMIT - 0.01), '$999,999,999,999.99');
  assert.equal(C.money(C.CENT_LIMIT), '$1,000,000,000,000');
  assert.equal(C.moneyNatural(C.CENT_LIMIT * 2), '$2,000,000,000,000');
});

/* --------------------------------------------------------- sensitivity */

test('sensitivity: every alternative agrees with the engine that priced it', () => {
  const m = model();
  const s = C.sensitivity(m);
  for (const row of [...s.rates, ...s.times]) {
    const direct = C.scenario(m.principal, row.ratePct, row.n, row.years);
    assert.equal(row.amount, direct.amount);
    assert.equal(row.interest, direct.interest);
    assert.ok(Math.abs(row.amount - row.interest - m.principal) < 1e-9);
  }
});

test('sensitivity: exactly one row is the reader’s own, and its deltas are zero', () => {
  const m = model();
  const s = C.sensitivity(m);
  for (const rows of [s.rates, s.times]) {
    const current = rows.filter((r) => r.current);
    assert.equal(current.length, 1);
    assert.equal(current[0].amountDelta, 0);
    assert.equal(current[0].interestDelta, 0);
    assert.equal(current[0].amount, m.amount);
  }
  assert.equal(s.rates.find((r) => r.current).ratePct, 5);
  assert.equal(s.times.find((r) => r.current).years, 10);
});

test('sensitivity: the rate rows are the reader’s rate plus or minus a point', () => {
  const s = C.sensitivity(model());
  assert.deepEqual(s.rates.map((r) => r.ratePct), [4, 4.5, 5, 5.5, 6]);
  for (let k = 1; k < s.rates.length; k++) {
    assert.ok(s.rates[k].amount > s.rates[k - 1].amount);
  }
});

test('sensitivity: a rate the form would reject is left out rather than clamped', () => {
  const high = C.sensitivity(model({ ratePct: 24.8 }));
  assert.deepEqual(high.rates.map((r) => r.ratePct), [23.8, 24.3, 24.8]);
  assert.ok(high.rates.every((r) => r.ratePct <= C.HARD_MAX_RATE));
  const low = C.sensitivity(model({ ratePct: -19.5 }));
  assert.ok(low.rates.every((r) => r.ratePct >= C.HARD_MIN_RATE));
  assert.equal(low.rates.filter((r) => r.current).length, 1);
});

test('sensitivity: binary arithmetic does not lose the reader’s own row', () => {
  /* 6.1 - 0.5 is 5.6000000000000005 unrounded, and the row would not be found. */
  const s = C.sensitivity(model({ ratePct: 6.1 }));
  assert.deepEqual(s.rates.map((r) => r.ratePct), [5.1, 5.6, 6.1, 6.6, 7.1]);
  assert.equal(s.rates.filter((r) => r.current).length, 1);
});

test('sensitivity: the time list always contains the length that was entered', () => {
  assert.deepEqual(C.sensitivity(model()).times.map((r) => r.years), [5, 10, 20, 30]);
  assert.deepEqual(C.sensitivity(model({ years: 7 })).times.map((r) => r.years), [5, 7, 10, 20, 30]);
  assert.deepEqual(C.sensitivity(model({ years: 40 })).times.map((r) => r.years), [5, 10, 20, 30, 40]);
  assert.equal(C.sensitivity(model({ years: 0.5 })).times.filter((r) => r.current).length, 1);
});

test('sensitivity: longer is more, at a positive rate', () => {
  const times = C.sensitivity(model()).times;
  for (let k = 1; k < times.length; k++) {
    assert.ok(times[k].amount > times[k - 1].amount);
  }
});

/* ------------------------------------------------------ frequency table */

test('frequencyTable: six rows, one of them the reader’s, measured against annual', () => {
  const m = model();
  const rows = C.frequencyTable(m);
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((r) => r.current).length, 1);
  assert.equal(rows.find((r) => r.current).freq.key, '12');
  assert.equal(rows[0].vsAnnual, 0);
  assert.equal(rows[0].periodicRate, 0.05);
  assert.equal(rows[5].periodicRate, null);
  assert.deepEqual(rows.map((r) => round2(r.amount)),
    [1628.89, 1638.62, 1643.62, 1647.01, 1648.66, 1648.72]);
  /* The claim the caption makes: the whole range is worth about twenty dollars,
     and most of it is spent getting from annually to monthly. */
  assert.equal(round2(rows[5].vsAnnual), 19.83);
  assert.equal(round2(rows[3].vsAnnual), 18.12);
  assert.equal(round2(rows[5].amount - rows[4].amount), 0.06);
});

test('frequencyTable: at a negative rate the differences from annual are gains', () => {
  const rows = C.frequencyTable(model({ ratePct: -5 }));
  assert.equal(rows[0].vsAnnual, 0);
  for (let k = 1; k < rows.length; k++) {
    assert.ok(rows[k].vsAnnual > rows[k - 1].vsAnnual, `row ${k}`);
  }
  assert.ok(rows[5].vsAnnual > 0, 'continuous loses the least');
});

test('frequencyTable: at a zero rate the frequency is worth nothing at all', () => {
  const rows = C.frequencyTable(model({ ratePct: 0 }));
  assert.ok(rows.every((r) => r.amount === 1000 && r.vsAnnual === 0 && r.ear === 0));
});

/* ---------------------------------------------------------- explanation */

test('explainParagraphs: the default scenario reads as prose', () => {
  const p = C.explainParagraphs(model());
  assert.equal(p.length, 5);
  assert.match(p[0], /^You entered \$1,000 at 5% a year, compounded monthly, left for 10 years\.$/);
  assert.match(p[1], /periodic rate of 0\.4167% a month/);
  assert.match(p[1], /120 periods/);
  assert.match(p[2], /comes to 5\.116% rather than 5%/);
  assert.match(p[3], /balance is \$1,647\.01, of which \$647\.01 is interest/);
  assert.match(p[3], /1\.65 times what you started with/);
  assert.match(p[3], /\$1,500; the difference, \$147\.01/);
  /* The inflation paragraph is empty and the page hides it, rather than leaving
     an empty line standing. */
  assert.equal(p[4], '');
});

test('explainParagraphs: each branch says something true and different', () => {
  const zero = C.explainParagraphs(model({ ratePct: 0 }));
  assert.match(zero[1], /nothing to compound/);
  assert.match(zero[3], /\$1,000, the same as the amount you started with/);
  assert.equal(zero[2], '', 'a zero rate has no rate to explain');

  const noTime = C.explainParagraphs(model({ years: 0 }));
  assert.match(noTime[1], /At zero years no compounding period has passed/);

  const cont = C.explainParagraphs(model({ frequencyKey: 'continuous' }));
  assert.match(cont[1], /no periodic rate to quote/);
  assert.match(cont[2], /comes to 5\.127%/);
  assert.ok(!/Dividing the annual rate/.test(cont.join(' ')));

  const annual = C.explainParagraphs(model({ frequencyKey: '1' }));
  assert.match(annual[1], /nothing to divide/);
  assert.match(annual[2], /the same figure/);

  const neg = C.explainParagraphs(model({ ratePct: -1 }));
  assert.match(neg[3], /a decline of \$95\.20/);
  assert.match(neg[3], /0\.90 times what you started with/);
  assert.ok(!/is interest/.test(neg[3]), 'a decline must not be called interest earned');
});

test('explainParagraphs: a partial period is disclosed at every discrete frequency', () => {
  for (const key of ['1', '2', '4', '12', '365']) {
    const m = model({ frequencyKey: key, years: 10 + 1 / (2 * Number(key)) });
    assert.ok(m.partialPeriod, `n=${key} should be partial`);
    assert.match(C.explainParagraphs(m)[1], /not a whole number of periods/, `n=${key}`);
  }
  assert.ok(!/not a whole number/.test(C.explainParagraphs(model())[1]));
});

test('explainParagraphs: inflation is described as a division, not as part of the formula', () => {
  const p = C.explainParagraphs(model({ inflationPct: 3 }));
  assert.match(p[4], /would buy what \$1,225\.53 buys today/);
  assert.match(p[4], /not part of the formula above/);
  /* And when inflation outruns the rate, it says so rather than staying upbeat. */
  const losing = C.explainParagraphs(model({ ratePct: 1, inflationPct: 5 }));
  assert.match(losing[4], /less than you started with in purchasing-power terms/);
});

test('summarySentence: one line, and it is the numbers', () => {
  assert.equal(C.summarySentence(model()),
    'Balance after 10 years: $1,647.01. Interest earned: $647.01.');
  assert.match(C.summarySentence(model({ ratePct: -1 })), /Decline: \$95\.20\./);
  assert.match(C.summarySentence(model({ inflationPct: 3 })), /In today’s money: \$1,225\.53\./);
});

/* -------------------------------------------------------- chart descriptions */

test('chart descriptions carry the figures, not just the shape', () => {
  const m = model();
  const balance = C.balanceDescription(m);
  assert.match(balance, /year 10, \$1,647/);
  assert.match(balance, /\$1,000 you started with and never changes/);
  assert.ok(!/NaN/.test(balance));

  const comparison = C.comparisonDescription(m);
  assert.match(comparison, /Simple interest reaches \$1,500/);
  assert.match(comparison, /compound interest reaches \$1,647/);
  assert.match(comparison, /\$147/);

  assert.match(C.balanceDescription(model({ ratePct: 0 })), /line is flat/);
  assert.match(C.balanceDescription(model({ ratePct: -1 })), /decline/);
  assert.match(C.comparisonDescription(model({ ratePct: 0 })), /both lines are flat/);
});

test('captions quote a row of the table they sit under', () => {
  const m = model();
  const rows = C.frequencyTable(m);
  const caption = C.frequencyCaptionText(m, rows);
  assert.match(caption, /\$19\.83/);
  assert.match(caption, /\$18\.12/);
  assert.match(caption, /too small to see on a chart/);
  assert.match(C.frequencyCaptionText(model({ ratePct: 0 }), C.frequencyTable(model({ ratePct: 0 }))),
    /the frequency changes nothing/);

  const s = C.sensitivity(m);
  assert.match(C.rateCaptionText(m, s.rates), /One percentage point more would add/);
  assert.match(C.timeCaptionText(m, s.times), /Leaving it for 20 years rather than 10/);
  /* At the top of the accepted range there is no row a point up, so the sentence
     has to turn around rather than disappear. */
  const top = model({ ratePct: 24.8 });
  assert.match(C.rateCaptionText(top, C.sensitivity(top).rates), /One percentage point less would take/);
});

/* -------------------------------------------------------------- chart geometry */

test('chart paths are well formed and stay inside the plot', () => {
  const m = model();
  const balances = [m.principal].concat(m.yearly.map((y) => y.balance));
  const line = C.seriesLine(balances, m.amount);
  assert.match(line, /^M[\d.,]+(L[\d.,]+)+$/);
  const numbers = line.replace(/[ML]/g, ' ').trim().split(/[\s,]+/).map(Number);
  assert.ok(numbers.every((v) => isFinite(v)));
  for (let k = 0; k < numbers.length; k += 2) {
    assert.ok(numbers[k] >= 0 && numbers[k] <= C.CHART_W, `x out of range: ${numbers[k]}`);
    assert.ok(numbers[k + 1] >= 0 && numbers[k + 1] <= C.CHART_H, `y out of range: ${numbers[k + 1]}`);
  }
  assert.ok(C.seriesArea(balances, m.amount).endsWith('Z'));
  assert.ok(C.seriesBand(balances.map(() => m.principal), balances, m.amount).endsWith('Z'));
  assert.equal(C.seriesLine([], 100), '');
  assert.equal(C.seriesArea([], 100), '');
});

test('chart geometry clamps a simple-interest line that goes below zero', () => {
  /* At -20% simple interest reaches -P after five years. That is arithmetically
     true and meaningless as a balance, so the plot stops at the axis. */
  const negative = C.simpleValue(1000, -0.20, 10);
  assert.ok(negative < 0);
  const path = C.seriesLine([1000, negative], 1000);
  const ys = path.replace(/[ML]/g, ' ').trim().split(/[\s,]+/).map(Number).filter((_, i) => i % 2);
  assert.ok(ys.every((y) => y >= 0 && y <= C.CHART_H), path);
});

/* ------------------------------------------------------------ parseNumber */

test('parseNumber: accepts what people actually paste', () => {
  assert.equal(C.parseNumber('1000'), 1000);
  assert.equal(C.parseNumber('$1,234.56'), 1234.56);
  assert.equal(C.parseNumber('5%'), 5);
  assert.equal(C.parseNumber('1 234'), 1234);
  assert.equal(C.parseNumber(' 1000 '), 1000);
  assert.equal(C.parseNumber('+5'), 5);
  assert.equal(C.parseNumber('.5'), 0.5);
  assert.equal(C.parseNumber('-5'), -5);
  assert.equal(C.parseNumber('0'), 0);
});

test('parseNumber: rejects everything else, including what parseFloat would take', () => {
  assert.equal(C.parseNumber('12abc'), null);
  assert.equal(parseFloat('12abc'), 12);
  for (const bad of ['', '   ', 'abc', 'Infinity', '-Infinity', 'NaN', '1e999', '1.2.3', '$', '%', '--5']) {
    assert.equal(C.parseNumber(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, undefined, 12, {}, [], NaN]) {
    assert.equal(C.parseNumber(bad), null, `must reject ${String(bad)}`);
  }
});

/* ------------------------------------------------------------- formatting */

test('formatters produce the strings the page prints', () => {
  assert.equal(C.money(1647.009), '$1,647.01');
  assert.equal(C.money(0), '$0.00');
  assert.equal(C.moneyWhole(1647.01), '$1,647');
  assert.equal(C.moneyNatural(1000), '$1,000');
  assert.equal(C.moneyNatural(1647.01), '$1,647.01');
  assert.equal(C.pctTrim(0.05), '5%');
  assert.equal(C.pctTrim(0.06125), '6.125%');
  assert.equal(C.pct2(0.05), '5.00%');
  assert.equal(C.multiple(1.647009), '1.65×');
  assert.equal(C.times(0.9048), '0.90');
  assert.equal(C.numTrim(10), '10');
  assert.equal(C.numTrim(10.5), '10.5');
  assert.equal(C.integer(120), '120');
});

test('pctSig keeps the digits that make a periodic rate a rate', () => {
  /* Three fixed decimals would render the daily rate as 0.014%, which is the
     reason this formatter exists at all. */
  assert.equal(C.pctSig(0.05 / 12), '0.4167%');
  assert.equal(C.pctSig(0.05 / 365), '0.0137%');
  assert.equal(C.pctSig(0.05 / 4), '1.25%');
  assert.equal(C.pctSig(0.05), '5%');
});

test('moneySigned: the sign is the content of the column', () => {
  assert.equal(C.moneySigned(18.12), '+$18.12');
  assert.equal(C.moneySigned(-18.12), '−$18.12');
  assert.equal(C.moneySigned(0), '$0.00');
  /* A true minus sign, not a hyphen: the column is read, not parsed. */
  assert.ok(!C.moneySigned(-1).includes('-'));
});

/* --------------------------------------------------------------- grammar */

test('joinList: reads as a sentence at every length', () => {
  assert.equal(C.joinList([]), '');
  assert.equal(C.joinList(['annually']), 'annually');
  assert.equal(C.joinList(['annually', 'monthly']), 'annually and monthly');
  assert.equal(C.joinList(['annually', 'monthly', 'daily']), 'annually, monthly, and daily');
});

test('plural: one period, many periods', () => {
  assert.equal(C.plural(1, 'period'), 'period');
  assert.equal(C.plural(0, 'period'), 'periods');
  assert.equal(C.plural(120, 'period'), 'periods');
  assert.equal(C.plural(1, 'year'), 'year');
});

test('durationText: says what was typed, in the unit it was typed in', () => {
  assert.equal(C.durationText(10, 'years'), '10 years');
  assert.equal(C.durationText(1, 'years'), '1 year');
  assert.equal(C.durationText(10.5, 'years'), '10.5 years');
  assert.equal(C.durationText(1.5, 'months'), '18 months');
  assert.equal(C.durationText(1 / 12, 'months'), '1 month');
  /* A month count that is not whole falls back to years rather than inventing
     a fractional month. */
  assert.equal(C.durationText(1.04, 'months'), '1.04 years');
});

test('the frequency table is the single source of every frequency word', () => {
  assert.equal(C.FREQUENCIES.length, 6);
  for (const f of C.FREQUENCIES) {
    assert.ok(f.key && f.label && f.adverb && f.adjective, `incomplete: ${f.key}`);
    assert.equal(C.frequency(f.key), f);
    if (f.key === 'continuous') assert.equal(f.n, null);
    else assert.equal(f.n, Number(f.key));
  }
});
