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
  var FMT_PCT_0 = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
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
  /* "about 19% of what you borrowed": a share of the principal, where a decimal
     place would imply a precision the word "about" has already disclaimed. */
  function pctWhole(n) { return FMT_PCT_0.format(n); }

  /* Cadence adjectives are stored lower case, because that is how they read in
     the middle of a sentence. One of them starts a sentence in the live region. */
  function capitalize(word) { return word.charAt(0).toUpperCase() + word.slice(1); }

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
   * The explanation. A sentence planner rather than string concatenation:
   * each sentence is only built if its condition holds, the paragraph is
   * dropped when nothing survives, and the one place that joins a series is
   * joinList -- which is the difference between prose and fragments.
   *
   * Two rules this page adds to the mortgage page's version. Every cadence word
   * comes from m.freq, because the default scenario is monthly and a hardcoded
   * "monthly" would stay invisible until a reader switched the select. And the
   * degenerate cases get sentences of their own rather than the ordinary ones
   * filled with $0.00: a zero-rate loan has no interest to narrate, and a
   * one-payment loan has no "first payment" to contrast with a later one.
   * ================================================================ */

  function explainParagraphs(m) {
    var zero = m.periodicRate === 0;
    var single = m.count === 1;
    var out = [];
    var s;

    /* --- the setup --- */
    s = ['A ' + moneyNatural(m.principal) + ' loan at ' + pctTrim(m.rate) + ' repaid over ' +
         m.durationText + ', with ' + integer(m.f) + ' payments a year.'];
    out.push(s.join(' '));

    /* --- the arithmetic, made visible --- */
    s = [];
    if (zero) {
      s.push('At ' + pctTrim(0) + ' there is no interest, so every payment is principal and the ' +
             integer(m.n) + ' ' + plural(m.n, 'payment') + ' simply divide the ' +
             moneyNatural(m.principal) + '.');
      s.push('That is ' + money(m.payment) + ' ' + m.freq.each + '.');
    } else {
      s.push(pctTrim(m.rate) + ' a year is ' + pctSig(m.periodicRate) + ' ' + m.freq.each +
             ', and ' + m.durationText + ' of ' + m.freq.adjective + ' payments is ' +
             integer(m.n) + ' of them.');
      s.push('Those two numbers, with the ' + moneyNatural(m.principal) +
             ', are the whole formula. They give ' + money(m.payment) + ' ' + m.freq.each + '.');
    }
    out.push(s.join(' '));

    /* --- what the first payment actually does --- */
    s = [];
    if (zero) {
      s.push('Every payment is principal. There is no interest to separate out, so the balance falls by the same amount each period and the line on the chart below is straight.');
    } else {
      s.push((single ? 'The only payment is ' : 'The first payment is ') +
             moneyCents(m.firstRow.paymentCents) + '. Of that, ' +
             moneyCents(m.firstRow.interestCents) + ' is interest on the full ' +
             moneyNatural(m.principal) + ' and ' + moneyCents(m.firstRow.principalCents) +
             ' comes off the balance.');
      /* "Most" would be wrong at both ends of the range: a payment that retires
         the balance outright has no remainder to be most of, and one that covers
         only the interest leaves nothing for principal at all. */
      if (m.firstRow.principalCents === 0) {
        s.push('None of it reaches the balance, because the interest alone accounts for the whole payment.');
      } else if (single) {
        s.push('There is no schedule to follow: one payment retires the loan.');
      } else if (m.firstRow.interestCents > m.firstRow.principalCents) {
        s.push('Most of that first payment is interest, which is normal and is simply a consequence of the balance being at its largest.');
      } else if (m.firstRow.principalCents > m.firstRow.interestCents) {
        s.push('Most of it already goes to principal, which happens when the rate is low or the term is short.');
      }
    }
    out.push(s.join(' '));

    /* --- how the split moves, and the lifetime totals --- */
    s = [];
    if (m.doesNotAmortize) {
      /*
       * The payment does not cover the first period's interest, so the balance
       * never falls and the whole of it comes due at the end. Saying that
       * plainly is the only honest option; the ordinary sentences would describe
       * a schedule that is not happening.
       */
      s.push('This loan does not amortize. The payment of ' + money(m.payment) +
             ' does not cover the ' + moneyCents(m.firstRow.interestCents) +
             ' of interest the first period charges, so the balance never falls and the whole of it, ' +
             moneyCents(m.finalPaymentCents) + ', comes due on the last payment.');
      s.push('A schedule like this is a sign that the term is too long for the rate, not a plan anyone would be offered.');
    } else if (!single && !zero) {
      var mid = Math.ceil(m.count / 2);
      s.push('By payment ' + integer(mid) + ' the interest share has fallen to ' +
             moneyCents(m.schedule.rows[mid - 1].interestCents) + ', and by the last one it is ' +
             moneyCents(m.lastRow.interestCents) + ' against ' +
             moneyCents(m.lastRow.principalCents) + ' of principal.');
    }
    if (!m.doesNotAmortize) {
      s.push((single ? 'In total you would pay ' : 'Across all ' + integer(m.count) + ' ' +
               plural(m.count, 'payment') + ' you would pay ') +
             moneyCents(m.totalPaidCents) + (zero
               ? ', all of it principal.'
               : ', of which ' + moneyCents(m.totalInterestCents) + ' is interest, about ' +
                 pctWhole(m.totalInterestCents / toCents(m.principal)) + ' of what you borrowed.'));
      if (m.count < m.n && m.extraCents === 0) {
        /* Gated on there being no extra payment. With one, the schedule runs
           short because the reader paid more, which the fifth paragraph says
           properly; blaming rounding there would be plainly false. */
        s.push('The schedule runs to ' + integer(m.count) + ' payments rather than ' + integer(m.n) +
               ', because rounding the payment up to the nearest cent sends slightly more to principal every period than the formula assumed.');
      } else if (m.finalPaymentCents !== m.duePerPeriodCents) {
        if (m.extraCents > 0) {
          /* Same gate, same reason: with an extra payment the short final row is
             a remainder the reader created, not one rounding left behind. */
          s.push('The last payment is only ' + moneyCents(m.finalPaymentCents) +
                 ', because by then the extra had brought the balance down to almost nothing.');
        } else {
          s.push('The last payment is ' + moneyCents(m.finalPaymentCents) + ' rather than ' +
                 moneyCents(m.duePerPeriodCents) + ', because it absorbs what rounding every earlier payment to the cent left over.');
        }
      }
    }
    out.push(s.join(' '));

    /* --- the extra payment, only when there is one --- */
    s = [];
    if (m.extraCents > 0) {
      s.push('You are adding ' + moneyCents(m.extraCents) + ' to every payment, so ' +
             moneyCents(m.duePerPeriodCents) + ' leaves your account ' + m.freq.each +
             ' rather than ' + moneyCents(m.paymentCents) + '.');
      if (m.periodsSaved > 0 || m.interestSavedCents > 0) {
        s.push('That retires the loan in ' + integer(m.count) + ' ' + plural(m.count, 'payment') +
               ' instead of ' + integer(m.baseSchedule.count) + ', which is ' + m.payoffText +
               ' rather than ' + payoffText(m.baseSchedule.count, m.f) + ', and cuts the interest by ' +
               moneyCents(m.interestSavedCents) + '.');
      }
      /*
       * The sentence the section exists for. Every extra-payment feature on
       * every calculator invites the reader to read the saving as something the
       * schedule produced, and it is not: it is the arithmetic of having paid
       * more. Saying so costs one sentence and is the difference between a tool
       * and an advertisement.
       */
      s.push('The saving comes from paying more, not from paying differently: over a year the extra adds up to ' +
             moneyCents(m.extraCents * m.f) + '.');
    }
    out.push(s.join(' '));

    return out;
  }

  /*
   * One line, for the live region. Not the whole explanation: a screen-reader
   * user moving through the fields needs the number, not the essay.
   */
  function summarySentence(m) {
    var line = capitalize(m.freq.adjective) + ' payment: ' + money(m.payment) + '.';
    if (m.extraCents > 0) {
      line += ' With the extra, ' + moneyCents(m.duePerPeriodCents) + '.';
    }
    line += ' Total interest ' + moneyCents(m.totalInterestCents) + ' over ' +
      integer(m.count) + ' ' + plural(m.count, 'payment') + '.';
    return line;
  }

  /*
   * The textual alternative for the charts, which is a real description rather
   * than a restatement of the caption: where the balance starts, how it bends,
   * and where it ends. A reader who cannot see the picture should learn the same
   * thing from this that the picture teaches.
   */
  function chartDescription(m) {
    if (!m.yearly.length) return '';
    var parts = [];
    var last = m.yearly.length;
    parts.push('The balance starts at ' + moneyNatural(m.principal) + ' and falls to zero over ' +
      integer(last) + ' ' + plural(last, 'year') + '.');
    var samples = [];
    for (var k = 0; k < m.yearly.length; k++) {
      if (k === 0 || k === Math.floor((m.yearly.length - 1) / 2) || k === m.yearly.length - 1) {
        samples.push('year ' + m.yearly[k].year + ', ' + moneyNaturalCents(m.yearly[k].endingBalanceCents));
      }
    }
    parts.push('End of ' + joinList(samples) + '.');
    if (m.periodicRate === 0) {
      parts.push('The line is straight, because every payment reduces the balance by the same amount.');
    } else {
      parts.push('The line is slightly curved rather than straight: early payments are mostly interest, so the balance falls slowly at first and faster as the interest share shrinks.');
    }
    return parts.join(' ');
  }

  /* ================================================================
   * Sensitivity. The same arithmetic run again against inputs the reader did
   * not enter, so that "what if the rate were a point higher" is answered by a
   * schedule rather than by a rule of thumb. A point of rate is worth different
   * money at every principal, term and cadence, which is exactly why the answer
   * cannot be written into the prose once and left there.
   * ================================================================ */

  /* Percentage points, added to the rate the reader entered. */
  var RATE_STEPS = [-2, -1, 0, 1, 2];

  /* Years. The reader's own term joins this list wherever it sorts, so the
     table always contains the row its deltas are measured against. */
  var TERM_STEPS = [3, 5, 7];

  /*
   * One alternative loan, priced from scratch. The payment is rounded to the
   * cent exactly as the headline figure is, and the totals come from a real
   * schedule rather than from payment times n -- so a row in the sensitivity
   * table and the result panel can never disagree about the same loan.
   */
  function scenario(principal, ratePct, years, f, extraCents) {
    var i = ratePct / 100 / f;
    var n = Math.round(years * f);
    var pmt = Math.round(payment(principal, i, n) * 100) / 100;
    var s = buildSchedule(principal, i, n, pmt, extraCents || 0);
    return {
      ratePct: ratePct,
      years: years,
      f: f,
      n: n,
      paymentCents: toCents(pmt),
      totalInterestCents: s.totalInterestCents,
      totalPaidCents: s.totalPaidCents,
      count: s.count
    };
  }

  function withDeltas(s, m, isCurrent) {
    s.current = !!isCurrent;
    /* Deltas are taken between two figures the page has already printed, so a
       reader who subtracts two cells gets the number the delta column shows. */
    s.paymentDeltaCents = centDelta(s.paymentCents, m.paymentCents);
    s.interestDeltaCents = centDelta(s.totalInterestCents, m.totalInterestCents);
    return s;
  }

  /* Rates carry three decimals at most, and 6.1 - 0.5 is 5.6000000000000005 in
     binary. Rounding here is what lets the current row be found by equality
     rather than by tolerance. */
  function stepRate(ratePct, step) {
    return Math.round((ratePct + step) * 1000) / 1000;
  }

  function sensitivity(m) {
    var rates = [];
    var terms = [];
    var seen = {};
    var years = TERM_STEPS.slice();
    var k, r, y;

    for (k = 0; k < RATE_STEPS.length; k++) {
      r = stepRate(m.ratePct, RATE_STEPS[k]);
      /*
       * Anything the form itself would reject is left out of the table. A
       * scenario the calculator refuses to compute is not a scenario worth
       * offering, and a clamped row would be a different loan wearing the label
       * of the one asked for.
       */
      if (r < 0 || r > HARD_MAX_RATE || seen[r]) continue;
      seen[r] = true;
      rates.push(withDeltas(scenario(m.principal, r, m.years, m.f, m.extraCents), m, RATE_STEPS[k] === 0));
    }

    if (years.indexOf(m.years) === -1) years.push(m.years);
    years.sort(function (a, b) { return a - b; });
    for (k = 0; k < years.length; k++) {
      y = years[k];
      if (y <= 0 || y > HARD_MAX_YEARS || Math.round(y * m.f) > MAX_PAYMENTS) continue;
      terms.push(withDeltas(scenario(m.principal, m.ratePct, y, m.f, m.extraCents), m, y === m.years));
    }

    return { rates: rates, terms: terms };
  }

  function findRate(rows, ratePct) {
    for (var k = 0; k < rows.length; k++) if (rows[k].ratePct === ratePct) return rows[k];
    return null;
  }

  /*
   * The caption is the whole point of the rate table: the table shows five
   * loans, and this says what the distance between two of them costs. Taken from
   * a row rather than from a remembered figure, and phrased downward when a rate
   * a point higher would be outside what the form accepts.
   */
  function rateCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' over ' + m.durationText +
      ', paid ' + m.freq.adverb + ', priced at other rates. Your own row is marked.';
    var up = findRate(rows, stepRate(m.ratePct, 1));
    var down = findRate(rows, stepRate(m.ratePct, -1));
    if (up) {
      return lead + ' One percentage point more would add ' + moneyCents(up.paymentDeltaCents) +
        ' to each payment, and ' + moneyCents(up.interestDeltaCents) + ' in interest over the whole term.';
    }
    if (down) {
      return lead + ' One percentage point less would save ' + moneyCents(-down.paymentDeltaCents) +
        ' on each payment, and ' + moneyCents(-down.interestDeltaCents) + ' in interest over the whole term.';
    }
    return lead;
  }

  /*
   * The term table's trade is the one people most often take only half of: the
   * payment and the total move in opposite directions, and both numbers belong
   * in the same sentence.
   */
  function termCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) +
      ', over other terms. Your own row is marked.';
    if (m.periodicRate === 0) {
      /* At a zero rate there is no interest for a shorter term to save, and a
         caption that claimed one would be the easiest false sentence on the
         page to write. The mortgage suite pins the analogue. */
      return lead + ' At a zero rate the term changes the payment and nothing else: there is no interest for a shorter term to save.';
    }
    var shorter = null;
    var longer = null;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].years < m.years) shorter = rows[k];
      else if (rows[k].years > m.years && !longer) longer = rows[k];
    }
    if (shorter) {
      return lead + ' Retiring it in ' + durationText(shorter.years) + ' rather than ' + m.durationText +
        ' would raise each payment by ' + moneyCents(shorter.paymentDeltaCents) +
        ' and cut the interest by ' + moneyCents(-shorter.interestDeltaCents) + '.';
    }
    if (longer) {
      return lead + ' Spreading it over ' + durationText(longer.years) + ' rather than ' + m.durationText +
        ' would lower each payment by ' + moneyCents(-longer.paymentDeltaCents) +
        ' and add ' + moneyCents(longer.interestDeltaCents) + ' in interest.';
    }
    return lead;
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
      pctWhole: pctWhole,
      capitalize: capitalize,
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
      buildModel: buildModel,
      explainParagraphs: explainParagraphs,
      summarySentence: summarySentence,
      chartDescription: chartDescription,
      RATE_STEPS: RATE_STEPS,
      TERM_STEPS: TERM_STEPS,
      scenario: scenario,
      stepRate: stepRate,
      sensitivity: sensitivity,
      rateCaptionText: rateCaptionText,
      termCaptionText: termCaptionText
    };
  }
  /* ================================================================
   * The DOM layer. Everything above this line is testable in Node;
   * everything below it touches the page.
   *
   * Every lookup is guarded, in the same way and for the same reason as
   * /js/main.js: nothing here may throw on a page that does not contain the
   * calculator, and a missing element must degrade to "that part does not
   * update" rather than to "the script died on line one".
   * ================================================================ */

  /*
   * Everything from here down is browser-only, and it sits AFTER the export
   * block above for exactly that reason: Node loads this file to test the maths,
   * and `document` does not exist there. In a browser without the calculator on
   * the page, any other page that happened to include this script, the same
   * guard returns before touching anything.
   */
  if (typeof document === 'undefined') return;

  function $(id) { return document.getElementById(id); }

  var form = $('calc-form');
  if (!form) return;

  var ui = {
    principal: $('principal'),
    rate: $('rate'),
    term: $('term'),
    termOtherWrap: $('term-other-wrap'),
    termOther: $('term-other'),
    termReadout: $('term-readout'),
    frequency: $('payment-frequency'),
    extra: $('extra'),
    reset: $('reset'),

    status: $('calc-status'),
    resultPanel: $('result-panel'),
    resultLabel: $('result-label'),
    resultAmount: $('result-amount'),
    staleNote: $('result-stale-note'),
    totalInterest: $('result-interest'),
    totalPaid: $('result-total'),
    paymentCount: $('result-count'),
    finalPayment: $('result-final'),
    early: $('result-early'),
    earlyAmount: $('result-early-amount'),
    earlyNote: $('result-early-note'),
    resultWarn: $('result-warn'),

    pPrincipal: $('p-principal'),
    pRate: $('p-rate'),
    pFreq: $('p-freq'),
    pTerm: $('p-term'),
    pPeriodic: $('p-periodic'),
    pCount: $('p-count'),
    pPayment: $('p-payment'),

    explain: $('explain'),
    substitution: $('substitution-math'),
    substitutionCaption: $('substitution-caption'),
    finalSentence: $('final-sentence'),

    freqBody: $('freq-table'),
    freqCaption: $('freq-caption'),

    sensRateBody: $('sens-rate-body'),
    sensRateCaption: $('sens-rate-caption'),
    sensTermBody: $('sens-term-body'),
    sensTermCaption: $('sens-term-caption'),

    yearlyBody: $('amort-yearly'),
    yearlyCaption: $('amort-yearly-caption'),
    paymentsDetails: $('payments-disclosure'),
    paymentsBody: $('amort-payments'),
    paymentsCaption: $('amort-payments-caption'),

    balanceArea: $('chart-balance-area'),
    balanceLine: $('chart-balance-line'),
    balanceMax: $('chart-balance-ymax'),
    balanceEnd: $('chart-balance-xmax'),
    balanceDesc: $('chart-balance-desc'),
    compInterest: $('chart-comp-interest'),
    compInterestHatch: $('chart-comp-interest-hatch'),
    compPrincipal: $('chart-comp-principal'),
    compMax: $('chart-comp-ymax'),
    compEnd: $('chart-comp-xmax'),
    compDesc: $('chart-comp-desc')
  };

  /*
   * The only interaction state on the page. Everything else is derived from the
   * inputs on every keystroke, because recomputing even a 2,080-row schedule
   * costs tens of microseconds and caching it would buy nothing but staleness.
   */
  var state = {
    /*
     * The per-payment table is the one place where doing the obvious thing on
     * every keystroke would be felt: at 52 payments a year it reaches the 600-row
     * cap, which is 3,000 elements. Rebuilt when the disclosure is open, marked
     * dirty when it is not.
     */
    paymentsDirty: true,
    lastModel: null
  };

  /* ---------------- reading the form ---------------- */

  function fieldValue(input) {
    return input ? parseNumber(input.value) : null;
  }

  /*
   * Two levels, and the distinction is the whole validation policy: an error
   * freezes the display, a warning computes anyway. Nothing is ever silently
   * clamped, because a clamped figure is an answer to a question the reader did
   * not ask, wearing the label of the one they did.
   */
  function readInputs() {
    var errors = {};
    var warnings = {};

    var principal = fieldValue(ui.principal);
    if (principal == null) {
      errors.principal = 'Enter the amount you are borrowing.';
    } else if (principal <= 0) {
      errors.principal = 'The loan amount has to be more than zero.';
    } else if (principal > HARD_MAX_MONEY) {
      errors.principal = 'Enter an amount up to ' + moneyWhole(HARD_MAX_MONEY) + '.';
    }

    var ratePct = fieldValue(ui.rate);
    if (ratePct == null) {
      errors.rate = 'Enter the annual interest rate.';
    } else if (ratePct < 0) {
      errors.rate = 'The rate cannot be negative on a loan.';
    } else if (ratePct > HARD_MAX_RATE) {
      errors.rate = 'Enter a rate up to ' + HARD_MAX_RATE + '%.';
    } else if (ratePct > WARN_RATE) {
      warnings.rate = 'Above ' + WARN_RATE + '%, which is where United States consumer-lending convention places the responsible-lending ceiling. The arithmetic still holds.';
    }

    /* The select carries the term unless it is set to "other", in which case the
       revealed text field does. One of the two is always the source. */
    /*
     * Keyed under 'term' whichever control supplied the value. The select and the
     * "Other" field share one warn element and one error element, because both
     * are the same question and both are named by the same aria-describedby
     * chain. Keying a message under 'term-other' would write it to an element
     * that does not exist, and the reader would be refused without being told.
     */
    var usingOther = ui.term && ui.term.value === 'other';
    var years = usingOther ? fieldValue(ui.termOther) : (ui.term ? Number(ui.term.value) : null);
    if (years == null || !isFinite(years) || years === 0 && !usingOther) {
      errors.term = 'Enter the term in years.';
    } else if (years <= 0) {
      errors.term = 'The term has to be more than zero.';
    } else if (years > HARD_MAX_YEARS) {
      errors.term = 'Enter a term up to ' + HARD_MAX_YEARS + ' years.';
    } else if (years > WARN_YEARS) {
      warnings.term = 'Longer than ' + WARN_YEARS + ' years, which is unusual outside a mortgage.';
    }

    var frequencyKey = ui.frequency ? ui.frequency.value : '12';
    if (!frequency(frequencyKey)) {
      errors.frequency = 'Choose how often you pay.';
      frequencyKey = '12';
    }

    /* Blank means no extra payment, which is different from zero only in that it
       is what the field ships as. Both produce the same schedule. */
    var extra = null;
    if (ui.extra && ui.extra.value.trim() !== '') {
      extra = fieldValue(ui.extra);
      if (extra == null) {
        errors.extra = 'Enter an amount, or leave this blank.';
      } else if (extra < 0) {
        errors.extra = 'An extra payment cannot be negative.';
      } else if (extra > HARD_MAX_MONEY) {
        errors.extra = 'Enter an amount up to ' + moneyWhole(HARD_MAX_MONEY) + '.';
      }
    }

    return {
      errors: errors,
      warnings: warnings,
      values: {
        principal: principal,
        ratePct: ratePct,
        years: years,
        frequencyKey: frequencyKey,
        extra: extra
      }
    };
  }

  /* ---------------- validation UI ---------------- */

  /*
   * The message element is in the DOM from the start and referenced by
   * aria-describedby from the start, so turning it on is a `hidden` toggle and
   * not a change of accessible description. Toggled via the property rather than
   * a style, so the attribute stays the single source of truth.
   */
  function setMessage(fieldId, suffix, body) {
    var node = $(fieldId + '-' + suffix);
    if (node) {
      node.hidden = !body;
      if (body) node.textContent = body;
    }
    if (suffix === 'error') {
      /* aria-invalid belongs on the control the reader is actually using, which
         for the term is whichever of the select and the "Other" field is live. */
      var input = fieldId === 'term' && ui.term && ui.term.value === 'other' ? ui.termOther : $(fieldId);
      if (input) {
        if (body) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }
  }

  var MESSAGE_FIELDS = ['principal', 'rate', 'term', 'extra'];

  function paintMessages(errors, warnings) {
    for (var k = 0; k < MESSAGE_FIELDS.length; k++) {
      var id = MESSAGE_FIELDS[k];
      setMessage(id, 'error', errors[id] || '');
      setMessage(id, 'warn', warnings[id] || '');
    }
  }

  /* ---------------- rendering ---------------- */

  function text(node, value) { if (node) node.textContent = value; }

  /* A short decimal, for the parameter table and the substitution: 7% is 0.07,
     not 0.07000000000000001. */
  function decimalText(value) {
    return String(Math.round(value * 1e10) / 1e10);
  }

  function renderParams(m) {
    text(ui.pPrincipal, moneyNatural(m.principal));
    text(ui.pRate, decimalText(m.rate) + ' (' + pctTrim(m.rate) + ')');
    text(ui.pFreq, integer(m.f) + ' (' + m.freq.adverb + ')');
    text(ui.pTerm, m.durationText);
    text(ui.pPeriodic, pctSig(m.periodicRate) + ' ' + m.freq.each);
    text(ui.pCount, integer(m.n) + ' ' + plural(m.n, 'payment'));
    text(ui.pPayment, money(m.payment));
  }

  function renderResults(m) {
    /* The label is the cadence, so it cannot be static markup the way the
       mortgage page's is. "Monthly payment" is wrong the moment f changes. */
    text(ui.resultLabel, capitalize(m.freq.adjective) + ' payment');
    text(ui.resultAmount, money(m.payment));
    text(ui.totalInterest, moneyCents(m.totalInterestCents));
    text(ui.totalPaid, moneyCents(m.totalPaidCents));
    text(ui.paymentCount, integer(m.count));
    text(ui.finalPayment, moneyCents(m.finalPaymentCents));

    if (ui.early) {
      ui.early.hidden = m.extraCents === 0;
      if (m.extraCents > 0) {
        text(ui.earlyAmount, moneyCents(m.duePerPeriodCents) + ' ' + m.freq.each);
        text(ui.earlyNote, 'Retired in ' + m.payoffText + ' rather than ' +
          payoffText(m.baseSchedule.count, m.f) + ', with ' +
          moneyCents(m.interestSavedCents) + ' less interest. The extra costs ' +
          moneyCents(m.extraCents * m.f) + ' a year.');
      }
    }

    /*
     * Two warnings, and both describe a schedule that is technically correct and
     * practically absurd. Saying so is better than printing it deadpan.
     */
    if (ui.resultWarn) {
      var warning = '';
      if (m.doesNotAmortize) {
        warning = 'This loan does not amortize: the payment does not cover the first period’s interest, so the whole balance falls due on the last payment.';
      } else if (m.finalPaymentOutsized) {
        warning = 'The final payment is more than twice the others, because the level payment barely covers the interest.';
      }
      ui.resultWarn.hidden = !warning;
      if (warning) text(ui.resultWarn, warning);
    }

    text(ui.termReadout, integer(m.n) + ' ' + m.freq.adjective + ' ' + plural(m.n, 'payment'));

    if (ui.finalSentence) {
      text(ui.finalSentence, m.finalPaymentCents === m.duePerPeriodCents
        ? moneyCents(m.finalPaymentCents) + ', the same as the others this time'
        : moneyCents(m.finalPaymentCents) + ' rather than ' + moneyCents(m.duePerPeriodCents));
    }
  }

  /*
   * Rebuilt in full on every input event. Five short strings is free, and
   * diffing them would buy nothing except the possibility of a stale fragment
   * surviving a branch change. A paragraph whose sentences all filtered out is
   * hidden rather than left standing as an empty line, and no node is ever added
   * or removed, so the accessible description never changes shape.
   */
  function renderExplanation(m) {
    if (!ui.explain) return;
    var paragraphs = explainParagraphs(m);
    var nodes = ui.explain.getElementsByTagName('p');
    for (var k = 0; k < nodes.length; k++) {
      var body = paragraphs[k] || '';
      nodes[k].hidden = !body;
      if (body) nodes[k].textContent = body;
    }
  }

  /* ---------------- the worked substitution ---------------- */

  /*
   * The formula with the reader's own figures in it, rebuilt as real MathML
   * rather than as a string of characters that resemble mathematics. Built with
   * createElementNS and textContent throughout: this file has no route to
   * innerHTML, and the test suite fails if it grows one.
   */
  var MATHML = 'http://www.w3.org/1998/Math/MathML';

  function mel(tag, value) {
    var node = document.createElementNS(MATHML, tag);
    if (value != null) node.appendChild(document.createTextNode(value));
    return node;
  }

  function mrow(parts) {
    var row = mel('mrow');
    for (var k = 0; k < parts.length; k++) row.appendChild(parts[k]);
    return row;
  }

  function mfrac(numerator, denominator) {
    var frac = mel('mfrac');
    frac.appendChild(numerator);
    frac.appendChild(denominator);
    return frac;
  }

  function renderSubstitution(m) {
    if (!ui.substitution) return;

    var body;
    if (m.periodicRate === 0) {
      /*
       * At a zero rate the discount form is 0/0 and the page uses the limit it
       * tends to. Showing the reader the undefined expression with their figures
       * in it would be showing them the wrong equation.
       */
      body = [mel('mi', 'M'), mel('mo', '='),
        mfrac(mel('mn', moneyNatural(m.principal)), mel('mn', integer(m.n)))];
    } else {
      var periodic = mfrac(mel('mn', decimalText(m.rate)), mel('mn', integer(m.f)));
      var periodicAgain = mfrac(mel('mn', decimalText(m.rate)), mel('mn', integer(m.f)));
      var numerator = mrow([mel('mn', moneyNatural(m.principal)), mel('mo', '⁢'), periodic]);
      var base = mrow([mel('mo', '('), mel('mn', '1'), mel('mo', '+'), periodicAgain, mel('mo', ')')]);
      var power = mel('msup');
      power.appendChild(base);
      power.appendChild(mrow([mel('mo', '−'), mel('mn', integer(m.n))]));
      var denominator = mrow([mel('mn', '1'), mel('mo', '−'), power]);
      body = [mel('mi', 'M'), mel('mo', '='), mfrac(numerator, denominator)];
    }
    body.push(mel('mo', '≈'));
    body.push(mel('mn', money(m.payment)));

    var math = document.createElementNS(MATHML, 'math');
    math.setAttribute('display', 'block');
    math.appendChild(mrow(body));
    replace(ui.substitution, math);

    /* The figure's caption is its accessible name, so it has to be regenerated
       alongside the expression rather than left describing the default. */
    text(ui.substitutionCaption, m.periodicRate === 0
      ? 'At a zero rate the formula is the loan divided by the number of payments.'
      : 'The formula with your figures in it.');
  }

  /* ---------------- tables ---------------- */

  function cell(tag, value, scope) {
    var td = document.createElement(tag);
    if (scope) td.setAttribute('scope', scope);
    td.appendChild(document.createTextNode(value));
    return td;
  }

  /* replaceChildren is the one-call version; the loop is the fallback for an
     engine that predates it, and both are a single reflow. */
  function replace(parent, node) {
    if (parent.replaceChildren) parent.replaceChildren(node);
    else {
      while (parent.firstChild) parent.removeChild(parent.firstChild);
      parent.appendChild(node);
    }
  }

  function renderYearly(m) {
    if (!ui.yearlyBody) return;
    var frag = document.createDocumentFragment();
    for (var k = 0; k < m.yearly.length; k++) {
      var y = m.yearly[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', integer(y.year), 'row'));
      tr.appendChild(cell('td', integer(y.payments)));
      tr.appendChild(cell('td', moneyCents(y.interestCents)));
      tr.appendChild(cell('td', moneyCents(y.principalCents)));
      tr.appendChild(cell('td', moneyCents(y.endingBalanceCents)));
      frag.appendChild(tr);
    }
    replace(ui.yearlyBody, frag);
    text(ui.yearlyCaption, scenarioLead(m) +
      ', summarised a year at a time. Interest and principal are the totals for the year; the balance is what stands at the end of it.');
  }

  function renderPayments(m) {
    if (!ui.paymentsBody) return;
    var shown = Math.min(m.schedule.rows.length, PAYMENT_ROWS);
    var frag = document.createDocumentFragment();
    for (var k = 0; k < shown; k++) {
      var r = m.schedule.rows[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', integer(r.n), 'row'));
      tr.appendChild(cell('td', moneyCents(r.paymentCents)));
      tr.appendChild(cell('td', moneyCents(r.interestCents)));
      tr.appendChild(cell('td', moneyCents(r.principalCents)));
      tr.appendChild(cell('td', moneyCents(r.balanceCents)));
      frag.appendChild(tr);
    }
    replace(ui.paymentsBody, frag);
    /* The cap is disclosed in the caption rather than left for the reader to
       discover by counting. At 52 payments a year over 40 years the full
       schedule is 2,080 rows, which is a page that stops responding. */
    text(ui.paymentsCaption, shown < m.schedule.rows.length
      ? 'The first ' + integer(shown) + ' of ' + integer(m.schedule.rows.length) +
        ' payments, one row each. The rest are summarised in the yearly table above.'
      : 'All ' + integer(shown) + ' ' + plural(shown, 'payment') + ', one row each.');
    state.paymentsDirty = false;
  }

  function renderFrequency(m) {
    if (!ui.freqBody) return;
    var rows = frequencyTable(m.principal, m.ratePct, m.years);
    var frag = document.createDocumentFragment();
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var tr = document.createElement('tr');
      if (r.key === m.freq.key) {
        tr.setAttribute('aria-current', 'true');
        tr.className = 'sens__row--current';
      }
      tr.appendChild(cell('th', r.freq.label, 'row'));
      tr.appendChild(cell('td', integer(r.n)));
      tr.appendChild(cell('td', moneyCents(r.paymentCents)));
      tr.appendChild(cell('td', moneyCents(r.paidPerYearCents)));
      tr.appendChild(cell('td', moneyCents(r.totalInterestCents)));
      tr.appendChild(cell('td', pctEar(r.ear)));
      frag.appendChild(tr);
    }
    replace(ui.freqBody, frag);
    text(ui.freqCaption, 'The same ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) +
      ' over ' + m.durationText + ', at each cadence the calculator offers. Read the paid per year column before the interest column.');
  }

  function sensRows(rows, kind) {
    var frag = document.createDocumentFragment();
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var tr = document.createElement('tr');
      var th = cell('th', kind === 'rate' ? pctTrim(r.ratePct / 100) : durationText(r.years), 'row');
      if (r.current) {
        /*
         * The marker is a word, not a tint. Colour alone would not survive
         * forced-colors mode, a monochrome print, or a reader who cannot see
         * it, and this row is the one every other row is measured against.
         */
        tr.setAttribute('aria-current', 'true');
        tr.className = 'sens__row--current';
        var tag = document.createElement('span');
        tag.className = 'sens__tag';
        tag.appendChild(document.createTextNode('yours'));
        th.appendChild(document.createTextNode(' '));
        th.appendChild(tag);
      }
      tr.appendChild(th);
      tr.appendChild(cell('td', moneyCents(r.paymentCents)));
      tr.appendChild(cell('td', moneySigned(r.paymentDeltaCents)));
      tr.appendChild(cell('td', moneyCents(r.totalInterestCents)));
      tr.appendChild(cell('td', moneySigned(r.interestDeltaCents)));
      frag.appendChild(tr);
    }
    return frag;
  }

  function renderSensitivity(m) {
    if (!ui.sensRateBody && !ui.sensTermBody) return;
    var s = sensitivity(m);
    if (ui.sensRateBody) {
      replace(ui.sensRateBody, sensRows(s.rates, 'rate'));
      text(ui.sensRateCaption, rateCaptionText(m, s.rates));
    }
    if (ui.sensTermBody) {
      replace(ui.sensTermBody, sensRows(s.terms, 'term'));
      text(ui.sensTermCaption, termCaptionText(m, s.terms));
    }
  }

  function scenarioLead(m) {
    return 'A ' + moneyNatural(m.principal) + ' loan at ' + pctTrim(m.rate) + ' over ' +
      m.durationText + ', paid ' + m.freq.adverb;
  }

  /* ---------------- charts ---------------- */

  function setPath(node, d) { if (node) node.setAttribute('d', d); }

  function renderCharts(m) {
    var balances = [m.principal];
    var interest = [];
    var totals = [];
    var k, y;
    for (k = 0; k < m.yearly.length; k++) {
      y = m.yearly[k];
      balances.push(fromCents(y.endingBalanceCents));
      interest.push(fromCents(y.interestCents));
      totals.push(fromCents(y.interestCents + y.principalCents));
    }

    var balanceMax = m.principal;
    setPath(ui.balanceArea, seriesArea(balances, balanceMax));
    setPath(ui.balanceLine, seriesLine(balances, balanceMax));
    text(ui.balanceMax, moneyWhole(balanceMax));
    text(ui.balanceEnd, 'Year ' + integer(m.yearly.length));
    text(ui.balanceDesc, chartDescription(m));

    var compMax = 0;
    for (k = 0; k < totals.length; k++) if (totals[k] > compMax) compMax = totals[k];
    var zeros = [];
    for (k = 0; k < interest.length; k++) zeros.push(0);
    var interestBand = seriesBand(zeros, interest, compMax);
    setPath(ui.compInterest, interestBand);
    /* The hatch overlay is the same geometry drawn twice: once tinted, once with
       the pattern fill, so the band survives greyscale and forced-colors mode. */
    setPath(ui.compInterestHatch, interestBand);
    setPath(ui.compPrincipal, seriesBand(interest, totals, compMax));
    text(ui.compMax, moneyWhole(compMax) + ' a year');
    text(ui.compEnd, 'Year ' + integer(m.yearly.length));

    if (ui.compDesc && m.yearly.length) {
      var first = m.yearly[0];
      var last = m.yearly[m.yearly.length - 1];
      text(ui.compDesc, 'In year ' + first.year + ', ' + moneyCents(first.interestCents) +
        ' of the year’s payments is interest and ' + moneyCents(first.principalCents) +
        ' is principal. In year ' + last.year + ', ' + moneyCents(last.interestCents) +
        ' is interest and ' + moneyCents(last.principalCents) +
        ' is principal. The total stays the same; only the split moves.');
    }
  }

  /* ---------------- the live region ---------------- */

  /*
   * The computation is never debounced: it is arithmetic, and a sighted reader
   * should see the number move as they type. The announcement is, on a 500ms
   * trailing delay, because a live region that fires on every keystroke is a
   * live region nobody can use.
   */
  var announceTimer = null;
  function announceText(body) {
    if (!ui.status) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      ui.status.textContent = body;
    }, 500);
  }

  /* ---------------- the update cycle ---------------- */

  function update() {
    var read = readInputs();
    paintMessages(read.errors, read.warnings);

    var failures = [];
    for (var key in read.errors) {
      if (Object.prototype.hasOwnProperty.call(read.errors, key)) failures.push(key);
    }

    if (failures.length) {
      /*
       * Freeze rather than blank. The previous figures stay on screen, dimmed,
       * under a sentence saying they are waiting, because $NaN is useless and a
       * stale number that still looks current is worse than either.
       */
      if (ui.resultPanel) ui.resultPanel.classList.add('result--stale');
      if (ui.staleNote) {
        ui.staleNote.hidden = false;
        text(ui.staleNote, 'Waiting for a valid entry. The figures shown are from your last complete entry.');
      }
      announceText('Waiting for a valid entry. The figures shown are from your last complete entry.');
      return;
    }

    if (ui.resultPanel) ui.resultPanel.classList.remove('result--stale');
    if (ui.staleNote) ui.staleNote.hidden = true;

    var m = buildModel(read.values);
    state.lastModel = m;

    renderParams(m);
    renderResults(m);
    renderExplanation(m);
    renderSubstitution(m);
    renderYearly(m);
    renderFrequency(m);
    renderCharts(m);
    renderSensitivity(m);

    /* Up to 3,000 elements. Built when the disclosure is open, deferred when it
       is not. */
    if (ui.paymentsDetails && ui.paymentsDetails.open) renderPayments(m);
    else state.paymentsDirty = true;

    announceText(summarySentence(m));
  }

  /* ---------------- wiring ---------------- */

  /*
   * One listener on the form rather than one per control. `input` fires for text
   * fields and selects alike; `change` is here for the two selects, whose own
   * handlers must not run twice.
   */
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  /*
   * The form cannot submit today: it lacks an action and a submit button, and
   * the spec suppresses implicit submission for a form with several text fields
   * and no submit button. That is a guarantee resting on an absence. Adding one
   * button would turn Enter into a GET of this same page with every field in the
   * query string, and page_location is the one thing analytics records verbatim.
   * Two lines, and the numbers stay in the tab.
   */
  function blockSubmit(event) { event.preventDefault(); }
  form.addEventListener('submit', blockSubmit);

  function onInput(event) {
    /*
     * Gated to `change`, and that gate is load-bearing. A select fires `input`
     * AND `change` for one interaction, and this handler moves focus and shows a
     * field; running it on both events would fight the reader for the caret.
     */
    if (event.type === 'change' && event.target === ui.term) paintTermOther();
    update();
  }

  function paintTermOther() {
    if (!ui.termOtherWrap || !ui.term) return;
    var other = ui.term.value === 'other';
    ui.termOtherWrap.hidden = !other;
    /* Moving focus is right here: the reader picked "Other" in order to type a
       number, and the field they need did not exist a moment ago. */
    if (other && ui.termOther) ui.termOther.focus();
  }

  if (ui.reset) {
    ui.reset.addEventListener('click', function () {
      if (ui.principal) ui.principal.value = '25000';
      if (ui.rate) ui.rate.value = '7';
      if (ui.term) ui.term.value = '5';
      if (ui.termOther) ui.termOther.value = '5';
      if (ui.frequency) ui.frequency.value = '12';
      if (ui.extra) ui.extra.value = '';
      paintTermOther();
      update();
      if (ui.principal) ui.principal.focus();
    });
  }

  if (ui.paymentsDetails) {
    ui.paymentsDetails.addEventListener('toggle', function () {
      if (ui.paymentsDetails.open && state.paymentsDirty && state.lastModel) {
        renderPayments(state.lastModel);
      }
    });
  }

  /*
   * The page already carries the default scenario's real figures as static text,
   * so this first pass changes nothing visible. It runs anyway, because the
   * reader may have arrived with values restored by the browser's own form
   * restoration after a reload, and those have to be honoured.
   */
  paintTermOther();
  update();

})();
