/*
 * Mortgage calculator: the arithmetic, the formatting, and the wiring, in that
 * order. Written to the same rules as /js/main.js -- ES5, `var`, one IIFE, no
 * module, loaded with `defer` -- because there is no build step and there is not
 * going to be one.
 *
 * The single structural idea in this file: the amortization formula owns exactly
 * one number, the principal-and-interest payment. Property tax, insurance,
 * mortgage insurance, and association dues are additive housing costs that never
 * enter it. Every function below is either on one side of that line or the other,
 * and nothing crosses it.
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
   * quotient stops meaning anything. The difference from the P/n limit at 1e-9
   * monthly (about 0.0000012% a year) is under a hundredth of a cent on any loan
   * a person could take out, so treating it as zero is both safer and truer.
   */
  var NEAR_ZERO_RATE = 1e-9;

  /* 50 years of monthly payments. Nothing in the UI can exceed it; the constant
     exists so that a schedule length is bounded by a named limit rather than by
     whatever the caller happened to pass. */
  var MAX_PAYMENTS = 600;

  /* Money is carried as integer cents everywhere between parsing and formatting.
     A 360-iteration accumulation of binary fractions is exactly the situation
     where `0.1 + 0.2` stops being a curiosity and starts being a table whose
     column does not add up. */
  function toCents(dollars) { return Math.round(dollars * 100); }
  function fromCents(cents) { return cents / 100; }

  /*
   * The level payment for a fully amortizing, monthly-compounded, fixed-rate loan
   * with the first payment one period after origination.
   *
   *            P * i
   *   M = ----------------
   *        1 - (1 + i)^-n
   *
   * This is the algebraic twin of P * i(1+i)^n / ((1+i)^n - 1), and it is the one
   * to implement: (1+i)^-n is a number in (0,1) for every realistic input, where
   * (1+i)^n at 40 years and 20% is roughly e^87 -- finite, but a needlessly large
   * value appearing in both numerator and denominator, which is where cancellation
   * error comes from.
   *
   * Returns an unrounded number. Rounding happens once, at the caller.
   */
  function monthlyPayment(principal, periodicRate, payments) {
    if (!(principal > 0) || !(payments > 0)) return NaN;
    /* 0/0 at i = 0. There is no limit to take here and no series worth expanding:
       a zero-interest loan is P split n ways, which is what the formula tends to. */
    if (periodicRate < NEAR_ZERO_RATE) return principal / payments;
    return principal * periodicRate / (1 - Math.pow(1 + periodicRate, -payments));
  }

  /*
   * The schedule the page actually displays, built by recurrence rather than by
   * closed form, so that the rows sum to the totals printed beside them.
   *
   * Interest is rounded to the cent *before* being subtracted, which is what a
   * servicer does, and which is what makes `interest + principal = payment` hold
   * exactly in every row rather than nearly.
   */
  function buildSchedule(principal, periodicRate, payments, payment) {
    var i = periodicRate < NEAR_ZERO_RATE ? 0 : periodicRate;
    var n = Math.min(payments, MAX_PAYMENTS);
    var balance = toCents(principal);
    var due = toCents(payment);
    var rows = [];
    var totalInterest = 0;
    var totalPaid = 0;
    var k, interest, toPrincipal, paid;

    /* Bounded by n, so there is no path to an infinite loop even if the payment
       is smaller than the first month's interest -- a pathological case that ends
       with the whole remaining balance falling due on the last row, which is the
       honest depiction of a loan that does not amortize. */
    for (k = 1; k <= n; k++) {
      interest = Math.round(balance * i);
      toPrincipal = due - interest;
      paid = due;

      /*
       * Checked before `k === n`, and deliberately in that order. With a rounded
       * payment the loan can retire on payment 359 (the rate rounded down) or
       * leave a few cents standing at 360 (rounded up). One branch covers both,
       * and the schedule's length is then whatever it truly is rather than
       * whatever was asked for.
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
         so out loud rather than printing the level payment on row 360 and
         claiming the balance reached zero. */
      finalPaymentCents: rows.length ? rows[rows.length - 1].paymentCents : 0,
      count: rows.length
    };
  }

  /* Twelve rows at a time. Payment 1 is in year 1, payment 12 is still year 1. */
  function summarizeByYear(rows) {
    var years = [];
    var current = null;
    var y, row, k;
    for (k = 0; k < rows.length; k++) {
      row = rows[k];
      y = Math.ceil(row.n / 12);
      if (!current || current.year !== y) {
        current = { year: y, interestCents: 0, principalCents: 0, endingBalanceCents: 0, payments: 0 };
        years.push(current);
      }
      current.interestCents += row.interestCents;
      current.principalCents += row.principalCents;
      current.payments += 1;
      /* Overwritten each month, so it ends up holding the last one in the year. */
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
  function balanceAfter(principal, periodicRate, payments, payment, k) {
    if (periodicRate < NEAR_ZERO_RATE) return Math.max(0, principal - payment * k);
    var g = Math.pow(1 + periodicRate, k);
    return Math.max(0, principal * g - payment * (g - 1) / periodicRate);
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
      .replace(/[$,\s ]/g, '')  /* pasted currency: "$1,234.56", nbsp included */
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
   * per cell would be the single largest cost of a 360-row render, by a wide
   * margin over the arithmetic that produced it.
   * ================================================================ */

  var FMT_MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var FMT_MONEY_WHOLE = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
  var FMT_PCT_2 = new Intl.NumberFormat('en-US', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var FMT_PCT_3 = new Intl.NumberFormat('en-US', {
    style: 'percent', minimumFractionDigits: 3, maximumFractionDigits: 3
  });
  var FMT_PCT_0 = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
  var FMT_PCT_TRIM = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 3 });
  var FMT_PCT_TRIM2 = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });

  function money(n) { return FMT_MONEY.format(n); }
  function moneyWhole(n) { return FMT_MONEY_WHOLE.format(n); }
  function moneyCents(c) { return FMT_MONEY.format(fromCents(c)); }
  function moneyWholeCents(c) { return FMT_MONEY_WHOLE.format(fromCents(c)); }
  /* Same argument as pctTrim, for money: ".00" on a $320,000 loan is clutter in a
     sentence, and dropping it from a $1,918.56 payment would be a lie. */
  function moneyNatural(n) { return toCents(n) % 100 === 0 ? moneyWhole(n) : money(n); }
  function pct(n) { return FMT_PCT_2.format(n); }
  function pct3(n) { return FMT_PCT_3.format(n); }
  function pct0(n) { return FMT_PCT_0.format(n); }
  /* 6% reads as "6%" and 6.125% reads as "6.125%": the trailing zeros are noise
     on a round rate and the digits are load-bearing on a quoted one. */
  function pctTrim(n) { return FMT_PCT_TRIM.format(n); }
  /* Loan-to-value, where the third decimal is noise but the first two can sit on
     either side of the 80% line that lenders actually care about. */
  function pctRatio(n) { return FMT_PCT_TRIM2.format(n); }

  /*
   * "+$118.61", "−$118.61", "$0.00". Used only in the sensitivity columns,
   * where the sign is the entire content of the cell. A true minus sign rather
   * than a hyphen, because that column is read rather than parsed.
   */
  function moneySigned(cents) {
    if (cents === 0) return money(0);
    return (cents > 0 ? '+' : '−') + moneyCents(Math.abs(cents));
  }

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
  var HARD_MAX_RATE = 25;           /* Percent. Rejected above. */
  var WARN_RATE = 15;               /* Percent. Computed, but flagged. */
  var HARD_MAX_YEARS = 50;
  var WARN_YEARS = 40;

  /*
   * Additional costs, in the order the page lists them. The `label` is what the
   * explanation says; the `id` is the input it came from. Kept as data rather
   * than as four parallel branches so that adding a fifth cost cannot forget one
   * of the places it has to appear.
   */
  var COST_FIELDS = [
    { key: 'tax', label: 'property tax' },
    { key: 'insurance', label: 'homeowners insurance' },
    { key: 'pmi', label: 'mortgage insurance' },
    { key: 'hoa', label: 'association dues' }
  ];

  function buildModel(v) {
    var ratePct = v.ratePct;
    var i = ratePct / 100 / 12;
    var years = v.years;
    var n = Math.round(years * 12);
    var principal = v.loanAmount;

    var unrounded = monthlyPayment(principal, i, n);
    var payment = Math.round(unrounded * 100) / 100;
    var schedule = buildSchedule(principal, i, n, payment);
    var yearly = summarizeByYear(schedule.rows);
    var first = schedule.rows[0];
    var last = schedule.rows[schedule.rows.length - 1];

    /* Costs normalise to monthly cents the moment they are read, so nothing
       downstream has to remember which toggle was set. */
    var extras = [];
    var omitted = [];
    var extraCents = 0;
    var k, cost, cents;
    for (k = 0; k < COST_FIELDS.length; k++) {
      cost = COST_FIELDS[k];
      cents = v.costs && v.costs[cost.key] != null ? toCents(v.costs[cost.key]) : null;
      if (cents != null && cents > 0) {
        extras.push({ key: cost.key, label: cost.label, cents: cents });
        extraCents += cents;
      } else {
        omitted.push(cost);
      }
    }

    return {
      principal: principal,
      homePrice: v.homePrice,
      downPayment: v.downPayment,
      /* Loan-to-value, not down-payment percent: LTV is the figure that actually
         governs whether a lender requires mortgage insurance. */
      ltv: v.homePrice > 0 ? principal / v.homePrice : null,
      pinned: !!v.pinned,
      ratePct: ratePct,
      periodicRate: i < NEAR_ZERO_RATE ? 0 : i,
      years: years,
      n: n,
      unroundedPayment: unrounded,
      payment: payment,
      paymentCents: toCents(payment),
      schedule: schedule,
      yearly: yearly,
      firstRow: first,
      lastRow: last,
      extras: extras,
      omitted: omitted,
      extraCents: extraCents,
      housingCents: toCents(payment) + extraCents
    };
  }

  /* ================================================================
   * The explanation. A sentence planner rather than string concatenation:
   * each sentence is only built if its condition holds, the paragraph is
   * dropped when nothing survives, and the one place that joins a series is
   * joinList -- which is the difference between prose and fragments.
   * ================================================================ */

  function explainParagraphs(m) {
    var zero = m.periodicRate === 0;
    var out = [];
    var s;

    /* --- the setup --- */
    s = ['You entered a ' + moneyNatural(m.principal) + ' loan at ' + pctTrim(m.ratePct / 100) +
         ' for ' + m.years + ' ' + plural(m.years, 'year') + '.'];
    if (m.pinned) {
      s.push('That is the amount financed, so the home price above follows from it rather than the other way round.');
    } else if (m.homePrice > 0 && m.downPayment > 0) {
      s.push('That is a ' + moneyNatural(m.homePrice) + ' home with ' + moneyNatural(m.downPayment) +
             ' down, which finances ' + pctRatio(m.ltv) + ' of the price.');
    }
    out.push(s.join(' '));

    /* --- the arithmetic, made visible --- */
    s = [];
    if (zero) {
      s.push('At a zero interest rate there is nothing to compound, so the formula collapses to the loan divided by its number of payments: ' +
             moneyNatural(m.principal) + ' over ' + m.n + ' ' + plural(m.n, 'payment') + '.');
      s.push('That is ' + money(m.payment) + ' a month, every month.');
    } else {
      s.push('Dividing the annual rate by twelve gives a monthly periodic rate of ' + pct3(m.periodicRate) +
             ', and ' + m.years + ' ' + plural(m.years, 'year') + ' of monthly payments gives ' +
             m.n + ' ' + plural(m.n, 'payment') + '.');
      s.push('Putting those two numbers into the fixed-rate formula gives ' + money(m.payment) +
             ' a month for principal and interest.');
    }
    out.push(s.join(' '));

    /* --- what the first payment actually does --- */
    s = [];
    if (zero) {
      s.push('Every payment is principal. There is no interest to separate out, so the balance falls by the same amount each month and the line on the chart below is straight.');
    } else {
      s.push('In the first month, interest is ' + pct3(m.periodicRate) + ' of the ' + moneyNatural(m.principal) +
             ' balance, which is ' + moneyCents(m.firstRow.interestCents) + '. The rest of the payment, ' +
             moneyCents(m.firstRow.principalCents) + ', reduces what you owe.');
      if (m.firstRow.interestCents > m.firstRow.principalCents) {
        s.push('Most of that first payment is interest, which is normal and is simply a consequence of the balance being at its largest.');
      } else if (m.firstRow.principalCents > m.firstRow.interestCents) {
        s.push('Most of that first payment already goes to principal, which happens when the rate is low or the term is short.');
      }
      s.push('By the last payment the split has reversed: ' + moneyCents(m.lastRow.interestCents) +
             ' of interest against ' + moneyCents(m.lastRow.principalCents) + ' of principal.');
    }
    out.push(s.join(' '));

    /* --- the lifetime picture --- */
    s = [];
    s.push('Over ' + m.schedule.count + ' ' + plural(m.schedule.count, 'payment') + ' you would pay ' +
           moneyCents(m.schedule.totalPaidCents) + ' in total' +
           (zero ? ', all of it principal.'
                 : ', of which ' + moneyCents(m.schedule.totalInterestCents) + ' is interest, about ' +
                   pct0(m.schedule.totalInterestCents / toCents(m.principal)) + ' of the amount you borrowed.'));
    if (!zero && m.years >= 30) {
      s.push('A shorter term would raise the monthly payment and lower that total.');
    } else if (!zero && m.years <= 15) {
      s.push('A longer term would lower the monthly payment and raise that total.');
    }
    if (m.schedule.count < m.n) {
      s.push('The schedule runs to ' + m.schedule.count + ' payments rather than ' + m.n +
             ', because rounding the payment up to the nearest cent sends slightly more to principal every month than the formula assumed.');
    }
    out.push(s.join(' '));

    /* --- additional costs, only when there are any --- */
    s = [];
    if (m.extras.length) {
      var pieces = [];
      for (var k = 0; k < m.extras.length; k++) {
        pieces.push(moneyCents(m.extras[k].cents) + ' for ' + m.extras[k].label);
      }
      s.push('That ' + money(m.payment) + ' covers principal and interest only.');
      s.push('The monthly figures you entered are ' + joinList(pieces) + '.');
      s.push('Together those bring the estimated monthly housing payment to ' + moneyCents(m.housingCents) + '.');
      if (m.omitted.length) {
        var names = [];
        for (var j = 0; j < m.omitted.length; j++) names.push(m.omitted[j].label);
        s.push('It does not include ' + joinList(names) + ', which you have not entered.');
      }
      if (hasCost(m, 'pmi')) {
        s.push('Mortgage insurance protects the lender, not you. It is not interest, and it does not reduce the balance.');
      }
    }
    out.push(s.join(' '));

    return out;
  }

  function hasCost(m, key) {
    for (var k = 0; k < m.extras.length; k++) if (m.extras[k].key === key) return true;
    return false;
  }

  /* One line, for the live region. Not the whole explanation: a screen-reader
     user adjusting a slider of a field needs the number, not the essay. */
  function summarySentence(m) {
    var line = 'Monthly principal and interest: ' + money(m.payment) + '.';
    if (m.extras.length) line += ' Estimated monthly housing payment: ' + moneyCents(m.housingCents) + '.';
    return line;
  }

  /* ================================================================
   * Sensitivity. The same arithmetic run again against inputs the reader did
   * not enter, so that "what if the rate were a point higher" is answered by a
   * schedule rather than by a rule of thumb. A point of rate is worth different
   * money at every principal and every term, which is exactly why the answer
   * cannot be written into the prose once and left there.
   * ================================================================ */

  /* Percentage points, added to the rate the reader entered. */
  var RATE_STEPS = [-1, -0.5, 0, 0.5, 1];

  /* Years. The reader's own term joins this list wherever it sorts, so the
     table always contains the row its deltas are measured against. */
  var TERM_STEPS = [15, 20, 30];

  /*
   * One alternative loan, priced from scratch. The payment is rounded to the
   * cent exactly as the headline figure is, and the totals come from a real
   * schedule rather than from payment × n -- so a row in the sensitivity table
   * and the result panel can never disagree about the same loan.
   */
  function scenario(principal, ratePct, years) {
    var i = ratePct / 100 / 12;
    var n = Math.round(years * 12);
    var payment = Math.round(monthlyPayment(principal, i, n) * 100) / 100;
    var s = buildSchedule(principal, i, n, payment);
    return {
      ratePct: ratePct,
      years: years,
      n: n,
      paymentCents: toCents(payment),
      totalInterestCents: s.totalInterestCents,
      totalPaidCents: s.totalPaidCents,
      count: s.count
    };
  }

  function withDeltas(s, m, isCurrent) {
    s.current = !!isCurrent;
    s.paymentDeltaCents = s.paymentCents - m.paymentCents;
    s.interestDeltaCents = s.totalInterestCents - m.schedule.totalInterestCents;
    return s;
  }

  /* Rates carry three decimals at most, and 6.1 - 0.5 is 5.6000000000000005
     in binary. Rounding here is what lets the current row be found by equality
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
       * offering, and a clamped row would be a different loan wearing the
       * label of the one asked for.
       */
      if (r < 0 || r > HARD_MAX_RATE || seen[r]) continue;
      seen[r] = true;
      rates.push(withDeltas(scenario(m.principal, r, m.years), m, RATE_STEPS[k] === 0));
    }

    if (years.indexOf(m.years) === -1) years.push(m.years);
    years.sort(function (a, b) { return a - b; });
    for (k = 0; k < years.length; k++) {
      y = years[k];
      if (y < 1 || y > HARD_MAX_YEARS) continue;
      terms.push(withDeltas(scenario(m.principal, m.ratePct, y), m, y === m.years));
    }

    return { rates: rates, terms: terms };
  }

  function findRate(rows, ratePct) {
    for (var k = 0; k < rows.length; k++) if (rows[k].ratePct === ratePct) return rows[k];
    return null;
  }

  /*
   * The caption is the whole point of the rate table: the table shows five
   * loans, and this says what the distance between two of them costs. Taken
   * from a row rather than from a remembered figure, and phrased downward when
   * a rate a point higher would be outside what the form accepts.
   */
  function rateCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' over ' + m.years + ' ' +
      plural(m.years, 'year') + ', priced at other rates. Your own row is marked.';
    var up = findRate(rows, stepRate(m.ratePct, 1));
    var down = findRate(rows, stepRate(m.ratePct, -1));
    if (up) {
      return lead + ' One percentage point more would add ' + moneyCents(up.paymentDeltaCents) +
        ' a month, and ' + moneyCents(up.interestDeltaCents) + ' in interest over the whole term.';
    }
    if (down) {
      return lead + ' One percentage point less would save ' + moneyCents(-down.paymentDeltaCents) +
        ' a month, and ' + moneyCents(-down.interestDeltaCents) + ' in interest over the whole term.';
    }
    return lead;
  }

  /*
   * The term table's trade is the one people most often take only half of: the
   * payment and the total move in opposite directions, and both numbers belong
   * in the same sentence.
   */
  function termCaptionText(m, rows) {
    var lead = 'The same ' + moneyNatural(m.principal) + ' at ' + pctTrim(m.ratePct / 100) +
      ', over other terms. Your own row is marked.';
    if (m.periodicRate === 0) {
      return lead + ' At a zero rate the term changes the payment and nothing else: there is no interest for a shorter term to save.';
    }
    var shorter = null;
    var longer = null;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].years < m.years) shorter = rows[k];
      else if (rows[k].years > m.years && !longer) longer = rows[k];
    }
    if (shorter) {
      return lead + ' Retiring it in ' + shorter.years + ' years rather than ' + m.years +
        ' would raise the payment by ' + moneyCents(shorter.paymentDeltaCents) +
        ' a month and cut the interest by ' + moneyCents(-shorter.interestDeltaCents) + '.';
    }
    if (longer) {
      return lead + ' Spreading it over ' + longer.years + ' years rather than ' + m.years +
        ' would lower the payment by ' + moneyCents(-longer.paymentDeltaCents) +
        ' a month and add ' + moneyCents(longer.interestDeltaCents) + ' in interest.';
    }
    return lead;
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
      MAX_PAYMENTS: MAX_PAYMENTS,
      toCents: toCents,
      fromCents: fromCents,
      monthlyPayment: monthlyPayment,
      buildSchedule: buildSchedule,
      summarizeByYear: summarizeByYear,
      balanceAfter: balanceAfter,
      parseNumber: parseNumber,
      money: money,
      moneyWhole: moneyWhole,
      moneyNatural: moneyNatural,
      moneySigned: moneySigned,
      pctTrim: pctTrim,
      pctRatio: pctRatio,
      pct: pct,
      joinList: joinList,
      plural: plural,
      CHART_W: CHART_W,
      CHART_H: CHART_H,
      seriesLine: seriesLine,
      seriesArea: seriesArea,
      seriesBand: seriesBand,
      COST_FIELDS: COST_FIELDS,
      buildModel: buildModel,
      explainParagraphs: explainParagraphs,
      summarySentence: summarySentence,
      RATE_STEPS: RATE_STEPS,
      TERM_STEPS: TERM_STEPS,
      HARD_MAX_RATE: HARD_MAX_RATE,
      HARD_MAX_YEARS: HARD_MAX_YEARS,
      scenario: scenario,
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
   * the page -- any other page that happened to include this script -- the same
   * guard returns before touching anything.
   */
  if (typeof document === 'undefined') return;

  function $(id) { return document.getElementById(id); }

  var form = $('calc-form');
  if (!form) return;

  var ui = {
    homePrice: $('home-price'),
    downPayment: $('down-payment'),
    downUnitDollar: $('down-unit-dollar'),
    downUnitPercent: $('down-unit-percent'),
    ltv: $('ltv-readout'),
    loanAmount: $('loan-amount'),
    pinnedNote: $('loan-pinned-note'),
    unpin: $('unpin-loan'),
    rate: $('interest-rate'),
    term: $('term'),
    termOtherField: $('term-other-field'),
    termOther: $('term-other'),

    tax: $('tax'),
    taxUnitYear: $('tax-unit-year'),
    insurance: $('insurance'),
    insUnitYear: $('insurance-unit-year'),
    pmi: $('pmi'),
    hoa: $('hoa'),

    status: $('calc-status'),
    resultPanel: $('result-panel'),
    resultPi: $('result-pi'),
    staleNote: $('result-stale-note'),
    totalInterest: $('result-total-interest'),
    totalPaid: $('result-total-paid'),
    payments: $('result-payments'),
    finalPayment: $('result-final'),
    housing: $('result-housing'),
    housingAmount: $('result-housing-amount'),
    housingNote: $('result-housing-note'),

    pLoan: $('p-loan'),
    pRate: $('p-rate'),
    pCount: $('p-count'),
    pPayment: $('p-payment'),

    explain: $('explain'),

    sensRateBody: $('sens-rate-body'),
    sensRateCaption: $('sens-rate-caption'),
    sensTermBody: $('sens-term-body'),
    sensTermCaption: $('sens-term-caption'),

    yearlyBody: $('amort-yearly-body'),
    yearlyCaption: $('amort-yearly-caption'),
    monthlyDetails: $('amort-monthly'),
    monthlyBody: $('amort-monthly-body'),
    monthlyCaption: $('amort-monthly-caption'),

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
   * inputs on every keystroke, because recomputing a 360-row schedule costs
   * roughly ten microseconds and caching it would buy nothing but staleness.
   */
  var state = {
    /* Set the moment the reader types into the loan amount. From then on the
       home price is the derived figure, which is what a refinancer needs and
       what anyone who just read the formula section expects. */
    loanPinned: false,
    /* The monthly schedule is 1,800 elements. It is rebuilt when the disclosure
       is open and marked dirty when it is not; this is the one place on the page
       where doing the obvious thing on every keystroke would actually be felt. */
    monthlyDirty: true,
    lastModel: null
  };

  /* ---------------- reading the form ---------------- */

  function fieldValue(input) {
    return input ? parseNumber(input.value) : null;
  }

  function readInputs() {
    var errors = {};
    var warnings = {};

    var rawPrice = fieldValue(ui.homePrice);
    var rawDown = fieldValue(ui.downPayment);
    var downIsPercent = !!(ui.downUnitPercent && ui.downUnitPercent.checked);
    var rawLoan = fieldValue(ui.loanAmount);
    var ratePct = fieldValue(ui.rate);
    var years = readTerm(errors, warnings);

    var homePrice, downPayment, loanAmount;

    if (state.loanPinned) {
      /*
       * The loan amount is the input and the home price is the consequence. With
       * the down payment expressed as a percentage that inversion is not a
       * subtraction: if d% of the price is down, the loan is (100 - d)% of it, so
       * price = loan / (1 - d/100). Anything at or above 100% has no price that
       * satisfies it, so the percentage is the field that is wrong.
       */
      loanAmount = rawLoan;
      if (loanAmount == null || loanAmount <= 0) {
        errors['loan-amount'] = 'Enter a loan amount greater than zero.';
      } else if (loanAmount > HARD_MAX_MONEY) {
        errors['loan-amount'] = 'Enter a loan amount of ' + moneyWhole(HARD_MAX_MONEY) + ' or less.';
      }
      if (downIsPercent) {
        if (rawDown == null || rawDown < 0 || rawDown >= 100) {
          errors['down-payment'] = 'Enter a down payment between 0% and 100%.';
          homePrice = loanAmount;
          downPayment = 0;
        } else {
          homePrice = loanAmount / (1 - rawDown / 100);
          downPayment = homePrice - loanAmount;
        }
      } else {
        downPayment = rawDown == null ? 0 : rawDown;
        if (downPayment < 0) {
          errors['down-payment'] = 'A down payment cannot be negative.';
          downPayment = 0;
        }
        homePrice = loanAmount + downPayment;
      }
    } else {
      homePrice = rawPrice;
      if (homePrice == null || homePrice <= 0) {
        errors['home-price'] = 'Enter a home price greater than zero.';
      } else if (homePrice > HARD_MAX_MONEY) {
        errors['home-price'] = 'Enter a home price of ' + moneyWhole(HARD_MAX_MONEY) + ' or less.';
      }
      if (rawDown == null) {
        downPayment = 0;
      } else if (downIsPercent) {
        if (rawDown < 0 || rawDown >= 100) {
          errors['down-payment'] = 'Enter a down payment between 0% and 100%.';
          downPayment = 0;
        } else {
          downPayment = (homePrice || 0) * rawDown / 100;
        }
      } else {
        downPayment = rawDown;
        if (downPayment < 0) {
          errors['down-payment'] = 'A down payment cannot be negative.';
          downPayment = 0;
        } else if (homePrice != null && downPayment >= homePrice) {
          errors['down-payment'] = 'The down payment has to be less than the home price.';
        }
      }
      loanAmount = (homePrice || 0) - downPayment;
      if (!errors['home-price'] && !errors['down-payment'] && !(loanAmount > 0)) {
        errors['loan-amount'] = 'The down payment leaves nothing to finance.';
      }
    }

    if (ratePct == null) {
      errors['interest-rate'] = 'Enter an interest rate.';
    } else if (ratePct < 0) {
      /* The arithmetic tolerates a negative rate. U.S. fixed-rate mortgages do
         not, and a calculator that quietly modelled one would be inventing an
         instrument rather than describing one. */
      errors['interest-rate'] = 'Enter a rate of 0% or more.';
    } else if (ratePct > HARD_MAX_RATE) {
      errors['interest-rate'] = 'Enter a rate of ' + HARD_MAX_RATE + '% or less.';
    } else if (ratePct > WARN_RATE) {
      warnings['interest-rate'] = 'Rates above ' + WARN_RATE + '% are far outside the ordinary range for a mortgage. The figures below are still exact for what you typed.';
    }

    return {
      errors: errors,
      warnings: warnings,
      values: {
        homePrice: homePrice,
        downPayment: downPayment,
        downIsPercent: downIsPercent,
        loanAmount: loanAmount,
        ratePct: ratePct,
        years: years,
        pinned: state.loanPinned,
        costs: readCosts()
      }
    };
  }

  function readTerm(errors, warnings) {
    var years;
    if (ui.term && ui.term.value === 'other') {
      years = fieldValue(ui.termOther);
      if (years == null) {
        errors['term-other'] = 'Enter a term in years.';
        return null;
      }
      if (years !== Math.round(years)) {
        errors['term-other'] = 'Enter a whole number of years.';
        return null;
      }
      if (years < 1 || years > HARD_MAX_YEARS) {
        errors['term-other'] = 'Enter a term between 1 and ' + HARD_MAX_YEARS + ' years.';
        return null;
      }
      if (years > WARN_YEARS) {
        warnings['term-other'] = 'Terms longer than ' + WARN_YEARS + ' years are unusual, but the figures below are exact for what you typed.';
      }
      return years;
    }
    years = ui.term ? Number(ui.term.value) : 30;
    return isFinite(years) && years > 0 ? years : 30;
  }

  /*
   * All four costs normalise to a monthly dollar figure here and never appear in
   * any other unit again. A blank field is "not entered", not zero: the
   * difference is what lets the explanation say which costs are missing.
   */
  function readCosts() {
    function monthly(input, annualToggle) {
      var v = fieldValue(input);
      if (v == null || v < 0) return null;
      var perYear = annualToggle ? annualToggle.checked : false;
      return perYear ? v / 12 : v;
    }
    return {
      tax: monthly(ui.tax, ui.taxUnitYear),
      insurance: monthly(ui.insurance, ui.insUnitYear),
      pmi: monthly(ui.pmi, null),
      hoa: monthly(ui.hoa, null)
    };
  }

  /* ---------------- validation UI ---------------- */

  /*
   * The message element is in the DOM from the start and referenced by
   * aria-describedby from the start, so turning it on is a `hidden` toggle and
   * not a change of accessible description. Toggled via the property rather than
   * a style, so the attribute stays the single source of truth.
   */
  function setMessage(fieldId, suffix, text) {
    var input = $(fieldId);
    var node = $(fieldId + '-' + suffix);
    if (node) {
      node.hidden = !text;
      if (text) node.textContent = text;
    }
    if (input && suffix === 'error') {
      if (text) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  var MESSAGE_FIELDS = ['home-price', 'down-payment', 'loan-amount', 'interest-rate', 'term-other'];

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
    text(ui.pLoan, moneyNatural(m.principal));
    text(ui.pRate, pct3(m.periodicRate) + ' a month');
    text(ui.pCount, m.n + ' ' + plural(m.n, 'payment'));
    text(ui.pPayment, money(m.payment) + ' a month');
  }

  function renderResults(m) {
    text(ui.resultPi, money(m.payment));
    text(ui.totalInterest, moneyCents(m.schedule.totalInterestCents));
    text(ui.totalPaid, moneyCents(m.schedule.totalPaidCents));
    text(ui.payments, String(m.schedule.count));
    text(ui.finalPayment, moneyCents(m.schedule.finalPaymentCents));

    if (ui.housing) {
      ui.housing.hidden = m.extras.length === 0;
      if (m.extras.length) {
        text(ui.housingAmount, moneyCents(m.housingCents));
        var included = [];
        for (var k = 0; k < m.extras.length; k++) included.push(m.extras[k].label);
        var note = 'Principal and interest plus ' + joinList(included) + '.';
        if (m.omitted.length) {
          var names = [];
          for (var j = 0; j < m.omitted.length; j++) names.push(m.omitted[j].label);
          note += ' Does not include ' + joinList(names) + '.';
        }
        text(ui.housingNote, note);
      }
    }

    if (ui.ltv) {
      text(ui.ltv, m.ltv != null && isFinite(m.ltv)
        ? 'Loan-to-value: ' + pctRatio(m.ltv)
        : 'Loan-to-value: not available');
    }
  }

  /*
   * Rebuilt in full on every input event. Five short strings is free, and
   * diffing them would buy nothing except the possibility of a stale fragment
   * surviving a branch change. A paragraph whose sentences all filtered out is
   * hidden rather than left standing as an empty line.
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

  function cell(tag, value, scope) {
    var td = document.createElement(tag);
    if (scope) td.setAttribute('scope', scope);
    td.appendChild(document.createTextNode(value));
    return td;
  }

  /*
   * Nine more schedules on every keystroke, which sounds worse than it is: the
   * monthly table is 1,800 elements and these two are 36 between them, so the
   * cost is the arithmetic, and the arithmetic is a few thousand integer
   * additions. Cheaper than the render it sits next to, and it buys the one
   * question the calculator otherwise makes the reader answer by retyping.
   */
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

  function sensRows(rows, kind) {
    var frag = document.createDocumentFragment();
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var tr = document.createElement('tr');
      var th = cell('th', kind === 'rate'
        ? pctTrim(r.ratePct / 100)
        : r.years + ' ' + plural(r.years, 'year'), 'row');
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
      tr.appendChild(cell('td', r.current ? '—' : moneySigned(r.paymentDeltaCents)));
      tr.appendChild(cell('td', moneyCents(r.totalInterestCents)));
      frag.appendChild(tr);
    }
    return frag;
  }

  function renderYearly(m) {
    if (!ui.yearlyBody) return;
    var frag = document.createDocumentFragment();
    for (var k = 0; k < m.yearly.length; k++) {
      var y = m.yearly[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', String(y.year), 'row'));
      tr.appendChild(cell('td', moneyWholeCents(y.interestCents)));
      tr.appendChild(cell('td', moneyWholeCents(y.principalCents)));
      tr.appendChild(cell('td', moneyWholeCents(y.endingBalanceCents)));
      frag.appendChild(tr);
    }
    replace(ui.yearlyBody, frag);
    text(ui.yearlyCaption, captionText(m, 'Interest, principal, and the remaining balance at the end of each year.'));
  }

  function renderMonthly(m) {
    if (!ui.monthlyBody) return;
    var frag = document.createDocumentFragment();
    for (var k = 0; k < m.schedule.rows.length; k++) {
      var r = m.schedule.rows[k];
      var tr = document.createElement('tr');
      tr.appendChild(cell('th', String(r.n), 'row'));
      tr.appendChild(cell('td', moneyCents(r.paymentCents)));
      tr.appendChild(cell('td', moneyCents(r.interestCents)));
      tr.appendChild(cell('td', moneyCents(r.principalCents)));
      tr.appendChild(cell('td', moneyCents(r.balanceCents)));
      frag.appendChild(tr);
    }
    replace(ui.monthlyBody, frag);
    text(ui.monthlyCaption, captionText(m, 'Every payment, in order.'));
    state.monthlyDirty = false;
  }

  /* replaceChildren is the one-call version; the loop is the fallback for an
     engine that predates it, and both are a single reflow. */
  function replace(parent, frag) {
    if (parent.replaceChildren) parent.replaceChildren(frag);
    else {
      while (parent.firstChild) parent.removeChild(parent.firstChild);
      parent.appendChild(frag);
    }
  }

  function captionText(m, lead) {
    if (m.periodicRate === 0) return lead + ' At a zero rate every payment is principal.';
    return lead + ' The final payment is ' + moneyCents(m.lastRow.paymentCents) +
      ' rather than ' + money(m.payment) +
      ', because each month’s interest is rounded to the cent and the difference lands on the last row.';
  }

  function renderCharts(m) {
    var yearsCount = m.yearly.length;
    var k;

    /* One point per year, plus the origin. A 360-point path is heavier to parse,
       heavier to redraw, and visually identical at this size. */
    var balances = [m.principal];
    for (k = 0; k < yearsCount; k++) balances.push(fromCents(m.yearly[k].endingBalanceCents));

    if (ui.balanceArea) ui.balanceArea.setAttribute('d', seriesArea(balances, m.principal));
    if (ui.balanceLine) ui.balanceLine.setAttribute('d', seriesLine(balances, m.principal));
    text(ui.balanceMax, moneyWhole(m.principal));
    text(ui.balanceEnd, 'Year ' + yearsCount);
    text(ui.balanceDesc, balanceDescription(m));

    /* Stacked: interest from the baseline, principal riding on top of it. The
       two together are the year's payments, which is why the top edge is flat. */
    var interest = [];
    var totals = [];
    var peak = 0;
    for (k = 0; k < yearsCount; k++) {
      var y = m.yearly[k];
      var iv = fromCents(y.interestCents);
      var tv = fromCents(y.interestCents + y.principalCents);
      interest.push(iv);
      totals.push(tv);
      if (tv > peak) peak = tv;
    }
    var baseline = [];
    for (k = 0; k < yearsCount; k++) baseline.push(0);

    var interestBand = seriesBand(baseline, interest, peak);
    if (ui.compInterest) ui.compInterest.setAttribute('d', interestBand);
    /* The tint and the hatch are two paths over the same outline: one fill per
       path is all SVG allows, and the hatch is what survives forced-colors. */
    if (ui.compInterestHatch) ui.compInterestHatch.setAttribute('d', interestBand);
    if (ui.compPrincipal) ui.compPrincipal.setAttribute('d', seriesBand(interest, totals, peak));
    text(ui.compMax, moneyWhole(peak) + ' a year');
    text(ui.compEnd, 'Year ' + yearsCount);
    text(ui.compDesc, compositionDescription(m));
  }

  /*
   * The chart's real alternative text. `role="img"` plus a label says what the
   * picture is; this says what it shows, which is the part a sighted reader
   * actually gets from the shape of the curve.
   */
  function balanceDescription(m) {
    var parts = [];
    var step = Math.max(1, Math.round(m.yearly.length / 6));
    for (var k = step - 1; k < m.yearly.length; k += step) {
      parts.push('year ' + m.yearly[k].year + ', ' + moneyWholeCents(m.yearly[k].endingBalanceCents));
    }
    return 'Remaining balance at the end of ' + joinList(parts) +
      '. The curve is convex: the balance falls slowly at first and quickly at the end. The same figures appear in the schedule below.';
  }

  function compositionDescription(m) {
    if (!m.yearly.length) return '';
    var first = m.yearly[0];
    var last = m.yearly[m.yearly.length - 1];
    return 'In year 1, ' + moneyWholeCents(first.interestCents) + ' of the year’s payments is interest and ' +
      moneyWholeCents(first.principalCents) + ' is principal. In year ' + last.year + ', ' +
      moneyWholeCents(last.interestCents) + ' is interest and ' + moneyWholeCents(last.principalCents) +
      ' is principal. The total stays the same; only the split moves.';
  }

  /* ---------------- the live region ---------------- */

  /*
   * The computation is never debounced -- it is arithmetic, and a sighted reader
   * should see the number move as they type. The announcement is, on a 500ms
   * trailing delay, because a live region that fires on every keystroke is a
   * live region nobody can use.
   */
  var announceTimer = null;
  function announce(m) {
    if (!ui.status) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      ui.status.textContent = summarySentence(m);
    }, 500);
  }

  function announceStale(message) {
    if (!ui.status) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      ui.status.textContent = message;
    }, 500);
  }

  /* ---------------- derived fields ---------------- */

  /*
   * Only ever writes the field the reader is not editing, which is what makes
   * this safe to run on every keystroke: whichever of home price and loan amount
   * is the derived one is by definition not the one under the cursor.
   */
  function syncDerived(values) {
    var target = state.loanPinned ? ui.homePrice : ui.loanAmount;
    if (!target) return;
    var value = state.loanPinned ? values.homePrice : values.loanAmount;
    if (value == null || !isFinite(value)) return;
    var rounded = Math.round(value * 100) / 100;
    if (parseNumber(target.value) !== rounded) target.value = String(rounded);
  }

  function paintPinned() {
    if (ui.pinnedNote) ui.pinnedNote.hidden = !state.loanPinned;
    if (ui.homePrice) ui.homePrice.readOnly = state.loanPinned;
  }

  /* ---------------- the update cycle ---------------- */

  function update() {
    var read = readInputs();
    paintMessages(read.errors, read.warnings);

    var failures = [];
    for (var key in read.errors) {
      if (Object.prototype.hasOwnProperty.call(read.errors, key)) failures.push(key);
    }

    if (failures.length || read.values.years == null) {
      /*
       * Freeze rather than blank. The previous figures stay on screen, dimmed,
       * under a sentence saying they are waiting -- because $NaN is useless and
       * a stale number that still looks current is worse than either.
       */
      if (ui.resultPanel) ui.resultPanel.classList.add('result--stale');
      if (ui.staleNote) ui.staleNote.hidden = false;
      announceStale('Waiting for a valid entry. The figures shown are from your last complete entry.');
      return;
    }

    if (ui.resultPanel) ui.resultPanel.classList.remove('result--stale');
    if (ui.staleNote) ui.staleNote.hidden = true;

    syncDerived(read.values);

    var m = buildModel(read.values);
    state.lastModel = m;

    renderParams(m);
    renderResults(m);
    renderExplanation(m);
    renderYearly(m);
    renderCharts(m);
    renderSensitivity(m);

    /* 1,800 elements. Built when the disclosure is open, deferred when it is not. */
    if (ui.monthlyDetails && ui.monthlyDetails.open) renderMonthly(m);
    else state.monthlyDirty = true;

    announce(m);
  }

  /* ---------------- wiring ---------------- */

  /*
   * One listener on the form rather than one per control. `input` fires for text
   * fields, radios, and the select alike, so there is nothing left for `change`
   * to add.
   */
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  var costsForm = $('costs-form');
  if (costsForm) {
    costsForm.addEventListener('input', onInput);
    costsForm.addEventListener('change', onInput);
  }

  function onInput(event) {
    var target = event.target;

    /* Typing into the loan amount is the gesture that pins it. Checked before
       anything else reads the form, so the very first keystroke already means
       what the reader intended it to mean. */
    if (target === ui.loanAmount && event.type === 'input' && !state.loanPinned) {
      state.loanPinned = true;
      paintPinned();
    }

    /*
     * Gated to `change`, and that gate is load-bearing. A radio and a select each
     * fire `input` AND `change` for one interaction, and both of these handlers
     * transform the field's own value -- so running them on both events converts
     * twice: $80,000 becomes 20%, and then 20 becomes 0.005%.
     */
    if (event.type === 'change') {
      if (target === ui.downUnitDollar || target === ui.downUnitPercent) convertDownUnit(target);
      if (target === ui.term) paintTermOther();
    }

    update();
  }

  /*
   * Switching $ to % converts the figure rather than reinterpreting it. Without
   * this, "80000" would silently become "80000 percent" on a single click, which
   * is the sort of thing that makes a calculator untrustworthy.
   */
  function convertDownUnit(chosen) {
    if (!ui.downPayment) return;
    var current = parseNumber(ui.downPayment.value);
    var price = parseNumber(ui.homePrice ? ui.homePrice.value : '');
    if (current == null || price == null || price <= 0) return;
    var toPercent = chosen === ui.downUnitPercent;
    var converted = toPercent ? (current / price) * 100 : (current / 100) * price;
    ui.downPayment.value = String(Math.round(converted * 100) / 100);
  }

  function paintTermOther() {
    if (!ui.termOtherField || !ui.term) return;
    var other = ui.term.value === 'other';
    ui.termOtherField.hidden = !other;
    /* Moving focus is right here: the reader picked "Other" in order to type a
       number, and the field they need did not exist a moment ago. */
    if (other && ui.termOther) ui.termOther.focus();
  }

  if (ui.unpin) {
    ui.unpin.addEventListener('click', function () {
      state.loanPinned = false;
      paintPinned();
      update();
    });
  }

  if (ui.monthlyDetails) {
    ui.monthlyDetails.addEventListener('toggle', function () {
      if (ui.monthlyDetails.open && state.monthlyDirty && state.lastModel) {
        renderMonthly(state.lastModel);
      }
    });
  }

  /*
   * The page already carries the default scenario's real figures as static text,
   * so this first pass changes nothing visible. It runs anyway, because the
   * reader may have arrived with values restored by the browser's own form
   * restoration after a reload, and those have to be honoured.
   */
  paintPinned();
  paintTermOther();
  update();


})();
