import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** The yellow closing band every page ends on, as in the approved mockups. */
export function CtaBand({ title, text, button = "Book a demo" }: { title: string; text: string; button?: string }) {
  return (
    <section className="cta-band" aria-labelledby="cta-band-h">
      <div className="site-shell cta-band-inner">
        <div>
          <h2 id="cta-band-h">{title}</h2>
          <p>{text}</p>
        </div>
        <Link className="btn btn-dark" href="/contact">{button} <ArrowRight className="cta-arrow" size={17} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
