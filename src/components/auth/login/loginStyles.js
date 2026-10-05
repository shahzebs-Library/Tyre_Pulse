/**
 * Sign-in page styles, in the marketing site's system: asphalt #161616,
 * signal yellow #FFC629 used as a FILL behind dark text only (never as text on
 * white), Archivo for the headline, Inter for everything else. The photo panel
 * is fixed in both themes; the form side flips with `html.light`. The card
 * re-points the shared --login-* tokens so the forgot / sign-up / pending
 * markup inherits the palette. Every text token is >= 4.5:1 on its surface.
 */
export const LOGIN_PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&display=swap');
.tpl-shell {
  --tpl-accent: #ffc629;
  --tpl-accent-hover: #ffd451;
  --tpl-on-accent: #161616;
  --tpl-accent-soft: rgba(255,198,41,0.14);
  --tpl-ring: rgba(255,198,41,0.38);
  --tpl-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --tpl-panel-bg: #161616;
  --tpl-card-border: #34342f;
  --tpl-text: #f4f4f0;
  --tpl-dim: #c9c9c2;
  --tpl-faint: #a3a39b;
  --tpl-input: #1f1f1d;
  --tpl-input-border: #3d3d38;
  --tpl-input-focus: #ffc629;
  --tpl-link: #ffc629;
  --tpl-danger: #f97066;
  --tpl-seg: #1f1f1d;
  min-height: 100vh; display: grid; grid-template-columns: 1fr;
  background: var(--tpl-panel-bg);
  font-family: 'Inter', system-ui, sans-serif;
}
html.light .tpl-shell {
  --tpl-panel-bg: #ffffff;
  --tpl-card-border: #e4e4de;
  --tpl-text: #161616;
  --tpl-dim: #56564f;
  --tpl-faint: #6b6b63;
  --tpl-input: #ffffff;
  --tpl-input-border: #d3d3cb;
  --tpl-input-focus: #161616;
  --tpl-link: #8a5a00;
  --tpl-danger: #b42318;
  --tpl-seg: #f4f4f1;
}
.tpl-card {
  --login-text: var(--tpl-text);
  --login-text-dim: var(--tpl-dim);
  --login-text-faint: var(--tpl-faint);
  --login-input-bg: var(--tpl-input);
  --login-input-border: var(--tpl-input-border);
  --login-input-border-focus: var(--tpl-input-focus);
  --login-icon: var(--tpl-faint);
  --login-icon-hover: var(--tpl-text);
  --login-divider: var(--tpl-card-border);
  --login-notice-bg: var(--tpl-seg);
  --login-notice-border: var(--tpl-card-border);
  --login-danger-text: var(--tpl-danger);
  --brand-on-tint: var(--tpl-link);
}

