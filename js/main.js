(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  var label = document.getElementById('theme-label');
  var icon = document.getElementById('theme-icon');

  var SUN = '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>';
  var MOON = '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"></path>';

  function isDark() {
    var set = root.dataset.theme;
    if (set) return set === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function paint() {
    var dark = isDark();
    /* The button offers the theme you would switch TO, so its label is inverted.
       That state lives in the accessible name alone: pairing it with aria-pressed
       would announce "switch to light theme, pressed", which contradicts itself. */
    label.textContent = dark ? 'Light' : 'Dark';
    icon.innerHTML = dark ? SUN : MOON;
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    /* Forcing both media-keyed metas to one value makes the browser chrome follow
       an explicit choice, which a media query alone cannot do. */
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', dark ? '#02090e' : '#fbfcfa');
    }
  }

  /* Guarded per element rather than per script: this file is shared by every page,
     and a page without the toggle should still get its footer year. */
  if (btn && label && icon) {
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('cm-theme', next); } catch (e) {}
      paint();
    });
    paint();
  }

  var year = document.querySelector('.year');
  if (year) year.textContent = new Date().getFullYear();
})();
