import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * This is a sales call to action, not a download or a signup, so it carries no
 * app store badge. Putting "Get it on Google Play" beside "Book a demo" would
 * offer a field inspector's tool to a buyer evaluating the platform. The store
 * badges live in the footer, where they reach every page without competing with
 * the demo request.
 */
export function CTA() {
  return (
    <section className="section-tight" aria-labelledby="cta-heading">
      <div className="site-shell">
        <div className="cta card">
          <div>
            <span
              className="eyebrow"
              style={{ background: "rgba(255,255,255,.08)", color: "#9fe8bd", borderColor: "rgba(255,255,255,.15)" }}
            >
              Ready for controlled growth
            </span>
            <h2 className="h2" id="cta-heading" style={{ maxWidth: 680 }}>
              See how Tyre Pulse fits your fleet, sites and approval structure.
            </h2>
            <p>Book a focused walkthrough using your real operating model, not a generic sales demo.</p>
          </div>
          <Link className="btn btn-primary" href="/contact">
            Book a demo <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
