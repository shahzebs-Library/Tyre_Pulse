/**
 * Mobile app availability.
 *
 * Verified facts, and the reason this component is shaped the way it is:
 *  - The Android app is live in Google Play Production. The Play listing shows
 *    it as "Tyre Pulse Inspector", which is the spelling used in any visible
 *    label here. The build-time name in mobile/app.json differs and is not what
 *    a visitor lands on.
 *  - There is NO iOS app and no App Store listing. iOS therefore renders as
 *    plain, non-interactive text. It is deliberately not a link, not a button
 *    and not a disabled control, because every one of those invites a click that
 *    can only fail.
 *
 * The badge is built from the site's own button language rather than Google's
 * official Play artwork. That artwork carries brand rules we should not guess
 * at, and text in markup is readable by search engines and screen readers in a
 * way that an image of text is not.
 */
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.shahzebrahman.tyrepulseinspector";
const ANDROID_APP_NAME = "Tyre Pulse Inspector";

const css = `
.store-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 10px;
}
.store-badge {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  margin: 0;
  min-height: 52px;
  min-width: 44px;
  padding: 8px 18px;
  border-radius: 14px;
  border: 1px solid transparent;
  text-align: left;
  transition: transform .2s ease, background .2s ease, border-color .2s ease;
}
.store-badge-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.store-badge-kicker {
  font-size: .68rem;
  letter-spacing: .09em;
  text-transform: uppercase;
  font-weight: 700;
}
.store-badge-name {
  font-size: 1.02rem;
  font-weight: 800;
  letter-spacing: -.01em;
}
.store-badge svg {
  flex: 0 0 auto;
}

/* Available: a real link. */
.store-badge-link:hover {
  transform: translateY(-2px);
}

/* On the dark footer and the dark call to action panel. */
.store-badges-on-dark .store-badge-link {
  background: rgba(255, 255, 255, .1);
  border-color: rgba(255, 255, 255, .28);
  color: #ffffff;
}
.store-badges-on-dark .store-badge-link:hover {
  background: rgba(255, 255, 255, .18);
  border-color: rgba(255, 255, 255, .45);
}
.store-badges-on-dark .store-badge-kicker {
  color: #c2d2e4;
}
.store-badges-on-dark .store-badge-pending {
  border-color: rgba(255, 255, 255, .16);
  border-style: dashed;
  background: rgba(255, 255, 255, .04);
  color: #b3c2d4;
}
.store-badges-on-dark .store-badge-pending .store-badge-kicker {
  color: #93a5ba;
}

/* On the light page surfaces. */
.store-badges-on-light .store-badge-link {
  background: var(--navy, #06170f);
  border-color: var(--navy, #06170f);
  color: #ffffff;
}
.store-badges-on-light .store-badge-link:hover {
  background: #0d2745;
  border-color: #0d2745;
}
.store-badges-on-light .store-badge-link .store-badge-kicker {
  color: #c2d2e4;
}
.store-badges-on-light .store-badge-pending {
  border-color: var(--line, #dae7df);
  border-style: dashed;
  background: rgba(255, 255, 255, .6);
  color: var(--muted, #5c6f63);
}
.store-badges-on-light .store-badge-pending .store-badge-kicker {
  color: inherit;
}

/*
 * The pending state is not a control. Cursor and pointer events say so, and the
 * dashed border plus the word "Coming soon" carry the meaning without relying
 * on colour alone.
 */
.store-badge-pending {
  cursor: default;
}
`;

export type StoreBadgesProps = {
  /** "dark" for the footer and the call to action panel, "light" for page surfaces. */
  tone?: "dark" | "light";
  /** Set to false to leave the iOS row out completely rather than show it as pending. */
  showIos?: boolean;
  /**
   * The App Store listing, once one exists. Null renders the honest "coming
   * soon" state; a real URL renders a working link that is a peer of the Google
   * Play button. Pass the APP_STORE_URL constant from app/schema.tsx so turning
   * iOS on is a single edit in one place.
   */
  appStoreUrl?: string | null;
  className?: string;
};

/**
 * Only an absolute https URL is treated as a live listing. An empty string, a
 * placeholder or a relative path renders as "coming soon" instead of shipping a
 * link that cannot work, which is the failure this component exists to avoid.
 */
function isLiveListing(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("https://");
}

function PlayGlyph() {
  // Authored here rather than taken from Google's badge artwork.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 3.4v17.2c0 .78.85 1.26 1.52.86l14-8.6a1 1 0 0 0 0-1.72l-14-8.6A1 1 0 0 0 5 3.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeviceGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6" y="2.5" width="12" height="19" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <line x1="10.4" y1="18.6" x2="13.6" y2="18.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A live listing. The accessible name is composed from the visible text plus a
 * hidden tail rather than an aria-label, so the name still contains the words on
 * screen, which is what 2.5.3 Label in Name asks for, while naming the app and
 * warning that the link opens a new tab.
 */
function StoreLink({
  href,
  kicker,
  name,
  glyph,
  appName,
}: {
  href: string;
  kicker: string;
  name: string;
  glyph: React.ReactNode;
  /** Only stated when the listing name is known. The iOS listing name is not. */
  appName?: string;
}) {
  return (
    <a className="store-badge store-badge-link" href={href} target="_blank" rel="noopener noreferrer">
      {glyph}
      <span className="store-badge-text">
        <span className="store-badge-kicker">{kicker}</span>
        <span className="store-badge-name">{name}</span>
      </span>
      <span className="sr-only">{appName ? `, ${appName}` : ""}, opens in a new tab</span>
    </a>
  );
}

export function StoreBadges({ tone = "dark", showIos = true, appStoreUrl = null, className }: StoreBadgesProps) {
  const toneClass = tone === "light" ? "store-badges-on-light" : "store-badges-on-dark";

  return (
    <>
      <style href="tyrepulse-store-badges" precedence="high">
        {css}
      </style>
      <div className={["store-badges", toneClass, className].filter(Boolean).join(" ")}>
        <StoreLink
          href={PLAY_URL}
          kicker="Get it on"
          name="Google Play"
          glyph={<PlayGlyph />}
          appName={ANDROID_APP_NAME}
        />

        {showIos && (isLiveListing(appStoreUrl) ? (
          <StoreLink
            href={appStoreUrl}
            kicker="Download on the"
            name="App Store"
            glyph={<DeviceGlyph />}
          />
        ) : (
          /*
            Not a link, not a button, not a disabled control. A control that can
            only fail invites a click and then refuses it. Plain text states the
            position honestly and is read as text.

            The dashed border, the muted treatment and the words "Coming soon"
            each carry the meaning on their own, so nothing rests on colour.
          */
          <p className="store-badge store-badge-pending">
            <DeviceGlyph />
            <span className="store-badge-text">
              <span className="store-badge-kicker">Coming soon</span>
              <span className="store-badge-name">iOS app</span>
            </span>
          </p>
        ))}
      </div>
    </>
  );
}
