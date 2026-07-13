// theme-init.js — applies the persisted theme before the app renders to avoid a
// flash of the wrong color scheme. Externalized (was inline in index.html) so the
// CSP script-src can be tightened to 'self' with no 'unsafe-inline'.
(function () {
  try {
    var t = localStorage.getItem('tyrepulse-theme') || 'dark';
    document.documentElement.classList.add(t);
  } catch (e) {}
})();
