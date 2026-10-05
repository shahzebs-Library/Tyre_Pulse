/**
 * Sign-in page styles. The hero is a dark photo band in BOTH themes; the
 * sign-in panel and card flip with `html.light`. The card re-points the
 * shared --login-* tokens so the existing forgot / sign-up / pending markup
 * inherits the new palette without being rewritten.
 * Contrast: every text token below is >= 4.5:1 on its own surface.
 */
export const LOGIN_PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&display=swap');
.tpl-shell {
  --tpl-green: #4ade80;
  --tpl-btn: #15803d;
  --tpl-btn-hover: #166534;
  --tpl-panel-bg: #0b1612;
  --tpl-card: #0b1612;
  --tpl-card-border: #24352d;
  --tpl-text: #eef3f9;
  --tpl-dim: #b3c0d1;
  --tpl-faint: #93a3b8;
  --tpl-input: #101e18;
  --tpl-input-border: #2e4339;
  --tpl-seg: #101e18;
  --tpl-link: #4ade80;
  min-height: 100vh; display: grid; grid-template-columns: 1fr;
  background: var(--tpl-panel-bg);
}
html.light .tpl-shell {
  --tpl-panel-bg: #f4f7f5;
  --tpl-card: #f4f7f5;
  --tpl-card-border: #dbe3ea;
  --tpl-text: #0f172a;
  --tpl-dim: #475569;
  --tpl-faint: #5b6b80;
  --tpl-input: #ffffff;
  --tpl-input-border: #c3cfdc;
  --tpl-seg: #f1f5f9;
  --tpl-link: #15803d;
}
.tpl-card {
  --login-text: var(--tpl-text);
  --login-text-dim: var(--tpl-dim);
  --login-text-faint: var(--tpl-faint);
  --login-input-bg: var(--tpl-input);
  --login-input-border: var(--tpl-input-border);
  --login-input-border-focus: #16a34a;
  --login-icon: var(--tpl-faint);
  --login-icon-hover: var(--tpl-text);
  --login-divider: var(--tpl-card-border);
  --login-notice-bg: var(--tpl-seg);
  --login-notice-border: var(--tpl-card-border);
  --brand-on-tint: var(--tpl-link);
}
.tpl-sr { position:absolute !important; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }

