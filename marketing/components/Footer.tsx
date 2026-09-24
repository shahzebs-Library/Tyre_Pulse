import Image from "next/image";
import Link from "next/link";
import { APP_STORE_URL } from "@/app/schema";
import { APP_URL } from "@/lib/site";
import { StoreBadges } from "./StoreBadges";

export function Footer() {
  return (
    <footer className="footer">
      <div className="site-shell">
        <div className="footer-grid">
          <div>
            <Image
              src="/brand/logo.png"
              alt="Tyre Pulse"
              width={250}
              height={80}
              style={{ filter: "brightness(0) invert(1)", opacity: .94 }}
            />
            <p style={{ maxWidth: 380, color: "#9fb0c4" }}>
              Tyre, fleet, inspection and workshop intelligence for teams that need control across sites,
              countries and asset types.
            </p>
            {/*
              Headings here are h2 rather than h4. The page above ends on h2, so
              h4 skipped a level and broke the document outline for anyone
              navigating by heading. The footer-heading class reproduces the old
              look exactly.
            */}
            <h2 className="footer-heading" style={{ marginTop: 26 }}>Mobile app</h2>
            <p style={{ maxWidth: 380, color: "#9fb0c4", marginTop: 0 }}>
              Field inspections, tyre checks and job cards from the yard, online or offline.
            </p>
            {/*
              APP_STORE_URL is null until a real App Store listing exists. Setting
              it in app/schema.tsx turns the iOS link on here and in the structured
              data at the same time, with no further change.
            */}
            <StoreBadges tone="dark" appStoreUrl={APP_STORE_URL} />
          </div>
          <nav aria-labelledby="footer-platform">
            <h2 className="footer-heading" id="footer-platform">Platform</h2>
            <div className="footer-links">
              <Link href="/product">Product</Link>
              <Link href="/industries">Industries</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/security">Security</Link>
            </div>
          </nav>
          <nav aria-labelledby="footer-company">
            <h2 className="footer-heading" id="footer-company">Company</h2>
            <div className="footer-links">
              <Link href="/contact">Book a demo</Link>
              <Link href="/contact">Contact sales</Link>
              <Link href="/ar" lang="ar">Arabic</Link>
            </div>
          </nav>
          <nav aria-labelledby="footer-access">
            <h2 className="footer-heading" id="footer-access">Access</h2>
            <div className="footer-links">
              <a href={APP_URL}>Customer login</a>
              {/*
                Company administration and the owner console are deliberately
                not links.

                admin.tyrepulse.app was linked here and does not exist: no
                Vercel project holds that name, so the link resolved to a DNS
                error. Neither destination is a separate public site in any
                case. Company administration lives inside the application, and
                the platform owner console is reached only by typing its path
                into its own tab, which is a rule the product enforces on
                purpose so no page ever offers a way in.

                Stated as text rather than shown as a disabled control, because
                a control that can only fail invites a click and then refuses
                it.
              */}
              <span className="footer-note">Company administration, inside the app</span>
              <span className="footer-note">Owner console, by direct address</span>
            </div>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>&copy; {new Date().getFullYear()} Tyre Pulse. All rights reserved.</span>
          <span>Smarter Wheels. Stronger Fleet.</span>
        </div>
      </div>
    </footer>
  );
}
