import Link from "next/link";
import { APP_STORE_URL } from "@/app/schema";
import { APP_URL } from "@/lib/site";
import { PLATFORM_PAGES } from "@/lib/nav";
import { Logo } from "./Logo";
import { StoreBadges } from "./StoreBadges";

export function Footer() {
  return (
    <footer className="footer">
      <div className="site-shell">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="footer-text">
              One operational workspace for plant, machinery and vehicles: assets, workshop, field teams and stores.
            </p>
            <h2 className="footer-heading">Mobile app</h2>
            <p className="footer-text">Inspections, meter readings and job cards from the yard, online or offline.</p>
            <StoreBadges tone="dark" appStoreUrl={APP_STORE_URL} />
          </div>
          <nav aria-labelledby="footer-platform">
            <h2 className="footer-heading" id="footer-platform">Platform</h2>
            <div className="footer-links">
              {PLATFORM_PAGES.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
            </div>
          </nav>
          <nav aria-labelledby="footer-company">
            <h2 className="footer-heading" id="footer-company">Company</h2>
            <div className="footer-links">
              <Link href="/industries">Industries</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/security">Security</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/ar" lang="ar">العربية</Link>
            </div>
          </nav>
          <nav aria-labelledby="footer-access">
            <h2 className="footer-heading" id="footer-access">Access</h2>
            <div className="footer-links">
              <a href={APP_URL}>Customer login</a>
              <span className="footer-note">Company administration is inside the app.</span>
            </div>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>&copy; {new Date().getFullYear()} Tyre Pulse. All rights reserved.</span>
          <span>Product screens on this site show illustrative sample data. Module availability depends on your plan.</span>
        </div>
      </div>
    </footer>
  );
}