/* ── Photo panel (fixed in both themes) ─────────────────── */
.tpl-hero {
  position: relative; overflow: hidden; isolation: isolate; color: #fff;
  background: #0d1117; padding: 18px 16px 26px; min-height: 260px;
  display: flex; flex-direction: column;
}
.tpl-hero-bg {
  position: absolute; inset: 0; width: 100%; height: 100%; z-index: -2;
  object-fit: cover; object-position: 30% 70%;
  animation: tpl-settle 1600ms var(--tpl-ease) both;
}
.tpl-hero-shade {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: linear-gradient(180deg, rgba(10,12,16,0.55) 0%, rgba(10,12,16,0.15) 38%, rgba(10,12,16,0.82) 100%);
}
@keyframes tpl-settle { from { transform: scale(1.06); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
.tpl-top { display: flex; align-items: center; gap: 16px; }
.tpl-brand { display: flex; align-items: center; gap: 10px; }
.tpl-slash { width: 14px; height: 30px; background: #ffc629; transform: skewX(-20deg); border-radius: 2px; }
.tpl-emblem { width: 40px; height: 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: #fff; }
.tpl-wordmark { font-family: 'Archivo', 'Inter', system-ui, sans-serif; font-size: 21px; font-weight: 800; letter-spacing: -0.02em; color: #fff; direction: ltr; unicode-bidi: isolate; }
.tpl-lang { display: inline-flex; margin-inline-start: auto; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(0,0,0,0.35); backdrop-filter: blur(6px); }
.tpl-lang button { min-width: 44px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 160ms ease, color 160ms ease; }
.tpl-lang button[aria-pressed="true"] { background: #ffc629; color: #161616; }
.tpl-hero-body { margin-top: auto; padding-top: 48px; }
.tpl-title {
  margin: 0; max-width: 15ch; color: #fff; text-wrap: balance;
  font-family: 'Archivo', 'Inter', system-ui, sans-serif;
  font-size: clamp(1.7rem, 7vw, 2.2rem); line-height: 1; font-weight: 800; letter-spacing: -0.035em;
  animation: tpl-rise 700ms var(--tpl-ease) 200ms both;
}
.tpl-bar { display: block; width: 56px; height: 5px; margin-top: 18px; background: #ffc629; transform-origin: left center; animation: tpl-grow 600ms var(--tpl-ease) 650ms both; }
[dir="rtl"] .tpl-bar { transform-origin: right center; }
.tpl-lead { display: none; margin: 16px 0 0; max-width: 40ch; font-size: 16px; line-height: 1.55; color: rgba(255,255,255,0.86); animation: tpl-rise 700ms var(--tpl-ease) 380ms both; }
@keyframes tpl-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes tpl-grow { from { transform: scaleX(0.05); } to { transform: scaleX(1); } }

/* ── Sign-in side ───────────────────────────────────────── */
.tpl-side { display: flex; flex-direction: column; align-items: center; padding: 20px 16px 28px; background: var(--tpl-panel-bg); min-width: 0; }
.tpl-card { width: 100%; max-width: 400px; background: transparent; padding: 4px 0 8px; color: var(--tpl-text); }
.tpl-card > * { animation: tpl-rise 500ms var(--tpl-ease) both; }
.tpl-card > *:nth-child(2) { animation-delay: 60ms; }
.tpl-card > *:nth-child(3) { animation-delay: 120ms; }
.tpl-card > *:nth-child(n+4) { animation-delay: 180ms; }
.tpl-card-top { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-bottom: 6px; }
.tpl-theme { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 999px; color: var(--tpl-dim); }
.tpl-welcome { margin: 0; font-family: 'Archivo', 'Inter', system-ui, sans-serif; font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: var(--tpl-text); }
.tpl-welcome-sub { margin: 8px 0 28px; font-size: 14px; line-height: 1.55; color: var(--tpl-dim); }

.tpl-field[data-invalid] input { border-color: var(--tpl-danger) !important; }
.tpl-field[data-invalid] input:focus { box-shadow: 0 0 0 4px rgba(240,68,56,0.18) !important; }
.tpl-field[data-shake="a"] { animation: tpl-shake-a 360ms var(--tpl-ease); }
.tpl-field[data-shake="b"] { animation: tpl-shake-b 360ms var(--tpl-ease); }
@keyframes tpl-shake-a { 0%,100% { transform: none; } 20% { transform: translateX(-6px); } 45% { transform: translateX(5px); } 70% { transform: translateX(-3px); } }
@keyframes tpl-shake-b { 0%,100% { transform: none; } 20% { transform: translateX(-6px); } 45% { transform: translateX(5px); } 70% { transform: translateX(-3px); } }
.tpl-field-err { margin: 7px 0 0; font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--tpl-danger); }

.tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tpl-check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; color: var(--tpl-dim); cursor: pointer; }
.tpl-check input { width: 18px; height: 18px; accent-color: #161616; }
html:not(.light) .tpl-check input { accent-color: #ffc629; }
.tpl-link-btn { min-height: 44px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-size: 13px; font-weight: 700; cursor: pointer; }
.tpl-link-btn:hover { text-decoration: underline; text-underline-offset: 3px; }
.tpl-primary { width: 100%; min-height: 50px; margin-top: 4px; border: 0; border-radius: 8px; background: var(--tpl-accent); color: var(--tpl-on-accent); font-size: 15px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: background-color 160ms ease, transform 140ms var(--tpl-ease); }
.tpl-primary:active:not(:disabled) { transform: scale(0.98); }
.tpl-primary:disabled { opacity: 0.55; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) { .tpl-primary:hover:not(:disabled) { background: var(--tpl-accent-hover); } }
.tpl-divider { display: flex; align-items: center; gap: 10px; color: var(--tpl-faint); font-size: 12px; font-weight: 600; }
.tpl-divider::before, .tpl-divider::after { content: ''; flex: 1; height: 1px; background: var(--tpl-card-border); }
.tpl-providers { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 8px; }
.tpl-provider { min-height: 46px; border-radius: 8px; border: 1px solid var(--tpl-input-border); background: var(--tpl-input); color: var(--tpl-text); font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; padding: 0 10px; transition: border-color 160ms ease, transform 140ms var(--tpl-ease); }
.tpl-provider:active:not(:disabled) { transform: scale(0.98); }
@media (hover: hover) and (pointer: fine) { .tpl-provider:hover:not(:disabled) { border-color: var(--tpl-text); } }
.tpl-provider:disabled { opacity: 0.6; cursor: not-allowed; }
.tpl-qr { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; margin-top: 16px; padding: 14px; border-radius: 10px; border: 1px solid var(--tpl-card-border); background: var(--tpl-seg); }
.tpl-qr-code img, .tpl-qr-placeholder { width: 96px; height: 96px; border-radius: 8px; background: #fff; display: flex; align-items: center; justify-content: center; color: #56564f; }
.tpl-qr-text h2 { margin: 0; font-size: 14px; font-weight: 800; color: var(--tpl-text); }
.tpl-qr-text p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--tpl-dim); }
.tpl-qr-status { margin-top: 4px; font-size: 12px; color: var(--tpl-text); min-height: 16px; }
.tpl-muted { color: var(--tpl-faint); font-size: 12px; }
.tpl-qr-match { display: block; margin-top: 6px; }
.tpl-qr-match strong { font-size: 1.6rem; letter-spacing: .08em; font-variant-numeric: tabular-nums; }
.tpl-qr-btn { margin-top: 4px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-weight: 700; font-size: 13px; cursor: pointer; }
.tpl-qr-phone { color: var(--tpl-faint); }
.tpl-request { margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--tpl-dim); }
.tpl-request button { min-height: 44px; display: inline-flex; align-items: center; background: none; border: 0; padding: 0; color: var(--tpl-link); font-weight: 700; font-size: 13px; cursor: pointer; }
.tpl-request button:hover { text-decoration: underline; text-underline-offset: 3px; }
.tpl-footer { margin-top: 18px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tpl-footer nav { display: flex; flex-wrap: wrap; justify-content: center; }
.tpl-footer a { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; font-size: 12px; font-weight: 600; color: var(--tpl-dim); text-decoration: none; }
.tpl-footer a:hover { color: var(--tpl-text); text-decoration: underline; }
.tpl-footer small { font-size: 11px; color: var(--tpl-faint); }
.tpl-banner { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; line-height: 1.45; }
.tpl-banner.warn { color: var(--login-warn-text); background: rgba(234,179,8,0.10); border: 1px solid rgba(234,179,8,0.30); }
.tpl-banner.danger { color: var(--tpl-danger); background: rgba(240,68,56,0.08); border: 1px solid rgba(240,68,56,0.28); }
.tpl-net { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: var(--tpl-danger); margin-inline-end: auto; }

.tpl-shell button:focus-visible, .tpl-shell a:focus-visible, .tpl-shell input:focus-visible { outline: 3px solid #161616; outline-offset: 2px; box-shadow: 0 0 0 5px #ffc629; }
html:not(.light) .tpl-side button:focus-visible, html:not(.light) .tpl-side a:focus-visible, .tpl-hero button:focus-visible { outline-color: #ffc629; box-shadow: none; }
.tpl-shell input:focus-visible { outline: none; }
[dir="rtl"] .tpl-shell .tp-dir-icon { transform: scaleX(-1); }

@media (max-width: 480px) {
  .tpl-provider { gap: 6px; padding: 0 6px; font-size: 12.5px; }
  .tpl-qr { grid-template-columns: auto 1fr; }
  .tpl-qr-phone { display: none; }
}
@media (min-width: 640px) {
  .tpl-hero { padding: 22px 28px 30px; min-height: 320px; }
}
@media (min-width: 1024px) {
  .tpl-shell { grid-template-columns: minmax(0, 1.1fr) minmax(460px, 1fr); }
  .tpl-hero { padding: 32px 48px 56px; min-height: 100vh; }
  .tpl-title { font-size: clamp(2.6rem, 4.4vw, 4.2rem); }
  .tpl-lead { display: block; }
  .tpl-side { justify-content: center; padding: 32px 48px; min-height: 100vh; }
}
@media (prefers-reduced-motion: reduce) {
  .tpl-hero-bg, .tpl-title, .tpl-lead, .tpl-card > * { animation: tpl-fade 300ms ease both; }
  .tpl-bar { animation: none; }
  .tpl-field[data-shake] { animation: none; }
  .tpl-shell * { transition-duration: 0.01ms !important; }
}
@keyframes tpl-fade { from { opacity: 0; } to { opacity: 1; } }
`
