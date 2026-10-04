/**
 * Sign-in page styles. The hero is a dark photo band in BOTH themes; the
 * sign-in panel and card flip with `html.light`. The card re-points the
 * shared --login-* tokens so the existing forgot / sign-up / pending markup
 * inherits the new palette without being rewritten.
 * Contrast: every text token below is >= 4.5:1 on its own surface.
 */
export const LOGIN_PAGE_CSS = `
.tpl-shell {
  --tpl-green: #4ade80;
  --tpl-btn: #15803d;
  --tpl-btn-hover: #166534;
  --tpl-panel-bg: #08101c;
  --tpl-card: #0f1a2b;
  --tpl-card-border: #22324a;
  --tpl-text: #eef3f9;
  --tpl-dim: #b3c0d1;
  --tpl-faint: #93a3b8;
  --tpl-input: #0a1322;
  --tpl-input-border: #2d405c;
  --tpl-seg: #0a1322;
  --tpl-link: #4ade80;
  min-height: 100vh; display: grid; grid-template-columns: 1fr;
  background: var(--tpl-panel-bg);
}
html.light .tpl-shell {
  --tpl-panel-bg: #eef2f0;
  --tpl-card: #ffffff;
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

/* ── Hero (always dark) ─────────────────────────────────── */
.tpl-hero {
  position: relative; overflow: hidden; color: #fff;
  background: radial-gradient(ellipse 70% 60% at 15% 10%, rgba(22,163,74,0.20), transparent 60%), #07110c;
  padding: 18px 16px 24px;
  display: flex; flex-direction: column;
}
.tpl-hero-bg {
  position: absolute; inset-inline: 0; bottom: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: center bottom; opacity: 0.55; pointer-events: none;
}
.tpl-hero-shade {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(5,12,8,0.96) 0%, rgba(5,12,8,0.88) 45%, rgba(5,12,8,0.72) 100%);
}
.tpl-top, .tpl-hero-body { position: relative; z-index: 1; }
.tpl-top { display: flex; align-items: center; gap: 16px; }
.tpl-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tpl-emblem {
  width: 44px; height: 44px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #12301e, #04100a); box-shadow: 0 0 0 2px rgba(74,222,128,0.45), 0 0 22px rgba(22,163,74,0.35);
}
.tpl-brand-text { display: flex; flex-direction: column; line-height: 1.05; }
.tpl-wordmark { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #fff; }
.tpl-wordmark { direction: ltr; unicode-bidi: isolate; }
.tpl-wordmark::before { content: attr(data-a); }
.tpl-wordmark::after { content: attr(data-b); color: #4ade80; }
.tpl-card-brand .tpl-wordmark { font-size: 16px; color: var(--tpl-text); }
.tpl-card-brand .tpl-wordmark::after { color: var(--tpl-link); }
.tpl-brand-sub { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #c7d2cc; margin-top: 3px; }
.tpl-nav { display: none; gap: 4px; margin-inline-start: auto; }
.tpl-nav a { color: #e5ece8; font-size: 13px; font-weight: 600; text-decoration: none; padding: 12px 10px; border-radius: 8px; }
.tpl-nav a:hover { color: #fff; background: rgba(255,255,255,0.08); }
.tpl-lang { display: inline-flex; margin-inline-start: auto; border: 1px solid rgba(255,255,255,0.22); border-radius: 10px; padding: 2px; background: rgba(0,0,0,0.25); }
.tpl-lang button { min-width: 44px; min-height: 40px; border: 0; border-radius: 8px; background: transparent; color: #e5ece8; font-size: 12px; font-weight: 800; cursor: pointer; }
.tpl-lang button[aria-pressed="true"] { background: #15803d; color: #fff; }
.tpl-hero-body { margin-top: 18px; }
.tpl-eyebrow { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #86efac; }
.tpl-title { margin: 8px 0 0; font-size: clamp(1.5rem, 6.4vw, 2rem); line-height: 1.15; font-weight: 800; letter-spacing: -0.025em; color: #fff; }
.tpl-title span { color: #4ade80; }
.tpl-lead { margin: 10px 0 0; font-size: 14px; line-height: 1.6; color: #d4ddd8; max-width: 640px; }
.tpl-industries, .tpl-mid, .tpl-caps, .tpl-caps-h { display: none; }
.tpl-muted { color: #b8c4be; font-size: 12px; }
.tpl-mini-h { margin: 0 0 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #c7d2cc; }

.tpl-industries { list-style: none; margin: 22px 0 0; padding: 0; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
.tpl-ind { position: relative; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.tpl-ind img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; background: #fff; }
.tpl-ind-body { padding: 8px 9px 10px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tpl-ind-icon { position: absolute; inset-inline-start: 8px; top: 8px; width: 26px; height: 26px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: rgba(4,16,9,0.85); color: #4ade80; border: 1px solid rgba(74,222,128,0.4); }
.tpl-ind-title { display: block; font-size: 12px; font-weight: 800; color: #fff; line-height: 1.25; }
.tpl-ind-sub { font-size: 11px; line-height: 1.35; color: #c9d3ce; }

.tpl-mid { margin-top: 16px; grid-template-columns: minmax(0, 0.9fr) minmax(0, 2fr); gap: 12px; }
.tpl-countries, .tpl-stats { background: rgba(4,10,7,0.72); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 14px 16px; backdrop-filter: blur(6px); }
.tpl-countries ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.tpl-countries li { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #fff; }
.tpl-countries li svg { color: #4ade80; flex-shrink: 0; }
.tpl-stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; align-items: center; }
.tpl-stat { display: flex; flex-direction: column; gap: 3px; padding-inline: 8px; border-inline-start: 1px solid rgba(255,255,255,0.12); min-width: 0; }
.tpl-stat:first-of-type { border-inline-start: 0; }
.tpl-stat svg { color: #4ade80; }
.tpl-stat-num { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #fff; font-variant-numeric: tabular-nums; }
.tpl-stat-label { font-size: 12px; color: #c9d3ce; font-weight: 600; }

.tpl-caps-h { margin-top: 18px; }
.tpl-caps { list-style: none; margin: 0; padding: 0; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
.tpl-caps li { background: rgba(4,10,7,0.72); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 11px 12px; display: grid; grid-template-columns: auto 1fr; column-gap: 9px; row-gap: 2px; align-items: center; }
.tpl-cap-icon { grid-row: span 2; width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: rgba(22,163,74,0.2); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); }
.tpl-cap-title { font-size: 12.5px; font-weight: 800; color: #fff; }
.tpl-cap-sub { font-size: 11px; color: #c9d3ce; line-height: 1.35; }

/* ── Sign-in side ───────────────────────────────────────── */
.tpl-side { display: flex; flex-direction: column; align-items: center; padding: 20px 16px 28px; background: var(--tpl-panel-bg); min-width: 0; }
.tpl-card { width: 100%; max-width: 440px; background: var(--tpl-card); border: 1px solid var(--tpl-card-border); border-radius: 20px; padding: 22px 20px 24px; box-shadow: 0 24px 60px rgba(2,6,23,0.28); color: var(--tpl-text); }
html.light .tpl-card { box-shadow: 0 18px 50px rgba(15,23,42,0.10); }
.tpl-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.tpl-card-brand { display: none; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; color: var(--tpl-text); }
.tpl-card-brand .tpl-emblem { width: 36px; height: 36px; }
.tpl-theme { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 999px; border: 1px solid var(--tpl-card-border); background: var(--tpl-seg); color: var(--tpl-text); }
.tpl-theme button { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
.tpl-welcome { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--tpl-text); }
.tpl-welcome-sub { margin: 6px 0 16px; font-size: 13.5px; line-height: 1.55; color: var(--tpl-dim); }
.tpl-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--tpl-seg); border: 1px solid var(--tpl-card-border); margin-bottom: 18px; }
.tpl-seg button { min-height: 44px; border: 0; border-radius: 9px; background: transparent; color: var(--tpl-dim); font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px; }
.tpl-seg button[aria-pressed="true"] { background: #15803d; color: #fff; box-shadow: 0 4px 14px rgba(21,128,61,0.35); }
.tpl-seg button:not([aria-pressed="true"]):hover { color: var(--tpl-text); }
.tpl-field-icon { position: absolute; inset-inline-start: 13px; top: 50%; transform: translateY(-50%); pointer-events: none; display: flex; }
.tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tpl-check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; color: var(--tpl-dim); cursor: pointer; }
.tpl-check input { width: 18px; height: 18px; accent-color: #15803d; }
.tpl-link-btn { min-height: 44px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-size: 13px; font-weight: 700; cursor: pointer; }
.tpl-link-btn:hover { text-decoration: underline; }
.tpl-primary { width: 100%; min-height: 48px; border: 0; border-radius: 12px; background: var(--tpl-btn); color: #fff; font-size: 15px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 8px 22px rgba(21,128,61,0.35); transition: background 0.15s; }
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
.tpl-qr-btn { margin-top: 4px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; color: var(--tpl-link); font-weight: 700; font-size: 13px; cursor: pointer; }
.tpl-qr-phone { color: var(--tpl-faint); }
.tpl-request { margin-top: 16px; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--tpl-input-border); display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--tpl-dim); }
.tpl-request button { min-height: 44px; display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; color: var(--tpl-link); font-weight: 800; font-size: 13px; cursor: pointer; }
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
  .tpl-seg button { font-size: 12px; }
}
@media (min-width: 640px) {
  .tpl-hero { padding: 22px 28px 28px; }
  .tpl-industries { display: grid; }
}
@media (min-width: 1024px) {
  .tpl-shell { grid-template-columns: minmax(0, 1fr) clamp(420px, 36vw, 540px); }
  .tpl-hero { padding: 26px 36px 32px; min-height: 100vh; }
  .tpl-hero-shade { background: linear-gradient(180deg, rgba(5,12,8,0.95) 0%, rgba(5,12,8,0.86) 52%, rgba(5,12,8,0.55) 100%); }
  .tpl-hero-bg { height: 46%; top: auto; opacity: 0.85; }
  .tpl-nav { display: flex; }
  .tpl-lang { margin-inline-start: 6px; }
  .tpl-hero-body { margin-top: 30px; }
  .tpl-title { font-size: clamp(1.9rem, 2.6vw, 2.7rem); max-width: 760px; }
  .tpl-lead { font-size: 15px; }
  .tpl-industries { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .tpl-mid { display: grid; }
  .tpl-caps, .tpl-caps-h { display: grid; }
  .tpl-caps-h { display: block; }
  .tpl-side { justify-content: center; padding: 28px 28px; min-height: 100vh; }
  .tpl-card-brand { display: flex; }
  .tpl-card { padding: 26px 28px 26px; }
}
@media (min-width: 1360px) {
  .tpl-industries { grid-template-columns: repeat(7, minmax(0,1fr)); }
  .tpl-caps { grid-template-columns: repeat(6, minmax(0,1fr)); }
  .tpl-caps li { grid-template-columns: 1fr; }
  .tpl-cap-icon { grid-row: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .tpl-shell *, .tpl-shell *::before, .tpl-shell *::after { transition: none !important; animation-duration: 0.001ms !important; }
}
`
