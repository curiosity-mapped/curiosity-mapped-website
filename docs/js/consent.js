/*
 * The consent interface. Everything that speaks to Google lives in the inline
 * block at the top of each page (see scripts/apply-gtag.sh); this file only
 * asks the question and records the answer, through window.cmConsent. Keeping
 * the split means the panel below can be replaced -- by a certified consent
 * platform, if advertising is ever added -- without touching the Google side.
 */
(function () {
  var KEY = 'cm-consent';
  var VERSION = 1;
  var MAX_AGE = 31536000000; /* 12 months, in milliseconds */

  /*
   * The deferral. A record of the question having been asked and not answered,
   * which is a fact about this interface and not a consent signal -- so it is
   * known only here, and never to the inline block that talks to Google. The
   * two states are byte-identical from Google's side; what differs is whether
   * the panel opens itself again on the next page.
   *
   * Two windows, because being shown a question and saying nothing is weaker
   * evidence than deliberately closing it. A day covers a visit with margin,
   * and gives a reader who never noticed the panel -- it sits at the foot of
   * the viewport, plenty of people never look there -- another chance tomorrow.
   * A month is what an intentional "not now" is worth. Both stay well under
   * MAX_AGE, and that ordering is the rule: a non-answer must never be honoured
   * for longer than an answer. A test asserts it.
   */
  var DEFER_KEY = 'cm-consent-deferred';
  var DEFER_SHOWN_AGE = 86400000; /* 24 hours, in milliseconds */
  var DEFER_DISMISSED_AGE = 2592000000; /* 30 days, in milliseconds */

  /*
   * The same test the inline block performs before it lets gtag.js load, kept
   * here in a form Node can import. The two are held together by a test rather
   * than by sharing code, because the inline copy has to run before anything
   * can be fetched and so cannot be a module. Fails closed: anything it cannot
   * positively recognise as a current, unexpired choice reads as no choice.
   */
  function parse(raw, now) {
    var c;
    try { c = JSON.parse(raw); } catch (e) { return null; }
    if (!c || c.v !== VERSION) return null;
    if (c.analytics !== 'granted' && c.analytics !== 'denied') return null;
    if (typeof c.ts !== 'number') return null;
    if (now - c.ts > MAX_AGE) return null;
    return c.analytics;
  }

  function serialize(state, now) {
    return JSON.stringify({ v: VERSION, analytics: state, ts: now });
  }

  function deferAge(kind) {
    return kind === 'dismissed' ? DEFER_DISMISSED_AGE : DEFER_SHOWN_AGE;
  }

  /*
   * parse's counterpart, and deliberately the same shape so the two can be read
   * side by side. Fails closed in the same direction: anything unrecognisable
   * reads as no deferral, which asks the question. That is also why a change to
   * this record's format needs no VERSION bump -- an old record simply stops
   * parsing and costs one prompt. Bumping VERSION for it would re-prompt
   * everyone who has already answered, which is the thing the README forbids.
   *
   * The one rule parse does not have: a timestamp in the future is rejected.
   * parse can afford to be lax there because its record grants something; this
   * one suppresses a prompt, and a clock set forward would otherwise silence
   * the panel permanently.
   */
  function parseDefer(raw, now) {
    var c;
    try { c = JSON.parse(raw); } catch (e) { return null; }
    if (!c || c.v !== VERSION) return null;
    if (c.defer !== 'shown' && c.defer !== 'dismissed') return null;
    if (typeof c.ts !== 'number') return null;
    if (c.ts > now) return null;
    if (now - c.ts > deferAge(c.defer)) return null;
    return c.defer;
  }

  function serializeDefer(kind, now) {
    return JSON.stringify({ v: VERSION, defer: kind, ts: now });
  }

  /* Node loads this file for the functions above; in a browser `module` is
     undefined, the block is skipped, and the rest of the file runs as usual. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      KEY: KEY, VERSION: VERSION, MAX_AGE: MAX_AGE,
      parse: parse, serialize: serialize,
      DEFER_KEY: DEFER_KEY,
      DEFER_SHOWN_AGE: DEFER_SHOWN_AGE,
      DEFER_DISMISSED_AGE: DEFER_DISMISSED_AGE,
      parseDefer: parseDefer, serializeDefer: serializeDefer
    };
  }

  if (typeof document === 'undefined') return;

  /* No inline block means no consent state to report and no Google to report it
     to, so the controls would be decorative. */
  var consent = window.cmConsent;
  if (!consent) return;

  /*
   * The only storage this file touches directly. Everything else goes through
   * window.cmConsent, and should: that is where the stored choice belongs,
   * because the same block has to read it before gtag.js loads. The deferral
   * cannot go there without teaching the Google-facing code about a state that
   * means nothing to Google, so it lives here instead, and a test asserts the
   * block never learns the key.
   *
   * try/catch for the usual reason: localStorage throws in a private window
   * rather than returning null. A deferral that fails to persist there leaves
   * the panel re-prompting per page exactly as it does today.
   */
  function readDefer() {
    try {
      return parseDefer(localStorage.getItem(DEFER_KEY), Date.now());
    } catch (e) { return null; }
  }

  function writeDefer(kind) {
    /* A reader who has answered has nothing to defer; recording one would be a
       record that could never be acted on. */
    if (consent.state) return;
    try {
      localStorage.setItem(DEFER_KEY, serializeDefer(kind, Date.now()));
    } catch (e) {}
  }

  function clearDefer() {
    try { localStorage.removeItem(DEFER_KEY); } catch (e) {}
  }

  var manage = document.getElementById('consent-manage');
  var status = document.getElementById('consent-status');
  var opener = null;
  var panel = null;

  function label() {
    return consent.state === 'granted' ? 'Analytics: on'
         : consent.state === 'denied'  ? 'Analytics: off'
         : 'Privacy choices';
  }

  function paintManage() {
    if (!manage) return;
    manage.textContent = label();
    manage.setAttribute(
      'aria-label',
      consent.state ? label() + '. Change your choice.' : 'Privacy choices'
    );
  }

  function announce(message) {
    if (status) status.textContent = message;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /*
   * Built here rather than written into all five pages. Nothing on this site
   * templates the head or the chrome, so every shared fragment is copied by
   * hand and drifts; a panel that exists in one place cannot. The footer button
   * stays in the markup, because it is page furniture and belongs where the
   * rest of the furniture is.
   */
  function build() {
    panel = el('section', 'consent');
    panel.id = 'consent-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Privacy choices');
    panel.hidden = true;
    panel.tabIndex = -1;

    var body = el('div', 'consent__body');
    /* Three short sentences, because the panel covers the foot of a small
       screen for as long as it is up. What it must not do is overclaim:
       declining stops the cookies and the requests, and it is the tool
       guarantee -- not the analytics choice -- that keeps what you type local. */
    var text = el('p', 'consent__text',
      'Curiosity Mapped uses Google Analytics to see which pages and tools ' +
      'get used. Decline and nothing is sent from this page. Either way, what ' +
      'you type into a tool stays in your browser. ');
    var more = el('a', null, 'How this works');
    more.href = '/privacy.html#choices-consent';
    text.appendChild(more);
    body.appendChild(text);

    var actions = el('div', 'consent__actions');
    var accept = el('button', 'consent__button', 'Accept analytics');
    accept.type = 'button';
    var reject = el('button', 'consent__button', 'Decline analytics');
    reject.type = 'button';
    accept.addEventListener('click', function () { choose('granted'); });
    reject.addEventListener('click', function () { choose('denied'); });
    actions.appendChild(accept);
    actions.appendChild(reject);

    /*
     * The way out that is not an answer. It has to exist -- the panel covers
     * the foot of a small screen, and answering was the only way to be rid of
     * it -- but it must not compete with the two answers. The rule above about
     * accept and decline being one shape holds in both directions: a third
     * identical pill would make the non-answer the easiest thing on the panel.
     * So it recedes, and the styling does that rather than the wording.
     */
    var dismiss_ = el('button', 'consent__dismiss', 'Not now');
    dismiss_.type = 'button';
    /* The visible text is a prefix of the accessible name, so a voice-control
       user saying "not now" still hits it (WCAG 2.5.3). */
    dismiss_.setAttribute('aria-label', 'Not now. Close without making a choice.');
    dismiss_.addEventListener('click', function () { dismiss(); });
    actions.appendChild(dismiss_);

    body.appendChild(actions);

    /*
     * Escape, bound on the panel rather than the document. The panel is not
     * modal -- it takes no focus on arrival, traps none, and leaves the page
     * behind it fully usable -- so a document-level handler would be claiming a
     * key that belongs to whatever the reader is actually in. The calculator
     * pages are full of number inputs, where Escape has its own meaning.
     */
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') dismiss();
    });

    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  var root = document.documentElement;

  function open(focus) {
    if (!panel) build();
    panel.hidden = false;
    root.classList.add('consent-open');
    /* The panel is fixed to the bottom of the viewport, over the footer, which
       is where the link to the policy it is describing lives. Its height is not
       knowable from the stylesheet -- the text wraps differently at every width
       -- so the body is given room to scroll clear of it. */
    root.style.setProperty('--consent-h', panel.offsetHeight + 'px');
    /* Focus is moved only when the reader asked for the panel. Taking it on a
       first visit would pull someone out of the page they came to read. */
    if (focus) panel.focus();
  }

  function close() {
    if (!panel) return;
    /* Read before hiding: hiding the element that has focus blurs it to the
       body, and then there is no way to tell where focus was. */
    var inside = panel.contains(document.activeElement);
    panel.hidden = true;
    root.classList.remove('consent-open');
    root.style.removeProperty('--consent-h');
    /*
     * Focus moves only if it was in the panel -- a click on "Not now" while the
     * reader's caret sits in a calculator field must not drag them to the
     * footer. Where the panel was opened from the footer control, that is where
     * focus goes back to; where it opened itself, the same control is the right
     * destination anyway. The panel is appended to the body, so #consent-manage
     * is the last focusable thing before it: a keyboard reader who tabbed into
     * the panel came through that button, and it is what reopens the question
     * they have just postponed.
     */
    var target = opener || manage;
    if (inside && target) target.focus();
    opener = null;
  }

  function choose(state) {
    consent.set(state);
    /* An answer outranks the record of the question going unanswered, and
       leaving it behind would only confuse a later VERSION bump. */
    clearDefer();
    paintManage();
    close();
    announce(state === 'granted'
      ? 'Analytics turned on.'
      : 'Analytics turned off. Existing analytics cookies have been removed.');
  }

  /*
   * Closing without answering. It writes the deferral and nothing else: no
   * consent.set, no gtag, no ga-disable. Deferring is not consenting and not
   * declining -- whatever the regional default was, it still is, and this only
   * governs when the panel next opens itself.
   */
  function dismiss() {
    if (!consent.state) {
      writeDefer('dismissed');
      announce('Privacy choices closed without a choice. ' +
               'The Privacy choices button in the footer reopens it.');
    }
    close();
  }

  if (manage) {
    manage.addEventListener('click', function () {
      /* Toggling the panel shut is a close without an answer like any other:
         opening the question and closing it again is still "not now". */
      if (panel && !panel.hidden) { dismiss(); return; }
      opener = manage;
      open(true);
    });
    paintManage();
  }

  /* A choice made in one tab should not leave another tab measuring against the
     old one; the inline block already re-reads storage on the next navigation,
     this covers the tabs that are simply sitting open. */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      var next = parse(e.newValue, Date.now());
      consent.sync(next);
      paintManage();
      if (next) {
        close();
      } else if (!readDefer()) {
        /* Reopening because another tab cleared the choice, but not at a reader
           who has already put the question off -- that would be the same
           re-prompting this exists to stop, arriving by a side door. Nothing is
           written here either: this is a reaction, not an arrival. */
        open(false);
      }
      return;
    }

    /*
     * A deferral from another tab may only ever close this panel, never open
     * one. choose() clears the deferral, so a tab that answers fires two events
     * here -- the choice set, the deferral removed -- and close-only makes the
     * removal a deliberate no-op, which means the two can arrive in either
     * order without any of this having to care.
     */
    if (e.key === DEFER_KEY) {
      if (parseDefer(e.newValue, Date.now())) close();
    }
  });

  /*
   * The arrival. The panel opens itself once per deferral window rather than
   * once per page, which is the whole point: seven pages used to mean seven
   * identical questions in one sitting, and a reader who learns to dismiss the
   * panel is a reader whose eventual answer means less.
   *
   * The write sits here rather than inside open(), so that open() stays a plain
   * UI verb and the storage listener's open(false) is left alone by
   * construction instead of by a flag.
   *
   * What this costs: someone who spends a second on the entry page is not asked
   * again that day. In the denied regions that costs them nothing -- storage
   * stays denied either way. Elsewhere the default is granted, so it is a real
   * cost, bounded by the window being a day and by the footer control being on
   * every page. Recording only on an explicit dismissal would not buy that back
   * -- the reader being nagged is precisely the one who never clicks anything.
   */
  if (!consent.state && !readDefer()) {
    open(false);
    writeDefer('shown');
  }
})();
