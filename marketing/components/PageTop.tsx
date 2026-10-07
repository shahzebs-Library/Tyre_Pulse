import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Photo, type PhotoKey } from "./art/Photos";
import { DETAILS_ANCHOR } from "@/lib/nav";

/**
 * Inner-page opening: breadcrumb, title, one line of purpose, demo button.
 * With a photo, it sits beside the text at exactly the text block's height (like the home
 * hero), and the demo button moves under the lead.
 */
export function PageTop({ crumbs, title, lead, cta = true, photo, photoPosition }: { crumbs: { href?: string; label: string }[]; title: string; lead: string; cta?: boolean; photo?: PhotoKey; photoPosition?: string }) {
  const button = cta && <Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight className="cta-arrow" size={17} aria-hidden="true" /></Link>;
  return (
    <section className={`page-top${photo ? " has-photo" : ""}`}>
      <div className="site-shell">
        <nav aria-label="Breadcrumb">
          <ol className="crumbs">
            {crumbs.map((c, i) => (
              <li key={c.label}>
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        {photo ? (
          <div className="ptop-split">
            <div className="ptop-copy">
              <h1 className="page-h1">{title}</h1>
              <p className="page-lead">{lead}</p>
              {button && <div className="ptop-cta">{button}</div>}
            </div>
            <div className="ptop-photo">
              <Photo name={photo} position={photoPosition} priority sizes="(max-width: 900px) 100vw, 45vw" />
            </div>
          </div>
        ) : (
          <div className="page-top-grid">
            <div>
              <h1 className="page-h1">{title}</h1>
              <p className="page-lead">{lead}</p>
            </div>
            {button}
          </div>
        )}
      </div>
      {/* Menu links land here: the first line of the module details, just under the header. */}
      <span id={DETAILS_ANCHOR} className="ptop-anchor" aria-hidden="true" />
    </section>
  );
}

/** In-page section links styled as the mockups' sub-tabs. */
export function SubNav({ items }: { items: [string, string][] }) {
  return (
    <nav className="subnav" aria-label="On this page">
      {items.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
    </nav>
  );
}
