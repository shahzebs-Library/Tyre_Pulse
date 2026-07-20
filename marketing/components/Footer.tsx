import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <div className="site-shell">
        <div className="footer-grid">
          <div>
            <Image src="/brand/logo.png" alt="Tyre Pulse" width={250} height={80} style={{ filter: "brightness(0) invert(1)", opacity: .94 }} />
            <p style={{ maxWidth: 380, color: "#9fb0c4" }}>Tyre, fleet, inspection and workshop intelligence for teams that need control across sites, countries and asset types.</p>
          </div>
          <div><h4>Platform</h4><div className="footer-links"><Link href="/product">Product</Link><Link href="/industries">Industries</Link><Link href="/pricing">Pricing</Link><Link href="/security">Security</Link></div></div>
          <div><h4>Company</h4><div className="footer-links"><Link href="/contact">Book a demo</Link><Link href="/contact">Contact sales</Link><Link href="/ar">Arabic</Link></div></div>
          <div><h4>Access</h4><div className="footer-links"><a href="https://app.tyrepulse.app">Customer login</a><a href="https://admin.tyrepulse.app">Company admin</a><span>Owner console</span></div></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} Tyre Pulse. All rights reserved.</span><span>Smarter Wheels. Stronger Fleet.</span></div>
      </div>
    </footer>
  );
}
