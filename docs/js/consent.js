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

  /* Node loads this file for the two functions above; in a browser `module` is
     undefined, the block is skipped, and the rest of the file runs as usual. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      KEY: KEY, VERSION: VERSION, MAX_AGE: MAX_AGE,
      parse: parse, serialize: serialize
    };
  }

  if (typeof document === 'undefined') return;

  /* No inline block means no consent state to report and no Google to report it
     to, so the controls would be decorative. */
  var consent = window.cmConsent;
  if (!consent) return;

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
    body.appendChild(actions);

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
    panel.hidden = true;
    root.classList.remove('consent-open');
    root.style.removeProperty('--consent-h');
    if (opener) { opener.focus(); opener = null; }
  }

  function choose(state) {
    consent.set(state);
    paintManage();
    close();
    announce(state === 'granted'
      ? 'Analytics turned on.'
      : 'Analytics turned off. Existing analytics cookies have been removed.');
  }

  if (manage) {
    manage.addEventListener('click', function () {
      if (panel && !panel.hidden) { close(); return; }
      opener = manage;
      open(true);
    });
    paintManage();
  }

  /* A choice made in one tab should not leave another tab measuring against the
     old one; the inline block already re-reads storage on the next navigation,
     this covers the tabs that are simply sitting open. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var next = parse(e.newValue, Date.now());
    consent.sync(next);
    paintManage();
    if (next) close(); else open(false);
  });

  if (!consent.state) open(false);
})();
