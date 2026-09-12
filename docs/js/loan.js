/*
 * Loan calculator: the arithmetic, the formatting, and the wiring, in that
 * order. Written to the same rules as /js/mortgage.js and /js/compound.js -- ES5,
 * `var`, one IIFE, no module, loaded with `defer` -- because there is no build
 * step and there is not going to be one.
 *
 * The single structural idea in this file: the reader supplies an annual nominal
 * rate, a term in years, and a payment cadence, and the calculator derives the
 * two numbers the formula actually runs on, i = r/f and n = years * f. Those
 * derivations are the lesson, so they are never asked for and always shown.
 *
 * The second idea, which the sibling mortgage page shares: money is integer cents
 * from the moment it is parsed until the moment it is formatted. A schedule can
 * accumulate two thousand roundings, and a column that does not add up is worse
 * than no column.
 */
(function () {
  'use strict';

  /* ================================================================
   * Pure arithmetic. No DOM, no formatting, no globals.
   * The Node test runner loads exactly these; see the export tail.
   * ================================================================ */

  /*
   * Below this the closed form loses all significance in its own denominator:
   * `1 - (1 + i)^-n` underflows toward zero while the numerator does too, and the
   * quotient stops meaning anything. The difference from the P/n limit is under a
   * hundredth of a cent on any loan a person could take out, so treating it as
   * zero is both safer and truer.
   */
  var NEAR_ZERO_RATE = 1e-9;

  /*
   * 40 years of weekly payments, which is the largest schedule the form can ask
   * for. The mortgage page's equivalent is 600, because it has one cadence; this
   * page has four, and the longest of them is what the bound has to cover.
   */
  var MAX_PAYMENTS = 2080;

  /*
   * The payment cadences, and the single source of every cadence word on the
   * page. Nothing below may write "monthly" as a literal: the default scenario is
   * monthly, so a hardcoded noun would be invisible until someone switched the
   * select, which is the worst time to find it.
   *
   * `each` is the phrase a sentence uses for the periodic rate ("7% a year is
   * 0.5833% each month"). `period` is the bare noun a table column wants.
   *
   * `calendarExact` records whether f periods land on a calendar year. Twelve
   * months and twenty-four half-months do; twenty-six fortnights and fifty-two
   * weeks both span 364 days against a year of 365.2425, so a five-year term at
   * those cadences is really 4.983 years. The model treats n = years * f as
   * exact, and #assumptions says so because of this flag.
   */
  var FREQUENCIES = [
    { key: '12', f: 12, label: 'Monthly', adverb: 'monthly', adjective: 'monthly',
      period: 'month', each: 'each month', calendarExact: true, daysPerPeriod: null },
    { key: '24', f: 24, label: 'Semimonthly', adverb: 'semimonthly', adjective: 'semimonthly',
      period: 'half-month', each: 'each half-month', calendarExact: true, daysPerPeriod: null },
    { key: '26', f: 26, label: 'Biweekly', adverb: 'biweekly', adjective: 'biweekly',
      period: 'two-week period', each: 'every two weeks', calendarExact: false, daysPerPeriod: 14 },
    { key: '52', f: 52, label: 'Weekly', adverb: 'weekly', adjective: 'weekly',
      period: 'week', each: 'each week', calendarExact: false, daysPerPeriod: 7 }
  ];

  function frequency(key) {
    for (var k = 0; k < FREQUENCIES.length; k++) {
      if (FREQUENCIES[k].key === String(key)) return FREQUENCIES[k];
    }
    return null;
  }

  /* Money is carried as integer cents everywhere between parsing and formatting.
     A 2,080-iteration accumulation of binary fractions is exactly the situation
     where `0.1 + 0.2` stops being a curiosity and starts being a table whose
     column does not add up. */
  function toCents(dollars) { return Math.round(dollars * 100); }
  function fromCents(cents) { return cents / 100; }

  /*
   * The level payment for a fully amortizing, fixed-rate installment loan with
   * the first payment one period after origination.
   *
   *            P * i
   *   M = ----------------
   *        1 - (1 + i)^-n
   *
   * This is the algebraic twin of P * i(1+i)^n / ((1+i)^n - 1), and it is the one
   * to implement: (1+i)^-n is a number in (0,1) for every realistic input, where
   * (1+i)^n at the top of this page's range is a needlessly large value appearing
   * in both numerator and denominator, which is where cancellation error comes
   * from. It is also the form the mortgage page already ships, and two sibling
   * pages disagreeing about which way to write one formula would be a cost paid
   * by the reader for nothing.
   *
   * Returns an unrounded number. Rounding happens once, at the caller.
   */
  function payment(principal, periodicRate, payments) {
    if (!(principal > 0) || !(payments > 0)) return NaN;
    /* 0/0 at i = 0. There is no limit to take here and no series worth expanding:
       a zero-interest loan is P split n ways, which is what the formula tends to. */
    if (periodicRate < NEAR_ZERO_RATE) return principal / payments;
    return principal * periodicRate / (1 - Math.pow(1 + periodicRate, -payments));
  }

  /*
   * The effective annual rate the cadence implies, which is the figure that makes
   * the frequency comparison honest. Four cadences at one nominal rate are four
   * different contracts, not one loan viewed four ways, and this is the number
   * that says so.
   */
  function effectiveAnnualRate(periodicRate, f) {
    if (periodicRate < NEAR_ZERO_RATE) return 0;
    return Math.pow(1 + periodicRate, f) - 1;
  }

  /*
   * The schedule the page actually displays, built by recurrence rather than by
   * closed form, so that the rows sum to the totals printed beside them.
   *
   * Interest is rounded to the cent *before* being subtracted, which is what a
   * servicer does, and which is what makes `interest + principal = payment` hold
   * exactly in every row rather than nearly.
   *
   * `extraCents` is an additional amount applied to principal every period. It
   * needs no branch of its own: it simply raises the amount due, and the early
   * payoff it causes is already covered by the final-payment adjustment below.
   */
  function buildSchedule(principal, periodicRate, payments, pmt, extraCents) {
    var i = periodicRate < NEAR_ZERO_RATE ? 0 : periodicRate;
    var n = Math.min(payments, MAX_PAYMENTS);
    var extra = extraCents > 0 ? extraCents : 0;
    var balance = toCents(principal);
    var due = toCents(pmt) + extra;
    var rows = [];
    var totalInterest = 0;
    var totalPaid = 0;
    var k, interest, toPrincipal, paid;

    /*
     * Bounded by n, so there is no path to an infinite loop even when the payment
     * is smaller than the first period's interest. That case is real rather than
     * theoretical: as n grows, M tends to P*i from above, and once rounded to
     * cents it can equal the first period's interest exactly, at which point a
     * `while (balance > 0)` loop would never terminate. Here the balance simply
     * falls due on the last row, which is the honest depiction of a loan that does
     * not amortize.
     */
    for (k = 1; k <= n; k++) {
      interest = Math.round(balance * i);
      toPrincipal = due - interest;
      paid = due;

      /*
       * Checked before `k === n`, and deliberately in that order. With a rounded
       * payment the loan can retire a period early (the rate rounded down) or
       * leave a few cents standing at n (rounded up), and an extra payment can
       * retire it far earlier than either. One branch covers all three, and the
       * schedule's length is then whatever it truly is rather than whatever was
       * asked for.
       */
      if (toPrincipal >= balance || k === n) {
        toPrincipal = balance;
        paid = toPrincipal + interest;
        balance = 0;
      } else {
        balance -= toPrincipal;
      }

      totalInterest += interest;
      totalPaid += paid;
      rows.push({
        n: k,
        paymentCents: paid,
        interestCents: interest,
        principalCents: toPrincipal,
        balanceCents: balance
      });

      if (balance === 0) break;
    }

    return {
      rows: rows,
      totalInterestCents: totalInterest,
      totalPaidCents: totalPaid,
      /* The last payment is almost never equal to the others, and the page says
         so out loud rather than printing the level payment on the last row and
         claiming the balance reached zero. */
      finalPaymentCents: rows.length ? rows[rows.length - 1].paymentCents : 0,
      firstInterestCents: rows.length ? rows[0].interestCents : 0,
      count: rows.length
    };
  }

  /*
   * f rows at a time. Payment 1 is in year 1, payment f is still year 1. The
   * divisor is the cadence rather than a hardcoded 12, which is the whole reason
   * this is not the mortgage page's function verbatim.
   */
  function summarizeByYear(rows, f) {
    var years = [];
    var current = null;
    var y, row, k;
    for (k = 0; k < rows.length; k++) {
      row = rows[k];
      y = Math.ceil(row.n / f);
      if (!current || current.year !== y) {
        current = { year: y, interestCents: 0, principalCents: 0, endingBalanceCents: 0, payments: 0 };
        years.push(current);
      }
      current.interestCents += row.interestCents;
      current.principalCents += row.principalCents;
      current.payments += 1;
      /* Overwritten each period, so it ends up holding the last one in the year. */
      current.endingBalanceCents = row.balanceCents;
    }
    return years;
  }

  /*
   * The closed form for the balance after k payments. Not used to build the table
   * -- that has to come from the rounded recurrence so the rows add up -- but it
   * is what the page cites when it explains why the balance curve bends, and
   * having it here keeps the claim honest and checkable.
   */
  function balanceAfter(principal, periodicRate, payments, pmt, k) {
    if (periodicRate < NEAR_ZERO_RATE) return Math.max(0, principal - pmt * k);
    var g = Math.pow(1 + periodicRate, k);
    return Math.max(0, principal * g - pmt * (g - 1) / periodicRate);
  }

  /*
   * The same loan at all four cadences. `paidPerYear` is the column that keeps
   * the section honest: the four rows differ in total interest, and a reader who
   * sees only that column concludes the cadence saved them money. It did not.
   * They are four different contracts, and the annual outlay is what shows it.
   */
  function frequencyTable(principal, ratePct, years) {
    var out = [];
    for (var k = 0; k < FREQUENCIES.length; k++) {
      var freq = FREQUENCIES[k];
      var i = ratePct / 100 / freq.f;
      var n = Math.round(years * freq.f);
      var pmt = Math.round(payment(principal, i, n) * 100) / 100;
      var s = buildSchedule(principal, i, n, pmt, 0);
      out.push({
        key: freq.key,
        freq: freq,
        n: n,
        paymentCents: toCents(pmt),
        paidPerYearCents: toCents(pmt) * freq.f,
        totalInterestCents: s.totalInterestCents,
        totalPaidCents: s.totalPaidCents,
        finalPaymentCents: s.finalPaymentCents,
        ear: effectiveAnnualRate(i < NEAR_ZERO_RATE ? 0 : i, freq.f)
      });
    }
    return out;
  }

  /* ================================================================
   * Parsing. One function, used by every field.
   * ================================================================ */

  /*
   * Returns a finite number or null. Never throws, never guesses.
   *
   * `Number()` rather than `parseFloat`, and that is the whole reason this is a
   * function instead of a call site: parseFloat('12abc') is 12, which would let a
   * typo compute a confident wrong answer. Number('12abc') is NaN, which is the
   * truth.
   */
  function parseNumber(str) {
    if (typeof str !== 'string') return null;
    var cleaned = str
      .replace(/[$,\s ]/g, '')  /* pasted currency: "$1,234.56", nbsp included */
      .replace(/%$/, '')             /* pasted rates: "6.5%" */
      .replace(/^\+/, '');
    if (cleaned === '') return null;
    var value = Number(cleaned);
    /* Catches NaN, Infinity, -Infinity, and the strings 'Infinity' and 'NaN',
       all of which Number() is happy to produce. */
    if (!isFinite(value)) return null;
    return value;
  }

  /* ================================================================
   * Formatting. Intl.NumberFormat instances are built once: constructing one
   * per cell would be the single largest cost of a 600-row render, by a wide
   * margin over the arithmetic that produced it.
   * ================================================================ */

  var FMT_MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var FMT_MONEY_WHOLE = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
  var FMT_PCT_TRIM = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 3 });
  var FMT_PCT_4 = new Intl.NumberFormat('en-US', {
    style: 'percent', minimumFractionDigits: 4, maximumFractionDigits: 4
  });
  /*
   * A periodic rate needs significant digits rather than decimal places: 0.4167%
   * a month and 0.1346% every two weeks are the same kind of number, and a fixed
   * two decimals would print both as 0.42% and 0.13%, which throws away the
   * digits that make it a rate.
   */
  var FMT_PCT_SIG = new Intl.NumberFormat('en-US', {
    style: 'percent', maximumSignificantDigits: 4
  });
  var FMT_NUM_TRIM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  var FMT_INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  function money(n) { return FMT_MONEY.format(n); }
  function moneyWhole(n) { return FMT_MONEY_WHOLE.format(n); }
  function moneyCents(c) { return FMT_MONEY.format(fromCents(c)); }
  function moneyWholeCents(c) { return FMT_MONEY_WHOLE.format(fromCents(c)); }
  /* ".00" on a $25,000 loan is clutter in a sentence, and dropping it from a
     $495.03 payment would be a lie. */
  function moneyNatural(n) { return toCents(n) % 100 === 0 ? moneyWhole(n) : money(n); }
  function moneyNaturalCents(c) { return c % 100 === 0 ? moneyWholeCents(c) : moneyCents(c); }
  /* 7% reads as "7%" and 7.125% reads as "7.125%": the trailing zeros are noise
     on a round rate and the digits are load-bearing on a quoted one. */
  function pctTrim(n) { return FMT_PCT_TRIM.format(n); }
  /* The effective annual rate, where the fourth decimal is the entire content of
     the comparison: 7.2290% against 7.2458% is the whole cadence story. */
  function pctEar(n) { return FMT_PCT_4.format(n); }
  function pctSig(n) { return FMT_PCT_SIG.format(n); }
  function numTrim(n) { return FMT_NUM_TRIM.format(n); }
  function integer(n) { return FMT_INT.format(n); }

  /*
   * "+$118.61", "-$118.61", "$0.00", with a true minus sign. Used only in the
   * sensitivity columns, where the sign is the entire content of the cell.
   */
  function moneySigned(cents) {
    if (cents === 0) return money(0);
    return (cents > 0 ? '+' : '−') + moneyCents(Math.abs(cents));
  }

  /*
   * A difference between two figures the page has already printed, taken from the
   * printed values rather than from the ones behind them. A delta column that
   * cannot be checked against the rows beside it is worse than one that is a
   * hundredth of a cent coarse. Everything on this page is already in integer
   * cents, so this is subtraction with a name -- but the name is the point: it
   * marks the places where a reader is expected to check the arithmetic by
   * subtracting two cells.
   */
  function centDelta(a, b) { return a - b; }

  /*
   * "taxes", "taxes and insurance", "taxes, insurance, and dues". One helper,
   * and it is the difference between a paragraph and a run of fragments.
   */
  function joinList(items) {
    if (!items || !items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : (pluralForm || singular + 's');
  }

  /* "5 years", "1 year", "4.58 years". */
  function durationText(years) {
    return numTrim(years) + ' ' + plural(Math.abs(years - 1) < 1e-9 ? 1 : 2, 'year');
  }

  /*
   * How long a run of n payments at cadence f actually lasts, said the way a
   * person would: "4 years and 11 months", not "4.92 years". Used for the payoff
   * time an extra payment produces, where the difference between 4.58 years and
   * "4 years and 7 months" is the difference between a figure and an answer.
   */
  function payoffText(count, f) {
    var years = count / f;
    var whole = Math.floor(years + 1e-9);
    var months = Math.round((years - whole) * 12);
    if (months === 12) { whole += 1; months = 0; }
    if (whole === 0 && months === 0) return 'under a month';
    if (months === 0) return integer(whole) + ' ' + plural(whole, 'year');
    if (whole === 0) return integer(months) + ' ' + plural(months, 'month');
    return integer(whole) + ' ' + plural(whole, 'year') + ' and ' +
      integer(months) + ' ' + plural(months, 'month');
  }

  /* ================================================================
   * Chart geometry. Pure string building, so the same functions that draw
   * the live SVG also generated the static `d` attributes sitting in the
   * page's markup -- the no-JavaScript chart is not a hand-drawn imitation
   * of the real one, it IS the real one, rendered ahead of time.
   * ================================================================ */

  /*
   * The plot is stretched to whatever width it is given by
   * preserveAspectRatio="none", so these are arbitrary units, not pixels, and
   * nothing measures the element. Every label lives in HTML outside the <svg>
   * for the same reason: text would stretch with the plot.
   */
  var CHART_W = 640;
  var CHART_H = 240;

  function plotX(index, count) {
    return count < 2 ? 0 : (index / (count - 1)) * CHART_W;
  }
  function plotY(value, max) {
    if (!(max > 0)) return CHART_H;
    return CHART_H - (value / max) * CHART_H;
  }
  /* Two decimals is well past the resolution of any screen this renders on, and
     it keeps the `d` attribute short enough to read in view-source. */
  function pt(x, y) { return x.toFixed(2) + ',' + y.toFixed(2); }

  function seriesLine(values, max) {
    var d = '';
    for (var k = 0; k < values.length; k++) {
      d += (k === 0 ? 'M' : 'L') + pt(plotX(k, values.length), plotY(values[k], max));
    }
    return d;
  }

  /* The line, closed down to the baseline and back. */
  function seriesArea(values, max) {
    if (!values.length) return '';
    return seriesLine(values, max) +
      'L' + pt(CHART_W, CHART_H) + 'L' + pt(0, CHART_H) + 'Z';
  }

  /* A ribbon between two series: out along the top, back along the bottom. */
  function seriesBand(lower, upper, max) {
    if (!upper.length) return '';
    var d = seriesLine(upper, max);
    for (var k = lower.length - 1; k >= 0; k--) {
      d += 'L' + pt(plotX(k, lower.length), plotY(lower[k], max));
    }
    return d + 'Z';
  }

  /* ================================================================
   * The model. Still pure: values in, one object out, no DOM anywhere.
   * Everything the page displays is a field of this object, which is what
   * lets the static markup in the page be generated by the same code that
   * updates it later.
   * ================================================================ */

  var HARD_MAX_MONEY = 100000000;   /* $100M. Past this a schedule is theatre. */
  /*
   * The mortgage page stops at 25%, which is right for a mortgage and too low
   * here. Legitimate subprime personal loans reach 36%, which is where U.S.
   * consumer-lending convention places the responsible-lending ceiling, so that
   * is the warning rather than the wall. 60 is the wall.
   */
  var HARD_MAX_RATE = 60;           /* Percent. Rejected above. */
  var WARN_RATE = 36;               /* Percent. Computed, but flagged. */
  var HARD_MAX_YEARS = 40;
  var WARN_YEARS = 30;

  /*
   * The cap on the per-payment table. Forty years of weekly payments is 2,080
   * rows and roughly ten thousand nodes, which is a page that stops responding
   * rather than a table anyone reads. Above the cap the table shows the first 600
   * and its caption says so, pointing at the yearly table for the rest.
   */
  var PAYMENT_ROWS = 600;

  function buildModel(v) {
    var freq = frequency(v.frequencyKey) || FREQUENCIES[0];
    var f = freq.f;
    var ratePct = v.ratePct;
    var i = ratePct / 100 / f;
    var years = v.years;
    var n = Math.round(years * f);
    var principal = v.principal;
    var extraCents = v.extra != null && v.extra > 0 ? toCents(v.extra) : 0;

    var unrounded = payment(principal, i, n);
    var pmt = Math.round(unrounded * 100) / 100;
    var schedule = buildSchedule(principal, i, n, pmt, extraCents);
    var yearly = summarizeByYear(schedule.rows, f);
    var first = schedule.rows[0];
    var last = schedule.rows[schedule.rows.length - 1];
    var paymentCents = toCents(pmt);

    /*
     * The baseline the extras are measured against: the same loan with nothing
     * added. Computed even when there is no extra payment, because the phase-2
     * result block and the prose both need a comparison that exists rather than
     * one assembled at the call site.
     */
    var base = extraCents > 0 ? buildSchedule(principal, i, n, pmt, 0) : schedule;

    return {
      principal: principal,
      ratePct: ratePct,
      rate: ratePct / 100,
      freq: freq,
      f: f,
      periodicRate: i < NEAR_ZERO_RATE ? 0 : i,
      ear: effectiveAnnualRate(i < NEAR_ZERO_RATE ? 0 : i, f),
      years: years,
      durationText: durationText(years),
      n: n,
      unroundedPayment: unrounded,
      payment: pmt,
      paymentCents: paymentCents,
      extraCents: extraCents,
      duePerPeriodCents: paymentCents + extraCents,
      paidPerYearCents: (paymentCents + extraCents) * f,
      schedule: schedule,
      yearly: yearly,
      firstRow: first,
      lastRow: last,
      count: schedule.count,
      payoffText: payoffText(schedule.count, f),
      totalInterestCents: schedule.totalInterestCents,
      totalPaidCents: schedule.totalPaidCents,
      finalPaymentCents: schedule.finalPaymentCents,
      /*
       * True when the level payment does not cover the first period's interest,
       * at which point the loan never amortizes and the whole balance falls due
       * on the last row. The panel warns rather than printing the schedule as
       * though it were ordinary.
       */
      doesNotAmortize: schedule.rows.length > 0 &&
        (paymentCents + extraCents) <= schedule.firstInterestCents,
      /* A final payment far larger than the others is the same hazard seen from
         the other end, and it fires on cases the test above misses. */
      finalPaymentOutsized: schedule.finalPaymentCents > 2 * (paymentCents + extraCents),
      baseSchedule: base,
      interestSavedCents: base.totalInterestCents - schedule.totalInterestCents,
      periodsSaved: base.count - schedule.count
    };
  }

  /* ================================================================
   * Node's test runner loads this file to exercise the functions above. In a
   * browser `module` is undefined, the block is skipped, and the file stays a
   * plain script -- no bundler, no build step, no type="module". The
   * alternative, a second copy of the maths inside the test, would test code
   * that is not the code that ships.
   * ================================================================ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      NEAR_ZERO_RATE: NEAR_ZERO_RATE,
      MAX_PAYMENTS: MAX_PAYMENTS,
      PAYMENT_ROWS: PAYMENT_ROWS,
      HARD_MAX_MONEY: HARD_MAX_MONEY,
      HARD_MAX_RATE: HARD_MAX_RATE,
      WARN_RATE: WARN_RATE,
      HARD_MAX_YEARS: HARD_MAX_YEARS,
      WARN_YEARS: WARN_YEARS,
      FREQUENCIES: FREQUENCIES,
      frequency: frequency,
      toCents: toCents,
      fromCents: fromCents,
      payment: payment,
      effectiveAnnualRate: effectiveAnnualRate,
      buildSchedule: buildSchedule,
      summarizeByYear: summarizeByYear,
      balanceAfter: balanceAfter,
      frequencyTable: frequencyTable,
      parseNumber: parseNumber,
      money: money,
      moneyWhole: moneyWhole,
      moneyCents: moneyCents,
      moneyNatural: moneyNatural,
      moneyNaturalCents: moneyNaturalCents,
      moneySigned: moneySigned,
      pctTrim: pctTrim,
      pctEar: pctEar,
      pctSig: pctSig,
      numTrim: numTrim,
      integer: integer,
      centDelta: centDelta,
      joinList: joinList,
      plural: plural,
      durationText: durationText,
      payoffText: payoffText,
      CHART_W: CHART_W,
      CHART_H: CHART_H,
      seriesLine: seriesLine,
      seriesArea: seriesArea,
      seriesBand: seriesBand,
      buildModel: buildModel
    };
  }
})();