/* ── Brand panel (fixed palette in both themes) ─────────── */
.tpl-hero {
  position: relative; overflow: hidden; color: #f2f7f4;
  background: #0d3b26;
  padding: 18px 16px 22px;
  display: flex; flex-direction: column; isolation: isolate;
}
.tpl-hero-bg { display: none; }
.tpl-top { display: flex; align-items: center; gap: 16px; }
.tpl-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tpl-emblem {
  width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
  background: #ffffff;
}
.tpl-wordmark { font-size: 19px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff; direction: ltr; unicode-bidi: isolate; }
.tpl-wordmark::before { content: attr(data-a); }
.tpl-wordmark::after { content: attr(data-b); color: #86efac; }
.tpl-lang { display: inline-flex; margin-inline-start: auto; gap: 2px; }
.tpl-lang button {
  min-width: 44px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px; background: transparent;
  color: rgba(242,247,244,0.72); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease;
}
.tpl-lang button[aria-pressed="true"] { color: #ffffff; background: rgba(255,255,255,0.12); }
.tpl-lang button:hover { color: #ffffff; }
.tpl-hero-body { margin-top: 22px; position: relative; z-index: 1; }
.tpl-title {
  margin: 0; max-width: 16ch;
  font-family: 'Archivo', 'Inter', system-ui, sans-serif;
  font-size: clamp(1.6rem, 6.4vw, 2.1rem); line-height: 1.05; font-weight: 800; letter-spacing: -0.03em;
  color: #ffffff; text-wrap: balance;
}
.tpl-lead { display: none; margin: 16px 0 0; font-size: 16px; line-height: 1.6; color: rgba(242,247,244,0.78); max-width: 46ch; }
.tpl-pulse, .tpl-stats { display: none; }
.tpl-pulse { width: 100%; max-width: 560px; height: 48px; margin-top: 36px; overflow: visible; }
.tpl-pulse path {
  fill: none; stroke: #86efac; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 1200; stroke-dashoffset: 1200;
  animation: tpl-draw 1600ms cubic-bezier(0.65, 0, 0.35, 1) 250ms forwards;
}
@keyframes tpl-draw { to { stroke-dashoffset: 0; } }
.tpl-stats { margin: 28px 0 0; grid-template-columns: repeat(3, auto); justify-content: start; column-gap: 48px; }
.tpl-stat { display: flex; flex-direction: column-reverse; gap: 4px; }
.tpl-stat dd { margin: 0; font-family: 'Archivo', 'Inter', system-ui, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff; font-variant-numeric: tabular-nums; }
.tpl-stat dt { font-size: 13px; color: rgba(242,247,244,0.7); }

/* ── Sign-in side ───────────────────────────────────────── */
.tpl-side { display: flex; flex-direction: column; align-items: center; padding: 20px 16px 28px; background: var(--tpl-panel-bg); min-width: 0; }
.tpl-card { width: 100%; max-width: 400px; background: transparent; padding: 4px 0 8px; color: var(--tpl-text); }
.tpl-card-top { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-bottom: 10px; }
.tpl-theme { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 999px; color: var(--tpl-dim); }
.tpl-theme button { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
.tpl-welcome { margin: 0; font-family: 'Archivo', 'Inter', system-ui, sans-serif; font-size: 28px; font-weight: 800; letter-spacing: -0.025em; color: var(--tpl-text); }
.tpl-welcome-sub { margin: 8px 0 28px; font-size: 13.5px; line-height: 1.55; color: var(--tpl-dim); }
.tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tpl-check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; color: var(--tpl-dim); cursor: pointer; }
.tpl-check input { width: 18px; height: 18px; accent-color: #15803d; }
.tpl-link-btn { min-height: 44px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-size: 13px; font-weight: 700; cursor: pointer; }
.tpl-link-btn:hover { text-decoration: underline; }
.tpl-primary { width: 100%; min-height: 50px; margin-top: 4px; border: 0; border-radius: 12px; background: var(--tpl-btn); color: #fff; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: background-color 160ms ease, transform 160ms cubic-bezier(0.23,1,0.32,1); }
.tpl-primary:active:not(:disabled) { transform: scale(0.98); }
.tpl-primary:hover:not(:disabled) { background: var(--tpl-btn-hover); }
.tpl-primary:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
.tpl-divider { display: flex; align-items: center; gap: 10px; color: var(--tpl-faint); font-size: 12px; font-weight: 600; }
.tpl-divider::before, .tpl-divider::after { content: ''; flex: 1; height: 1px; background: var(--tpl-card-border); }
.tpl-providers { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 8px; }
.tpl-provider { min-height: 44px; border-radius: 10px; border: 1px solid var(--tpl-input-border); background: var(--tpl-input); color: var(--tpl-text); font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; padding: 0 10px; }
.tpl-provider svg { flex-shrink: 0; }
.tpl-provider:hover:not(:disabled) { border-color: #16a34a; }
.tpl-provider:disabled { opacity: 0.6; cursor: not-allowed; }
.tpl-qr { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; margin-top: 16px; padding: 14px; border-radius: 14px; border: 1px solid var(--tpl-card-border); background: var(--tpl-seg); }
.tpl-qr-code img, .tpl-qr-placeholder { width: 96px; height: 96px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center; color: #475569; }
.tpl-qr-text h2 { margin: 0; font-size: 14px; font-weight: 800; color: var(--tpl-text); }
.tpl-qr-text p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--tpl-dim); }
.tpl-qr-status { margin-top: 4px; font-size: 12px; color: var(--tpl-text); min-height: 16px; }
.tpl-qr-status .tpl-muted { color: var(--tpl-faint); }
.tpl-qr-match { display: block; margin-top: 6px; }
.tpl-qr-match strong { font-size: 1.6rem; letter-spacing: .08em; font-variant-numeric: tabular-nums; }
.tpl-qr-btn { margin-top: 4px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-weight: 700; font-size: 13px; cursor: pointer; }
.tpl-qr-phone { color: var(--tpl-faint); }
.tpl-request { margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--tpl-dim); }
.tpl-request button { min-height: 44px; display: inline-flex; align-items: center; background: none; border: 0; padding: 0; color: var(--tpl-link); font-weight: 700; font-size: 13px; cursor: pointer; }
.tpl-request button:hover { text-decoration: underline; }
.tpl-footer { margin-top: 18px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tpl-footer nav { display: flex; flex-wrap: wrap; justify-content: center; }
.tpl-footer a { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; font-size: 12px; font-weight: 600; color: var(--tpl-dim); text-decoration: none; }
.tpl-footer a:hover { color: var(--tpl-text); text-decoration: underline; }
.tpl-footer small { font-size: 11px; color: var(--tpl-faint); }
.tpl-banner { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; font-size: 13px; line-height: 1.45; }
.tpl-banner.warn { color: var(--login-warn-text); background: rgba(234,179,8,0.10); border: 1px solid rgba(234,179,8,0.30); }
.tpl-banner.danger { color: var(--login-danger-text); background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.30); }
.tpl-net { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--tpl-dim); }
.tpl-net.off { color: var(--login-danger-text); }

.tpl-shell button:focus-visible, .tpl-shell a:focus-visible, .tpl-shell input:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }
html.light .tpl-side button:focus-visible, html.light .tpl-side a:focus-visible, html.light .tpl-side input:focus-visible { outline-color: #15803d; }
[dir="rtl"] .tpl-shell .tp-dir-icon { transform: scaleX(-1); }

@media (max-width: 480px) {
  .tpl-provider { gap: 6px; padding: 0 6px; font-size: 12.5px; }
  .tpl-qr { grid-template-columns: auto 1fr; }
  .tpl-qr-phone { display: none; }
}
@media (min-width: 640px) {
  .tpl-hero { padding: 22px 28px 26px; }
}
@media (min-width: 1024px) {
  .tpl-shell { grid-template-columns: minmax(0, 1.15fr) minmax(440px, 1fr); }
  .tpl-hero { padding: 32px 56px 0; min-height: 100vh; }
  .tpl-hero-body { margin-top: auto; margin-bottom: auto; padding-block: 48px 24px; }
  .tpl-title { font-size: clamp(2.6rem, 4.2vw, 4rem); max-width: 14ch; }
  .tpl-lead { display: block; }
  .tpl-pulse { display: block; }
  .tpl-stats { display: grid; }
  .tpl-hero-bg {
    display: block; position: relative; z-index: 0; width: 100%; max-width: 760px; height: auto;
    margin-inline: auto; margin-top: 8px; opacity: 0.9;
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 35%);
            mask-image: linear-gradient(180deg, transparent 0%, #000 35%);
    mix-blend-mode: luminosity;
  }
  .tpl-side { justify-content: center; padding: 32px 48px; min-height: 100vh; }
}
@media (prefers-reduced-motion: reduce) {
  .tpl-shell *, .tpl-shell *::before, .tpl-shell *::after { transition: none !important; animation-duration: 0.001ms !important; }
  .tpl-pulse path { animation: none; stroke-dashoffset: 0; }
}
`
