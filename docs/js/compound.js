/*
 * Compound interest calculator: the arithmetic, the formatting, and the wiring,
 * in that order. Written to the same rules as /js/main.js and /js/mortgage.js --
 * ES5, `var`, one IIFE, no module, loaded with `defer` -- because there is no
 * build step and there is not going to be one.
 *
 * The single structural idea in this file: the formula owns one number, the
 * balance a lump sum grows to. Money added later, tax, fees, and inflation are
 * real, and none of them is in the equation. Inflation is offered anyway,
 * because dividing the answer by (1+i)^t leaves the equation untouched; recurring
 * contributions are not, because there is no way to include them and leave the
 * equation on the page true.
 */
(function () {
  'use strict';

  /* ================================================================
   * Pure arithmetic. No DOM, no formatting, no globals.
   * The Node test runner loads exactly these; see the export tail.
   * ================================================================ */

  /*
   * Below this a rate is treated as exactly zero. The threshold is far tighter
   * than the mortgage calculator's, because nothing here divides by the rate in
   * a way that loses significance -- the only reason it exists is that a doubling
   * time at r = 0 is a division by zero, and an effective annual rate at r = 0
   * is exactly 0 rather than something that rounds to it.
   */
  var NEAR_ZERO_RATE = 1e-12;

  /*
   * The bounds the form accepts. The rate floor is not a round number chosen for
   * looks: it keeps 1 + r/n at or above 0.8 for every n the page offers, so the
   * base of the exponent can never approach zero and a fractional exponent can
   * never produce NaN. Negative policy rates were real from 2014 to 2022 and the
   * arithmetic describes them correctly, so refusing them outright would be the
   * calculator declining to describe an instrument that exists.
   */
  var HARD_MAX_MONEY = 100000000;   /* $100M. Past this the figures are theatre. */
  var HARD_MAX_RATE = 25;           /* Percent. */
  var HARD_MIN_RATE = -20;          /* Percent. */
  var WARN_RATE = 15;               /* Percent. Computed, but flagged. */
  var HARD_MAX_YEARS = 100;
  var WARN_YEARS = 50;

  /* The first periods shown one at a time, to make "interest on interest"
     concrete without printing 3,650 rows for a daily schedule. */
  var PERIOD_ROWS = 10;

  /*
   * Frequencies as data rather than as six branches, so that adding one cannot
   * forget any of the places it has to appear: the select, the parameter table,
   * the comparison table, and every generated sentence. `n` of null is the
   * continuous case, which is a different formula rather than a large number.
   */
  var FREQUENCIES = [
    { key: '1',   n: 1,   label: 'Annually',     adverb: 'annually',     adjective: 'annual',     period: 'year' },
    { key: '2',   n: 2,   label: 'Semiannually', adverb: 'semiannually', adjective: 'semiannual', period: 'half-year' },
    { key: '4',   n: 4,   label: 'Quarterly',    adverb: 'quarterly',    adjective: 'quarterly',  period: 'quarter' },
    { key: '12',  n: 12,  label: 'Monthly',      adverb: 'monthly',      adjective: 'monthly',    period: 'month' },
    { key: '365', n: 365, label: 'Daily',        adverb: 'daily',        adjective: 'daily',      period: 'day' },
    { key: 'continuous', n: null, label: 'Continuously', adverb: 'continuously', adjective: 'continuous', period: null }
  ];

  function frequency(key) {
    for (var k = 0; k < FREQUENCIES.length; k++) {
      if (FREQUENCIES[k].key === String(key)) return FREQUENCIES[k];
    }
    return null;
  }

  /*
   * The whole page, in one function.
   *
   *   A = P(1 + r/n)^(nt)     discrete
   *   A = P e^(rt)            continuous
   *
   * `rate` is a decimal, never a percentage: the conversion happens once, at the
   * edge, and nothing below this line divides by 100 again. `n` of null selects
   * the continuous form, which is the limit of the discrete one rather than a
   * special case of it.
   *
   * Returns an unrounded number in dollars. Money is NOT carried as integer cents
   * here, which is a deliberate departure from mortgage.js: there is no iterative
   * accumulation to protect, and at the bounds above the answer reaches about
   * 7.2e18, which in cents is past Number.MAX_SAFE_INTEGER and would silently
   * become the wrong integer.
   */
  function futureValue(principal, rate, n, years) {
    if (!(principal > 0) || !(years >= 0)) return NaN;
    if (Math.abs(rate) < NEAR_ZERO_RATE || years === 0) return principal;
    if (n === null) return principal * Math.exp(rate * years);
    var base = 1 + rate / n;
    /* Guaranteed by the -20% floor. Asserted anyway, so that widening the bound
       later fails loudly here rather than quietly returning NaN on the page. */
    if (!(base > 0)) return NaN;
    return principal * Math.pow(base, n * years);
  }

  /* What one year of the quoted rate actually comes to once compounding is
     accounted for. The whole of the APR-against-APY question is this line. */
  function effectiveAnnualRate(rate, n) {
    if (Math.abs(rate) < NEAR_ZERO_RATE) return 0;
    if (n === null) return Math.exp(rate) - 1;
    var base = 1 + rate / n;
    if (!(base > 0)) return NaN;
    return Math.pow(base, n) - 1;
  }

  /* Null when there is no doubling to speak of: a zero rate never doubles, and a
     negative one moves the wrong way. Returning Infinity would be arithmetically
     defensible and would print as a number, which is worse. */
  function doublingYears(rate, n) {
    if (rate <= NEAR_ZERO_RATE) return null;
    if (n === null) return Math.LN2 / rate;
    var base = 1 + rate / n;
    if (!(base > 1)) return null;
    return Math.LN2 / (n * Math.log(base));
  }

  /* The straight line the compound curve pulls away from. Only ever drawn and
     quoted as a comparison; nothing on the page is computed from it. */
  function simpleValue(principal, rate, years) {
    if (!(principal > 0) || !(years >= 0)) return NaN;
    return principal * (1 + rate * years);
  }

  /*
   * What the balance would buy in today's money. A division applied to the
   * answer, not a change to the formula that produced it -- which is the entire
   * reason inflation is offered here and recurring contributions are not.
   *
   * The exact relation, not the subtract-inflation approximation: at 5% against
   * 3% the two differ by 1.94% against 2.00%, and a page explaining compounding
   * should not use the sloppier of two formulas it is in the middle of teaching.
   */
  function realValue(amount, inflation, years) {
    if (!isFinite(amount) || !(years >= 0)) return NaN;
    var base = 1 + inflation;
    if (!(base > 0)) return NaN;
    return amount / Math.pow(base, years);
  }

  /*
   * One row per year, each computed from the closed form at that year rather than
   * accumulated from the row above it. The columns therefore reconcile with the
   * headline by construction, not by luck -- the opposite decision from
   * mortgage.js, where the rows have to come from the rounded recurrence because
   * a servicer rounds every month and the table has to add up the way a statement
   * would.
   *
   * A final part-year keeps its own row, marked, rather than being rounded away.
   */
  function yearlyRows(principal, rate, n, years) {
    var rows = [];
    var count = Math.min(Math.ceil(years - 1e-9), HARD_MAX_YEARS);
    var previous = principal;
    var k, at, balance;
    for (k = 1; k <= count; k++) {
      at = Math.min(k, years);
      balance = futureValue(principal, rate, n, at);
      if (!isFinite(balance)) return rows;
      rows.push({
        year: k,
        at: at,
        partial: at < k - 1e-9,
        interest: balance - previous,
        cumulative: balance - principal,
        balance: balance
      });
      previous = balance;
    }
    return rows;
  }

  /*
   * The first few compounding periods, one at a time. This is the only place on
   * the page where the recurrence is shown rather than the closed form, and it is
   * here because "interest on interest" is a claim about what happens between two
   * rows, which a closed form cannot show.
   *
   * Empty under continuous compounding, where there are no periods to list.
   */
  function periodRows(principal, rate, n, years, limit) {
    if (n === null) return [];
    var total = n * years;
    var count = Math.min(limit, Math.floor(total + 1e-9));
    var periodRate = Math.abs(rate) < NEAR_ZERO_RATE ? 0 : rate / n;
    var rows = [];
    var balance = principal;
    var earned;
    for (var k = 1; k <= count; k++) {
      earned = balance * periodRate;
      rows.push({ n: k, opening: balance, interest: earned, closing: balance + earned });
      balance += earned;
    }
    return rows;
  }

  /* ================================================================
   * Parsing. One function, used by every field. Lifted from mortgage.js
   * unchanged, including the reason it exists.
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
      .replace(/[$,\s ]/g, '')
      .replace(/%$/, '')
      .replace(/^\+/, '');
    if (cleaned === '') return null;
    var value = Number(cleaned);
    if (!isFinite(value)) return null;
    return value;
  }

  /* ================================================================
   * Formatting. Intl.NumberFormat instances are built once, for the same
   * reason they are in mortgage.js: constructing one per cell would be the
   * largest single cost of a hundred-row render.
   * ================================================================ */

  var FMT_MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var FMT_MONEY_WHOLE = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
  var FMT_PCT_TRIM = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 3 });
  var FMT_PCT_2 = new Intl.NumberFormat('en-US', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  /*
   * The periodic rate, and the one formatter this page needed that the mortgage
   * calculator did not. Fixed decimals cannot serve both 0.4167% a month and
   * 0.0137% a day: three decimal places renders the second as 0.014%, which
   * throws away the digits that make it a rate.
   */
  var FMT_PCT_SIG = new Intl.NumberFormat('en-US', {
    style: 'percent', maximumSignificantDigits: 4
  });
  var FMT_NUM_2 = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var FMT_NUM_TRIM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  var FMT_INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  /*
   * Above this, cents stop being a fact about the money and start being a fact
   * about the format. A double carries about fifteen significant digits, so a
   * balance in the trillions has no cents left to distinguish -- printing ".00"
   * there would claim a precision the number does not have, and claiming it is
   * worse than declining to. Every figure the calculator can reach from the
   * inputs the form accepts is exact in cents below this line, and no input the
   * form accepts is anywhere near it; only a computed balance can cross it.
   */
  var CENT_LIMIT = 1e12;

  function money(n) {
    return Math.abs(n) < CENT_LIMIT ? FMT_MONEY.format(n) : FMT_MONEY_WHOLE.format(n);
  }
  function moneyWhole(n) { return FMT_MONEY_WHOLE.format(n); }
  /* ".00" on a round $1,000 is clutter in a sentence, and dropping it from
     $1,647.01 would be a lie. */
  function moneyNatural(n) {
    if (Math.abs(n) >= CENT_LIMIT) return moneyWhole(n);
    return Math.round(n * 100) % 100 === 0 ? moneyWhole(n) : money(n);
  }
  /* 5% reads as "5%" and 6.125% reads as "6.125%": the trailing zeros are noise
     on a round rate and the digits are load-bearing on a quoted one. */
  function pctTrim(n) { return FMT_PCT_TRIM.format(n); }
  function pct2(n) { return FMT_PCT_2.format(n); }
  function pctSig(n) { return FMT_PCT_SIG.format(n); }
  /* "1.65x", with a multiplication sign rather than the letter. The tile wants
     the sign; a sentence wants the bare number followed by the word "times". */
  function multiple(n) { return FMT_NUM_2.format(n) + '×'; }
  function times(n) { return FMT_NUM_2.format(n); }
  /* 10 reads as "10", 10.5 as "10.5", 13.8918 as "13.89". */
  function numTrim(n) { return FMT_NUM_TRIM.format(n); }
  function integer(n) { return FMT_INT.format(n); }

  /*
   * A difference between two figures the page has already printed, taken from the
   * printed values rather than from the ones behind them. The gap between
   * annual and monthly compounding here is $18.1149: rounded once it is $18.11,
   * but the two balances in the table read $1,647.01 and $1,628.89, and a reader
   * who subtracts them gets $18.12. A delta column that cannot be checked against
   * the rows beside it is worse than one that is a hundredth of a cent coarse.
   */
  function centDelta(a, b) {
    /* Past the cent limit there are no printed cents to agree with, and rounding
       to them would overflow the exact integer range and invent a difference. */
    if (Math.abs(a) >= CENT_LIMIT || Math.abs(b) >= CENT_LIMIT) return a - b;
    return (Math.round(a * 100) - Math.round(b * 100)) / 100;
  }

  /*
   * "+$104.06", "-$104.06", "$0.00". Used only in the sensitivity columns, where
   * the sign is the entire content of the cell. A true minus sign rather than a
   * hyphen, because that column is read rather than parsed.
   */
  function moneySigned(n) {
    if (Math.abs(Math.round(n * 100)) === 0) return money(0);
    return (n > 0 ? '+' : '−') + money(Math.abs(n));
  }

  /* "annually", "annually and monthly", "annually, monthly, and daily". */
  function joinList(items) {
    if (!items || !items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : (pluralForm || singular + 's');
  }

  /* "10 years", "1 year", "10.5 years", "18 months" when that is what was typed. */
  function durationText(years, unit) {
    if (unit === 'months') {
      var months = years * 12;
      var whole = Math.round(months);
      if (Math.abs(months - whole) < 1e-9) return integer(whole) + ' ' + plural(whole, 'month');
    }
    return numTrim(years) + ' ' + plural(years === 1 ? 1 : 2, 'year');
  }

  /* ================================================================
   * Chart geometry. Pure string building, so the same functions that draw
   * the live SVG also generated the static `d` attributes sitting in the
   * page's markup -- the no-JavaScript chart is not a hand-drawn imitation
   * of the real one, it IS the real one, rendered ahead of time.
   * ================================================================ */

  var CHART_W = 640;
  var CHART_H = 240;

  function plotX(index, count) {
    return count < 2 ? 0 : (index / (count - 1)) * CHART_W;
  }
  function plotY(value, max) {
    if (!(max > 0)) return CHART_H;
    /* Clamped at the floor. A simple-interest line at a steeply negative rate
       goes below zero, which is arithmetically true and meaningless as a
       balance; the chart stops it at the axis and the description says so. */
    var v = value < 0 ? 0 : value;
    return CHART_H - (v / max) * CHART_H;
  }
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

  function buildModel(v) {
    var freq = frequency(v.frequencyKey);
    if (!freq) return null;

    /* The one place a percentage becomes a decimal. Nothing below divides by
       100 again, and the parameter table prints both forms so the conversion is
       visible rather than assumed. */
    var rate = v.ratePct / 100;
    var n = freq.n;
    var years = v.years;
    var principal = v.principal;

    var amount = futureValue(principal, rate, n, years);
    if (!isFinite(amount)) return null;

    var interest = amount - principal;
    var ear = effectiveAnnualRate(rate, n);
    var periods = n === null ? null : n * years;
    var zero = Math.abs(rate) < NEAR_ZERO_RATE || years === 0;

    var inflation = v.inflationPct == null ? null : v.inflationPct / 100;
    var real = inflation == null ? null : realValue(amount, inflation, years);
    if (real != null && !isFinite(real)) real = null;

    return {
      principal: principal,
      ratePct: v.ratePct,
      rate: rate,
      freq: freq,
      n: n,
      years: years,
      unit: v.unit,
      durationText: durationText(years, v.unit),
      periodicRate: n === null || zero ? (zero ? 0 : null) : rate / n,
      periods: periods,
      /* True when the horizon does not land on a whole number of compounding
         periods. The formula prorates the last one; a real account may not, and
         the page says so at the field rather than only in the assumptions. */
      partialPeriod: periods != null && Math.abs(periods - Math.round(periods)) > 1e-9,
      amount: amount,
      interest: interest,
      ear: ear,
      growth: principal > 0 ? amount / principal : null,
      doubling: doublingYears(rate, n),
      simple: simpleValue(principal, rate, years),
      zero: zero,
      negative: rate < -NEAR_ZERO_RATE,
      inflationPct: v.inflationPct,
      inflation: inflation,
      real: real,
      yearly: yearlyRows(principal, rate, n, years),
      periodRows: periodRows(principal, rate, n, years, PERIOD_ROWS)
    };
  }

  /* ================================================================
   * Scenarios. The same arithmetic run again against inputs the reader did
   * not enter, so that "what if the rate were a point higher" is answered by
   * the formula rather than by a rule of thumb.
   * ================================================================ */

  var RATE_STEPS = [-1, -0.5, 0, 0.5, 1];
  var TIME_STEPS = [5, 10, 20, 30];

  function scenario(principal, ratePct, n, years) {
    var rate = ratePct / 100;
    var amount = futureValue(principal, rate, n, years);
    return {
      ratePct: ratePct,
      n: n,
      years: years,
      amount: amount,
      interest: amount - principal,
      ear: effectiveAnnualRate(rate, n)
    };
  }

  function withDeltas(s, m, isCurrent) {
    s.current = !!isCurrent;
    s.amountDelta = centDelta(s.amount, m.amount);
    s.interestDelta = centDelta(s.interest, m.interest);
    return s;
  }

  /* Rates carry three decimals at most, and 6.1 - 0.5 is 5.6000000000000005 in
     binary. Rounding here is what lets the reader's own row be found by equality
     rather than by tolerance. */
  function stepRate(ratePct, step) {
    return Math.round((ratePct + step) * 1000) / 1000;
  }

  function sensitivity(m) {
    var rates = [];
    var times = [];
    var seen = {};
    var list = TIME_STEPS.slice();
    var k, r, y;

    for (k = 0; k < RATE_STEPS.length; k++) {
      r = stepRate(m.ratePct, RATE_STEPS[k]);
      /*
       * Anything the form itself would reject is left out rather than clamped. A
       * scenario the calculator refuses to compute is not a scenario worth
       * offering, and a clamped row would be a different balance wearing the
       * label of the one asked for.
       */
      if (r < HARD_MIN_RATE || r > HARD_MAX_RATE || seen['r' + r]) continue;
      seen['r' + r] = true;
      rates.push(withDeltas(scenario(m.principal, r, m.n, m.years), m, RATE_STEPS[k] === 0));
    }

    if (list.indexOf(m.years) === -1) list.push(m.years);
    list.sort(function (a, b) { return a - b; });
    for (k = 0; k < list.length; k++) {
      y = list[k];
      if (y <= 0 || y > HARD_MAX_YEARS) continue;
      times.push(withDeltas(scenario(m.principal, m.ratePct, m.n, y), m, y === m.years));
    }

    return { rates: rates, times: times };
  }

  /*
   * Every frequency the page offers, priced against the reader's own figures.
   * This is the table that replaces a chart: six curves spanning about one per
   * cent would render as a single line, and a picture that cannot show its own
   * data is worse than the numbers it was drawn from.
   */
  function frequencyTable(m) {
    var rows = [];
    var annual = futureValue(m.principal, m.rate, 1, m.years);
    for (var k = 0; k < FREQUENCIES.length; k++) {
      var f = FREQUENCIES[k];
      var amount = futureValue(m.principal, m.rate, f.n, m.years);
      rows.push({
        freq: f,
        periodicRate: f.n === null ? null : m.rate / f.n,
        amount: amount,
        ear: effectiveAnnualRate(m.rate, f.n),
        vsAnnual: centDelta(amount, annual),
        current: f.key === m.freq.key
      });
    }
    return rows;
  }

  /* ================================================================
   * The explanation. A sentence planner rather than string concatenation:
   * each sentence is only built if its condition holds, the paragraph is
   * dropped when nothing survives, and the one place that joins a series is
   * joinList -- which is the difference between prose and fragments.
   * ================================================================ */

  function explainParagraphs(m) {
    var out = [];
    var s;

    /* --- the setup --- */
    s = ['You entered ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) +
         ' a year, compounded ' + m.freq.adverb + ', left for ' + m.durationText + '.'];
    out.push(s.join(' '));

    /* --- the mechanics --- */
    s = [];
    if (m.zero) {
      if (m.years === 0) {
        s.push('At zero years no compounding period has passed, so there is nothing for the formula to do: the balance is the amount you started with.');
      } else {
        s.push('At a zero rate there is nothing to compound. The balance stays at the amount you started with, whatever the frequency and however long you leave it.');
      }
    } else if (m.n === null) {
      s.push('Continuous compounding is the limit of that process as the periods get shorter and more numerous, so there is no periodic rate to quote.');
      s.push('Instead the balance is multiplied by e raised to the rate times the time, which for ' + pctTrim(m.rate) + ' over ' + m.durationText + ' is a factor of ' + FMT_NUM_2.format(Math.exp(m.rate * m.years)) + '.');
    } else if (m.n === 1) {
      s.push('With annual compounding there is nothing to divide: the periodic rate is the annual rate itself, ' +
             pctTrim(m.rate) + ', and ' + m.durationText + ' gives ' + numTrim(m.periods) + ' ' +
             plural(m.periods, 'period') + '.');
    } else {
      s.push('Dividing the annual rate by ' + integer(m.n) + ' gives a periodic rate of ' +
             pctSig(m.periodicRate) + ' a ' + m.freq.period + ', and ' + m.durationText +
             ' of ' + m.freq.adjective + ' compounding gives ' + numTrim(m.periods) + ' ' +
             plural(m.periods, 'period') + '.');
    }
    /* Outside the branches above, because it is true of every discrete frequency
       and was silently lost when the annual case got a sentence of its own. */
    if (!m.zero && m.partialPeriod) {
      s.push('That is not a whole number of periods. The formula prorates the last, partial one; an account that credits only completed periods would pay slightly less.');
    }
    out.push(s.join(' '));

    /* --- the reasoning: what the rate actually means under this model --- */
    s = [];
    if (!m.zero) {
      if (m.n === 1) {
        s.push('With annual compounding the quoted rate and the yearly growth are the same figure: interest is added once, so a year of it is exactly ' + pctTrim(m.rate) + '.');
      } else if (m.n === null) {
        s.push('A ' + pctTrim(m.rate) + ' rate compounded continuously does not change the balance by ' + pctTrim(m.rate) + ' over a year.');
        s.push('Growth is applied at every instant and immediately becomes part of the balance the next instant is applied to, so a year of it comes to ' + pctTrim(m.ear) + '.');
      } else {
        s.push('A ' + pctTrim(m.rate) + ' annual rate does not mean ' + pctTrim(m.rate) + ' is added once a year here.');
        s.push('Under ' + m.freq.adverb + ' compounding, ' + pctSig(m.periodicRate) + ' of the current balance is applied ' + integer(m.n) + ' times, and because each application becomes part of the balance the next one is calculated on, a year of it comes to ' + pctTrim(m.ear) + ' rather than ' + pctTrim(m.rate) + '.');
      }
      s.push('That is what the formula does. Whether a particular account behaves this way is a question about its terms, not about the arithmetic.');
    }
    out.push(s.join(' '));

    /* --- the result, in words --- */
    s = [];
    if (m.zero) {
      s.push('The balance is ' + moneyNatural(m.amount) + ', the same as the amount you started with. No interest has been earned.');
    } else if (m.negative) {
      s.push('After ' + m.durationText + ' the balance is ' + money(m.amount) + ', a decline of ' +
             money(-m.interest) + '.');
      s.push('That is ' + times(m.growth) + ' times what you started with: at a negative rate the same compounding works in the other direction.');
    } else {
      s.push('After ' + m.durationText + ' the balance is ' + money(m.amount) + ', of which ' +
             money(m.interest) + ' is interest.');
      s.push('That is ' + times(m.growth) + ' times what you started with.');
      if (isFinite(m.simple) && m.simple > 0) {
        s.push('Simple interest on the same amount at the same rate would have reached ' +
               moneyNatural(m.simple) + '; the difference, ' + money(m.amount - m.simple) +
               ', is the interest that earned interest of its own.');
      }
    }
    out.push(s.join(' '));

    /* --- purchasing power, only when a rate was entered --- */
    s = [];
    if (m.real != null && m.years > 0) {
      s.push('At ' + pctTrim(m.inflation) + ' inflation, ' + money(m.amount) + ' in ' +
             m.durationText + ' would buy what ' + money(m.real) + ' buys today.');
      if (m.real < m.principal) {
        s.push('That is less than you started with in purchasing-power terms: the rate does not outrun the inflation you assumed.');
      } else if (m.real > m.principal) {
        s.push('The growth is real only to the extent it outruns that, which here it does.');
      }
      s.push('This figure is a division applied to the answer, not part of the formula above, and it assumes one constant inflation rate.');
    }
    out.push(s.join(' '));

    return out;
  }

  /* One line, for the live region. Not the whole explanation: a screen-reader
     user changing a field needs the number, not the essay. */
  function summarySentence(m) {
    var line = 'Balance after ' + m.durationText + ': ' + money(m.amount) + '.';
    line += m.negative
      ? ' Decline: ' + money(-m.interest) + '.'
      : ' Interest earned: ' + money(m.interest) + '.';
    if (m.real != null) line += ' In today’s money: ' + money(m.real) + '.';
    return line;
  }

  /*
   * The captions carry the finding. A table of six balances is data; the sentence
   * under it is the reason the table is on the page.
   */
  function frequencyCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) + ' over ' +
      m.durationText + ', compounded at every frequency this page offers. Your own row is marked.';
    if (m.zero) return lead + ' At a zero rate the frequency changes nothing: there is no interest for more frequent compounding to compound.';
    var annual = rows[0];
    var last = rows[rows.length - 1];
    var monthly = null;
    for (var k = 0; k < rows.length; k++) if (rows[k].freq.key === '12') monthly = rows[k];
    if (!monthly || !isFinite(annual.amount) || !isFinite(last.amount)) return lead;
    return lead + ' The whole range, from annually to continuously, is worth ' +
      money(Math.abs(centDelta(last.amount, annual.amount))) + ' here, and ' +
      money(Math.abs(centDelta(monthly.amount, annual.amount))) +
      ' of that is spent getting from annually to monthly. The difference is too small to see on a chart at this scale, which is the finding rather than a limitation of the picture.';
  }

  function rateCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' over ' + m.durationText +
      ', compounded ' + m.freq.adverb + ', at other rates. Your own row is marked.';
    var up = findRate(rows, stepRate(m.ratePct, 1));
    var down = findRate(rows, stepRate(m.ratePct, -1));
    if (up) {
      return lead + ' One percentage point more would add ' + money(up.amountDelta) +
        ' to the balance.';
    }
    if (down) {
      return lead + ' One percentage point less would take ' + money(-down.amountDelta) +
        ' off the balance.';
    }
    return lead;
  }

  function findRate(rows, ratePct) {
    for (var k = 0; k < rows.length; k++) if (rows[k].ratePct === ratePct) return rows[k];
    return null;
  }

  function timeCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) +
      ', compounded ' + m.freq.adverb + ', over other lengths of time. Your own row is marked.';
    if (m.zero) return lead + ' At a zero rate time changes nothing either.';
    var longer = null;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].years > m.years && !longer) longer = rows[k];
    }
    if (longer) {
      return lead + ' Leaving it for ' + numTrim(longer.years) + ' years rather than ' +
        numTrim(m.years) + ' would ' + (m.negative ? 'take a further ' : 'add a further ') +
        money(Math.abs(longer.amountDelta)) + (m.negative ? ' off the balance.' : ' to the balance.');
    }
    return lead;
  }

  /*
   * The chart's real alternative text. `role="img"` plus a label says what the
   * picture is; this says what it shows, which is the part a sighted reader
   * actually gets from the shape of the curve.
   */
  function balanceDescription(m) {
    if (!m.yearly.length) return 'No time has passed, so there is nothing to plot.';
    var parts = [];
    var step = Math.max(1, Math.round(m.yearly.length / 6));
    for (var k = step - 1; k < m.yearly.length; k += step) {
      parts.push('year ' + m.yearly[k].year + ', ' + moneyWhole(m.yearly[k].balance));
    }
    var lead = 'Balance at the end of ' + joinList(parts) + '.';
    if (m.zero) return lead + ' The line is flat: at this rate nothing compounds.';
    if (m.negative) return lead + ' The band below the principal line is the decline, and it widens slowly at first and faster later.';
    return lead + ' The lower band is the ' + moneyWhole(m.principal) +
      ' you started with and never changes; everything above it is interest, and that band widens as the interest earns interest of its own.';
  }

  function comparisonDescription(m) {
    if (m.zero) return 'At this rate both lines are flat and lie on top of each other: with no interest there is nothing for compounding to add.';
    var simple = m.simple;
    var gap = m.amount - simple;
    return 'Simple interest reaches ' + moneyWhole(simple) + ' after ' + m.durationText +
      ' and compound interest reaches ' + moneyWhole(m.amount) + '. Simple interest is a straight line because it is always calculated on the ' +
      moneyWhole(m.principal) + ' you started with; the compound line curves away from it, and the gap between them, ' +
      moneyWhole(Math.abs(gap)) + ', is the interest that earned interest.';
  }

  /*
   * Node's test runner loads this file to exercise the functions above. In a
   * browser `module` is undefined, the block is skipped, and the file stays a
   * plain script -- no bundler, no build step, no type="module". The alternative,
   * a second copy of the maths inside the test, would test code that is not the
   * code that ships.
   */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      NEAR_ZERO_RATE: NEAR_ZERO_RATE,
      HARD_MAX_MONEY: HARD_MAX_MONEY,
      HARD_MAX_RATE: HARD_MAX_RATE,
      HARD_MIN_RATE: HARD_MIN_RATE,
      WARN_RATE: WARN_RATE,
      HARD_MAX_YEARS: HARD_MAX_YEARS,
      WARN_YEARS: WARN_YEARS,
      PERIOD_ROWS: PERIOD_ROWS,
      FREQUENCIES: FREQUENCIES,
      frequency: frequency,
      futureValue: futureValue,
      effectiveAnnualRate: effectiveAnnualRate,
      doublingYears: doublingYears,
      simpleValue: simpleValue,
      realValue: realValue,
      yearlyRows: yearlyRows,
      periodRows: periodRows,
      parseNumber: parseNumber,
      money: money,
      moneyWhole: moneyWhole,
      moneyNatural: moneyNatural,
      moneySigned: moneySigned,
      CENT_LIMIT: CENT_LIMIT,
      centDelta: centDelta,
      pctTrim: pctTrim,
      pct2: pct2,
      pctSig: pctSig,
      multiple: multiple,
      times: times,
      numTrim: numTrim,
      integer: integer,
      joinList: joinList,
      plural: plural,
      durationText: durationText,
      CHART_W: CHART_W,
      CHART_H: CHART_H,
      seriesLine: seriesLine,
      seriesArea: seriesArea,
      seriesBand: seriesBand,
      buildModel: buildModel,
      explainParagraphs: explainParagraphs,
      summarySentence: summarySentence,
      RATE_STEPS: RATE_STEPS,
      TIME_STEPS: TIME_STEPS,
      scenario: scenario,
      sensitivity: sensitivity,
      frequencyTable: frequencyTable,
      frequencyCaptionText: frequencyCaptionText,
      rateCaptionText: rateCaptionText,
      timeCaptionText: timeCaptionText,
      balanceDescription: balanceDescription,
      comparisonDescription: comparisonDescription
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
   * and `document` does not exist there.
   */
  if (typeof document === 'undefined') return;

  function $(id) { return document.getElementById(id); }

  var form = $('calc-form');
  if (!form) return;

  var ui = {
    principal: $('principal'),
    rate: $('rate'),
    frequency: $('compounding'),
    time: $('time'),
    timeUnitYears: $('time-unit-years'),
    timeUnitMonths: $('time-unit-months'),
    timeReadout: $('time-readout'),
    inflation: $('inflation'),

    status: $('calc-status'),
    resultPanel: $('result-panel'),
    resultLabel: $('result-label'),
    resultAmount: $('result-amount'),
    staleNote: $('result-stale-note'),
    interest: $('result-interest'),
    interestLabel: $('result-interest-label'),
    principalOut: $('result-principal'),
    ear: $('result-ear'),
    multiple: $('result-multiple'),
    real: $('result-real'),
    realAmount: $('result-real-amount'),
    realNote: $('result-real-note'),

    formulaDiscrete: $('formula-discrete'),
    formulaContinuous: $('formula-continuous'),
    substitution: $('substitution-math'),

    pPrincipal: $('p-principal'),
    pRate: $('p-rate'),
    pFreq: $('p-freq'),
    pTime: $('p-time'),
    pPeriodic: $('p-periodic'),
    pPeriods: $('p-periods'),
    pAmount: $('p-amount'),

    explain: $('explain'),

    doublingExact: $('doubling-exact'),
    doublingRule: $('doubling-rule'),
    doublingNote: $('doubling-note'),

    freqBody: $('freq-body'),
    freqCaption: $('freq-caption'),
    rateBody: $('sens-rate-body'),
    rateCaption: $('sens-rate-caption'),
    timeBody: $('sens-time-body'),
    timeCaption: $('sens-time-caption'),

    yearlyBody: $('yearly-body'),
    yearlyCaption: $('yearly-caption'),
    periodsDetails: $('periods-details'),
    periodsBody: $('periods-body'),
    periodsCaption: $('periods-caption'),
    periodsNote: $('periods-note'),

    ch1Principal: $('chart-balance-principal'),
    ch1Interest: $('chart-balance-interest'),
    ch1Hatch: $('chart-balance-interest-hatch'),
    ch1Line: $('chart-balance-line'),
    ch1Ymax: $('chart-balance-ymax'),
    ch1Xmax: $('chart-balance-xmax'),
    ch1Desc: $('chart-balance-desc'),
    ch1Legend: $('chart-balance-legend'),

    ch2Gap: $('chart-compare-gap'),
    ch2Simple: $('chart-compare-simple'),
    ch2Compound: $('chart-compare-compound'),
    ch2Ymax: $('chart-compare-ymax'),
    ch2Xmax: $('chart-compare-xmax'),
    ch2Desc: $('chart-compare-desc')
  };

  /*
   * The only interaction state on the page. Everything else is derived from the
   * inputs on every keystroke, because one Math.pow and a hundred rows cost
   * microseconds and caching them would buy nothing but staleness.
   */
  var state = {
    /* The period table is the one disclosure worth deferring; it is rebuilt when
       open and marked dirty when closed. */
    periodsDirty: true,
    lastModel: null
  };

  /* ---------------- reading the form ---------------- */

  function fieldValue(input) {
    return input ? parseNumber(input.value) : null;
  }

  function timeUnit() {
    return ui.timeUnitMonths && ui.timeUnitMonths.checked ? 'months' : 'years';
  }

  function readInputs() {
    var errors = {};
    var warnings = {};

    var principal = fieldValue(ui.principal);
    if (principal == null || principal <= 0) {
      errors['principal'] = 'Enter a starting amount greater than zero.';
    } else if (principal > HARD_MAX_MONEY) {
      errors['principal'] = 'Enter a starting amount of ' + moneyWhole(HARD_MAX_MONEY) + ' or less.';
    }

    var ratePct = fieldValue(ui.rate);
    if (ratePct == null) {
      errors['rate'] = 'Enter an interest rate.';
    } else if (ratePct < HARD_MIN_RATE || ratePct > HARD_MAX_RATE) {
      errors['rate'] = 'Enter a rate between ' + HARD_MIN_RATE + '% and ' + HARD_MAX_RATE + '%.';
    } else if (ratePct > WARN_RATE) {
      warnings['rate'] = 'Rates above ' + WARN_RATE + '% are far outside what a deposit account pays. The figures below are still exact for what you typed.';
    } else if (ratePct < 0) {
      warnings['rate'] = 'A negative rate shrinks the balance rather than growing it. That is unusual but it has happened, and the arithmetic below is exact for it.';
    }

    var unit = timeUnit();
    var rawTime = fieldValue(ui.time);
    var years = null;
    if (rawTime == null) {
      errors['time'] = 'Enter a length of time.';
    } else {
      years = unit === 'months' ? rawTime / 12 : rawTime;
      if (years <= 0) {
        errors['time'] = 'Enter a length of time greater than zero.';
      } else if (years > HARD_MAX_YEARS) {
        errors['time'] = 'Enter a length of time of ' + HARD_MAX_YEARS + ' years or less.';
      } else if (years > WARN_YEARS) {
        warnings['time'] = 'Horizons longer than ' + WARN_YEARS + ' years are unusual, but the figures below are exact for what you typed.';
      }
    }

    /*
     * Blank is "not entered", not zero. The difference is what lets the result
     * panel hide the purchasing-power figure entirely rather than showing one
     * identical to the balance above it.
     */
    var inflationPct = null;
    if (ui.inflation && ui.inflation.value.trim() !== '') {
      inflationPct = fieldValue(ui.inflation);
      if (inflationPct == null || inflationPct < -10 || inflationPct > 25) {
        errors['inflation'] = 'Enter an inflation rate between −10% and 25%, or leave it blank.';
        inflationPct = null;
      }
    }

    return {
      errors: errors,
      warnings: warnings,
      values: {
        principal: principal,
        ratePct: ratePct,
        frequencyKey: ui.frequency ? ui.frequency.value : '12',
        years: years,
        unit: unit,
        inflationPct: inflationPct
      }
    };
  }

  /* ---------------- validation UI ---------------- */

  /*
   * The message element is in the DOM from the start and referenced by
   * aria-describedby from the start, so turning it on is a `hidden` toggle and
   * not a change of accessible description.
   */
  function setMessage(fieldId, suffix, message) {
    var input = $(fieldId);
    var node = $(fieldId + '-' + suffix);
    if (node) {
      node.hidden = !message;
      if (message) node.textContent = message;
    }
    if (input && suffix === 'error') {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  var MESSAGE_FIELDS = ['principal', 'rate', 'time', 'inflation'];

  function paintMessages(errors, warnings) {
    for (var k = 0; k < MESSAGE_FIELDS.length; k++) {
      var id = MESSAGE_FIELDS[k];
      setMessage(id, 'error', errors[id] || '');
      setMessage(id, 'warn', warnings[id] || '');
    }
  }

  /* ---------------- rendering ---------------- */

  function text(node, value) { if (node) node.textContent = value; }

  function renderParams(m) {
    text(ui.pPrincipal, moneyNatural(m.principal));
    text(ui.pRate, decimalText(m.rate) + ' (' + pctTrim(m.rate) + ')');
    text(ui.pFreq, m.n === null ? 'Not applicable' : integer(m.n) + ' (' + m.freq.adverb + ')');
    text(ui.pTime, m.durationText);
    /* Under continuous compounding there is no period and no periodic rate, and
       saying so is better than printing a dash the reader has to interpret. */
    text(ui.pPeriodic, m.n === null
      ? 'None — interest is added continuously'
      : pctSig(m.periodicRate) + ' a ' + m.freq.period);
    text(ui.pPeriods, m.n === null
      ? 'None — there are no discrete periods'
      : numTrim(m.periods) + ' ' + plural(m.periods, 'period'));
    text(ui.pAmount, money(m.amount));

    /* The formula itself changes, because it is a different equation. */
    if (ui.formulaDiscrete) ui.formulaDiscrete.hidden = m.n === null;
    if (ui.formulaContinuous) ui.formulaContinuous.hidden = m.n !== null;
  }

  function renderResults(m) {
    text(ui.resultLabel, 'Balance after ' + m.durationText);
    text(ui.resultAmount, money(m.amount));
    /* A loss is not "interest earned", and the label says which it is. */
    text(ui.interestLabel, m.negative ? 'Decline' : 'Interest earned');
    text(ui.interest, money(m.negative ? -m.interest : m.interest));
    text(ui.principalOut, money(m.principal));
    text(ui.ear, pctTrim(m.ear));
    text(ui.multiple, multiple(m.growth));

    if (ui.real) {
      ui.real.hidden = m.real == null;
      if (m.real != null) {
        text(ui.realAmount, money(m.real));
        text(ui.realNote, 'Assuming ' + pctTrim(m.inflation) + ' inflation for ' +
          m.durationText + '. The formula produced the figure above; this is that figure divided by (1 + i) to the power t.');
      }
    }

    if (ui.doublingNote) {
      /* Nothing doubles at a zero or negative rate, so the callout goes away
         rather than reporting a doubling time that does not exist. */
      ui.doublingNote.hidden = m.doubling == null;
      if (m.doubling != null) {
        text(ui.doublingExact, numTrim(m.doubling) + ' years');
        text(ui.doublingRule, numTrim(72 / m.ratePct) + ' years');
      }
    }
    if (ui.doublingExact && m.doubling == null) text(ui.doublingExact, 'not applicable at this rate');
  }

  /* A short decimal, for the parameter table and the substitution: 5% is 0.05,
     not 0.05000000000000001. */
  function decimalText(value) {
    return String(Math.round(value * 1e10) / 1e10);
  }

  /*
   * Rebuilt in full on every input event. Five short strings is free, and diffing
   * them would buy nothing except the possibility of a stale fragment surviving a
   * branch change. A paragraph whose sentences all filtered out is hidden rather
   * than left standing as an empty line.
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

  function renderSubstitution(m) {
    if (!ui.substitution) return;

    var body;
    if (m.n === null) {
      /* A = P e^(r x t) */
      var exponent = mrow([mel('mn', decimalText(m.rate)), mel('mo', '×'), mel('mn', numTrim(m.years))]);
      var power = mel('msup');
      power.appendChild(mel('mi', 'e'));
      power.appendChild(exponent);
      body = [mel('mi', 'A'), mel('mo', '='), mel('mn', moneyNatural(m.principal)), power];
    } else {
      /* A = P (1 + r/n)^(n x t) */
      var fraction = mel('mfrac');
      fraction.appendChild(mel('mn', decimalText(m.rate)));
      fraction.appendChild(mel('mn', integer(m.n)));
      var base = mrow([mel('mo', '('), mel('mn', '1'), mel('mo', '+'), fraction, mel('mo', ')')]);
      var count = mrow([mel('mn', integer(m.n)), mel('mo', '×'), mel('mn', numTrim(m.years))]);
      var raised = mel('msup');
      raised.appendChild(base);
      raised.appendChild(count);
      body = [mel('mi', 'A'), mel('mo', '='), mel('mn', moneyNatural(m.principal)), raised];
    }
    body.push(mel('mo', '≈'));
    body.push(mel('mn', money(m.amount)));

    var math = document.createElementNS(MATHML, 'math');
    math.setAttribute('display', 'block');
    math.appendChild(mrow(body));
    replace(ui.substitution, math);
  }

  /* ---------------- tables ---------------- */

  function cell(tag, value, scope) {
    var node = document.createElement(tag);
    if (scope) node.setAttribute('scope', scope);
    node.appendChild(document.createTextNode(value));
    return node;
  }

  /*
   * The reader's own row, which every other row is measured against. Marked with
   * a word as well as a tint, because colour alone would not survive
   * forced-colors mode, a monochrome print, or a reader who cannot see it.
   */
  function markCurrent(tr, th) {
    tr.setAttribute('aria-current', 'true');
    tr.className = 'sens__row--current';
    var badge = document.createElement('span');
    badge.className = 'sens__tag';
    badge.appendChild(document.createTextNode('yours'));
    th.appendChild(document.createTextNode(' '));
    th.appendChild(badge);
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

  function renderFrequency(m) {
    if (!ui.freqBody) return;
    var rows = frequencyTable(m);
    var frag = document.createDocumentFragment();
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var tr = document.createElement('tr');
      var th = cell('th', r.freq.label, 'row');
      if (r.current) markCurrent(tr, th);
      tr.appendChild(th);
      tr.appendChild(cell('td', r.freq.n === null ? '—' : integer(r.freq.n)));
      tr.appendChild(cell('td', r.periodicRate === null ? '—' : pctSig(r.periodicRate)));
      tr.appendChild(cell('td', money(r.amount)));
      tr.appendChild(cell('td', pctTrim(r.ear)));
      tr.appendChild(cell('td', r.freq.n === 1 ? '—' : moneySigned(r.vsAnnual)));
      frag.appendChild(tr);
    }
    replace(ui.freqBody, frag);
    text(ui.freqCaption, frequencyCaptionText(m, rows));
  }

  function renderSensitivity(m) {
    if (!ui.rateBody && !ui.timeBody) return;
    var s = sensitivity(m);
    var k, r, tr, th, frag;

    if (ui.rateBody) {
      frag = document.createDocumentFragment();
      for (k = 0; k < s.rates.length; k++) {
        r = s.rates[k];
        tr = document.createElement('tr');
        th = cell('th', pctTrim(r.ratePct / 100), 'row');
        if (r.current) markCurrent(tr, th);
        tr.appendChild(th);
        tr.appendChild(cell('td', money(r.amount)));
        tr.appendChild(cell('td', r.current ? '—' : moneySigned(r.amountDelta)));
        tr.appendChild(cell('td', money(r.interest)));
        frag.appendChild(tr);
      }
      replace(ui.rateBody, frag);
      text(ui.rateCaption, rateCaptionText(m, s.rates));
    }

    if (ui.timeBody) {
      frag = document.createDocumentFragment();
      for (k = 0; k < s.times.length; k++) {
        r = s.times[k];
        tr = document.createElement('tr');
        th = cell('th', numTrim(r.years) + ' ' + plural(r.years, 'year'), 'row');
        if (r.current) markCurrent(tr, th);
        tr.appendChild(th);
        tr.appendChild(cell('td', money(r.amount)));
        tr.appendChild(cell('td', r.current ? '—' : moneySigned(r.amountDelta)));
        tr.appendChild(cell('td', money(r.interest)));
        frag.appendChild(tr);
      }
      replace(ui.timeBody, frag);
      text(ui.timeCaption, timeCaptionText(m, s.times));
    }
  }

  function renderYearly(m) {
    if (!ui.yearlyBody) return;
    var frag = document.createDocumentFragment();
    for (var k = 0; k < m.yearly.length; k++) {
      var y = m.yearly[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', y.partial ? numTrim(y.at) : String(y.year), 'row'));
      tr.appendChild(cell('td', money(y.interest)));
      tr.appendChild(cell('td', money(y.cumulative)));
      tr.appendChild(cell('td', money(y.balance)));
      frag.appendChild(tr);
    }
    replace(ui.yearlyBody, frag);
    text(ui.yearlyCaption, yearlyCaptionText(m));
  }

  function yearlyCaptionText(m) {
    var lead = 'Interest earned each year, the interest earned so far, and the balance at the end of each year, for ' +
      moneyNatural(m.principal) + ' at ' + pctTrim(m.rate) + ' compounded ' + m.freq.adverb + '. ';
    return lead + 'Every row is the formula evaluated at that year, not a running total, so the last row is the balance above rather than a number that resembles it.';
  }

  function renderPeriods(m) {
    if (!ui.periodsBody) return;
    var frag = document.createDocumentFragment();
    for (var k = 0; k < m.periodRows.length; k++) {
      var p = m.periodRows[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', String(p.n), 'row'));
      tr.appendChild(cell('td', money(p.opening)));
      tr.appendChild(cell('td', money(p.interest)));
      tr.appendChild(cell('td', money(p.closing)));
      frag.appendChild(tr);
    }
    replace(ui.periodsBody, frag);

    if (ui.periodsNote) {
      var note = '';
      if (m.n === null) {
        note = 'Continuous compounding has no discrete periods to list. There is no first period, because interest is added at every instant rather than at intervals.';
      } else if (!m.periodRows.length) {
        note = 'The horizon is shorter than a single compounding period, so there is no completed period to show.';
      }
      ui.periodsNote.hidden = !note;
      if (note) ui.periodsNote.textContent = note;
    }
    text(ui.periodsCaption, periodsCaptionText(m));
    state.periodsDirty = false;
  }

  function periodsCaptionText(m) {
    if (!m.periodRows.length) return 'No completed compounding periods to show.';
    return 'The first ' + m.periodRows.length + ' of ' + numTrim(m.periods) +
      ' compounding periods. Each period applies ' + pctSig(m.periodicRate) +
      ' to the balance as it stands, which is why the interest column ' +
      (m.negative ? 'falls' : 'rises') + ' while the rate does not.';
  }

  /* ---------------- charts ---------------- */

  function renderCharts(m) {
    var k;

    /* One point per year plus the origin. A daily series would be 36,500 points,
       heavier to parse, heavier to redraw, and visually identical at this size. */
    var balances = [m.principal];
    for (k = 0; k < m.yearly.length; k++) balances.push(m.yearly[k].balance);
    var flat = [];
    var zeros = [];
    for (k = 0; k < balances.length; k++) { flat.push(m.principal); zeros.push(0); }

    var max1 = Math.max(m.principal, m.amount);
    var interestBand = seriesBand(flat, balances, max1);
    if (ui.ch1Principal) ui.ch1Principal.setAttribute('d', seriesBand(zeros, flat, max1));
    /* The tint and the hatch are two paths over one outline: SVG allows a single
       fill per path, and the hatch is what survives forced-colors. */
    if (ui.ch1Interest) ui.ch1Interest.setAttribute('d', interestBand);
    if (ui.ch1Hatch) ui.ch1Hatch.setAttribute('d', interestBand);
    if (ui.ch1Line) ui.ch1Line.setAttribute('d', seriesLine(balances, max1));
    text(ui.ch1Ymax, moneyWhole(max1));
    text(ui.ch1Xmax, 'Year ' + m.yearly.length);
    text(ui.ch1Desc, balanceDescription(m));
    /* The band sits below the principal line at a negative rate, so the word
       "Interest" would be wrong. The position carries the meaning; the label
       says which meaning it is carrying. */
    text(ui.ch1Legend, m.negative ? 'Decline (hatched, below)' : 'Interest (hatched, above)');

    /* Compound against simple, sampled at the same points. */
    var points = m.yearly.length + 1;
    var compound = [];
    var simple = [];
    var at;
    for (k = 0; k < points; k++) {
      at = points < 2 ? 0 : (k / (points - 1)) * m.years;
      compound.push(futureValue(m.principal, m.rate, m.n, at));
      simple.push(simpleValue(m.principal, m.rate, at));
    }
    var max2 = 0;
    for (k = 0; k < points; k++) {
      if (compound[k] > max2) max2 = compound[k];
      if (simple[k] > max2) max2 = simple[k];
    }
    if (ui.ch2Gap) ui.ch2Gap.setAttribute('d', seriesBand(simple, compound, max2));
    if (ui.ch2Simple) ui.ch2Simple.setAttribute('d', seriesLine(simple, max2));
    if (ui.ch2Compound) ui.ch2Compound.setAttribute('d', seriesLine(compound, max2));
    text(ui.ch2Ymax, moneyWhole(max2));
    text(ui.ch2Xmax, 'Year ' + m.yearly.length);
    text(ui.ch2Desc, comparisonDescription(m));
  }

  /* ---------------- the live region ---------------- */

  /*
   * The computation is never debounced -- it is one exponent, and a sighted
   * reader should see the number move as they type. The announcement is, on a
   * 500ms trailing delay, because a live region that fires on every keystroke is
   * a live region nobody can use.
   */
  var announceTimer = null;
  function announceLater(message) {
    if (!ui.status) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      ui.status.textContent = message;
    }, 500);
  }

  /* ---------------- the partial-period readout ---------------- */

  /*
   * Shown only when n times t is not a whole number, because that is the only
   * time it says anything. It lives at the field rather than only in the
   * assumptions, where nobody would look for it.
   */
  function paintTimeReadout(m) {
    if (!ui.timeReadout) return;
    var show = m && m.partialPeriod;
    ui.timeReadout.hidden = !show;
    if (show) {
      ui.timeReadout.textContent = integer(m.n) + ' × ' + numTrim(m.years) + ' = ' +
        numTrim(m.periods) + ' periods, so the last one is partial. The formula prorates it.';
    }
  }

  /* ---------------- the update cycle ---------------- */

  function update() {
    var read = readInputs();
    paintMessages(read.errors, read.warnings);

    var failures = [];
    for (var key in read.errors) {
      if (Object.prototype.hasOwnProperty.call(read.errors, key)) failures.push(key);
    }

    var m = failures.length ? null : buildModel(read.values);

    if (!m) {
      /*
       * Freeze rather than blank. The previous figures stay on screen, dimmed,
       * under a sentence saying they are waiting -- because $NaN is useless and a
       * stale number that still looks current is worse than either.
       */
      if (ui.resultPanel) ui.resultPanel.classList.add('result--stale');
      if (ui.staleNote) {
        ui.staleNote.hidden = false;
        ui.staleNote.textContent = 'Waiting for a valid entry. The figures shown are from your last complete entry.';
      }
      announceLater('Waiting for a valid entry. The figures shown are from your last complete entry.');
      return;
    }

    if (ui.resultPanel) ui.resultPanel.classList.remove('result--stale');
    if (ui.staleNote) ui.staleNote.hidden = true;

    state.lastModel = m;

    renderParams(m);
    renderResults(m);
    renderExplanation(m);
    renderSubstitution(m);
    renderFrequency(m);
    renderSensitivity(m);
    renderYearly(m);
    renderCharts(m);
    paintTimeReadout(m);

    if (ui.periodsDetails && ui.periodsDetails.open) renderPeriods(m);
    else state.periodsDirty = true;

    announceLater(summarySentence(m));
  }

  /* ---------------- wiring ---------------- */

  /*
   * One listener on the form rather than one per control. `input` fires for text
   * fields, radios, and the select alike, so there is nothing left for `change`
   * to add except the unit conversion below.
   */
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  /*
   * The form cannot submit today: it has no action and no submit button, and the
   * spec suppresses implicit submission for a form with several text fields and
   * no submit button. That is a guarantee resting on an absence. Adding one
   * button would turn Enter into a GET of this same page with the amount in the
   * query string -- and page_location is the one thing analytics records
   * verbatim. Two lines, and the numbers stay in the tab.
   */
  function blockSubmit(event) { event.preventDefault(); }
  form.addEventListener('submit', blockSubmit);

  function onInput(event) {
    /*
     * Gated to `change`, and that gate is load-bearing. A radio fires `input` AND
     * `change` for one interaction, and this handler transforms the field's own
     * value -- so running it on both events converts twice, and 10 years becomes
     * 120 months and then 1,440.
     */
    if (event.type === 'change') {
      if (event.target === ui.timeUnitYears || event.target === ui.timeUnitMonths) {
        convertTimeUnit(event.target);
      }
    }
    update();
  }

  /*
   * Switching Years to Months converts the figure rather than reinterpreting it.
   * Without this, "10" would silently become "10 months" on a single click, which
   * is the sort of thing that makes a calculator untrustworthy.
   */
  function convertTimeUnit(chosen) {
    if (!ui.time) return;
    var current = parseNumber(ui.time.value);
    if (current == null) return;
    var toMonths = chosen === ui.timeUnitMonths;
    var converted = toMonths ? current * 12 : current / 12;
    ui.time.value = String(Math.round(converted * 1e6) / 1e6);
  }

  if (ui.periodsDetails) {
    ui.periodsDetails.addEventListener('toggle', function () {
      if (ui.periodsDetails.open && state.periodsDirty && state.lastModel) {
        renderPeriods(state.lastModel);
      }
    });
  }

  /*
   * The page already carries the default scenario's real figures as static text,
   * so this first pass changes nothing visible. It runs anyway, because the
   * reader may have arrived with values restored by the browser's own form
   * restoration after a reload, and those have to be honoured.
   */
  update();

})();
