// theme-init.js — applies the persisted theme mode and accent colour before the
// app renders, so the first frame already has the right look (no flash).
// Externalized (was inline in index.html) so the CSP script-src can stay 'self'
// with no 'unsafe-inline'.
//
// Reads what src/contexts/ThemeContext.jsx writes:
//   tp_mode         'light' | 'dark' | 'system'   (default light)
//   tp_accent_vars  { choice, light: {--token: value}, dark: {...} }
//                   computed by src/lib/appThemes.js accentCache()
// Older builds wrote 'tyrepulse-theme' / 'theme'; they are still honoured.
(function () {
  try {
    var root = document.documentElement;
    var mode = localStorage.getItem('tp_mode') ||
      localStorage.getItem('tyrepulse-theme') || localStorage.getItem('theme') || 'light';
    var dark = mode === 'system'
      ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      : mode === 'dark';
    root.classList.add(dark ? 'dark' : 'light');
    root.classList.remove(dark ? 'light' : 'dark');

    var raw = localStorage.getItem('tp_accent_vars');
    if (!raw) return;
    var cache = JSON.parse(raw);
    var vars = cache && cache[dark ? 'dark' : 'light'];
    if (vars && typeof vars === 'object') {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k) && k.indexOf('--') === 0) {
          root.style.setProperty(k, String(vars[k]));
        }
      }
    }
    if (cache && cache.choice) root.setAttribute('data-user-accent', '1');
  } catch (e) { /* never block start-up */ }
})();
