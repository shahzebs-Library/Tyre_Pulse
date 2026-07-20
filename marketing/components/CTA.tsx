import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CTA() {
  return <section className="section-tight"><div className="site-shell"><div className="cta card"><div><span className="eyebrow" style={{ background: "rgba(255,255,255,.08)", color: "#9ecbff", borderColor: "rgba(255,255,255,.15)" }}>Ready for controlled growth</span><h2 className="h2" style={{ maxWidth: 680 }}>See how Tyre Pulse fits your fleet, sites and approval structure.</h2><p>Book a focused walkthrough using your real operating model, not a generic sales demo.</p></div><Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight size={18} /></Link></div></div></section>;
}
