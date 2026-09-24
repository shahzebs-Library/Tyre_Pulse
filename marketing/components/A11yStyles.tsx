/**
 * Shared accessibility styles for the marketing site.
 *
 * These live in a component rather than app/globals.css so that the style sheet
 * ships with the components that depend on it. React hoists a <style> that
 * carries an href and a precedence into <head> and de-duplicates it, so this may
 * be rendered from more than one component without emitting the rules twice.
 *
 * Every rule here is additive. Nothing overrides a colour or a layout decision
 * from globals.css except where the existing value fails a WCAG 2.2 AA
 * requirement (target size and focus visibility).
 */
const css = `
/* Content that must reach assistive technology but not the screen. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/*
 * 2.4.7 Focus Visible. globals.css never removes an outline, but the browser
 * default is a single thin ring that disappears against the navy footer and the
 * blue primary button. A two-tone ring always presents at least one boundary of
 * 3:1 or better whatever it sits on: white against the dark surfaces, brand blue
 * against the light ones.
 */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[tabindex]:focus-visible {
  outline: 3px solid var(--brand, #15803d);
  outline-offset: 2px;
  box-shadow: 0 0 0 5px rgba(255, 255, 255, .95);
}
/*
 * The skip link in app/layout.tsx paints its own ring against the navy pill, so
 * the halo is dropped there rather than doubled up. Main is only ever focused
 * programmatically, so it needs no visible ring of its own.
 */
.skip-link:focus-visible,
.skip-link:focus {
  box-shadow: none;
}
#main:focus,
#main:focus-visible {
  outline: none;
  box-shadow: none;
}

/*
 * 2.5.8 Target Size (Minimum). Navigation and footer links were roughly 22px
 * tall. These give every one of them a 44px target without changing the height
 * of the navigation bar, which already stands at 68px.
 */
.nav-links a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.mobile-menu {
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: var(--ink, #071710);
}
.nav-mobile-panel a {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 10px;
  font-weight: 650;
}
.nav-mobile-panel a:hover {
  background: rgba(21, 128, 61, .08);
}

/*
 * Footer link groups. The gap is removed and folded into each row so the list
 * keeps a similar overall height while every link gains a 44px target.
 *
 * The selector is deliberately over-qualified. React hoists this sheet into head
 * without guaranteeing it lands after the Next.js stylesheet link, so a rule
 * that merely ties with globals.css on specificity would lose. Winning on
 * specificity instead makes the outcome independent of source order.
 */
.footer .footer-links {
  gap: 0;
}
.footer .footer-links a,
.footer .footer-links .footer-note {
  display: flex;
  align-items: center;
  min-height: 44px;
}
/*
 * 1.4.1 Use of Colour. Footer links carry no underline and no colour difference
 * from the plain text beside them, so nothing identified them as links. An
 * underline on hover and on focus is the non-colour signal.
 */
.footer .footer-links a:hover,
.footer .footer-links a:focus-visible {
  text-decoration: underline;
  color: #ffffff;
}
/* A heading that reads as the existing footer h4 but keeps the document order valid. */
.footer-heading {
  margin: 0 0 14px;
  color: #ffffff;
  font-size: 1.05rem;
  line-height: 1.3;
  font-weight: 750;
  letter-spacing: normal;
}
/* Plain text sitting inside a list of links must not look like one. */
.footer-note {
  color: #8799ae;
  cursor: default;
}
`;

export function A11yStyles() {
  return (
    <style href="tyrepulse-a11y" precedence="high">
      {css}
    </style>
  );
}
