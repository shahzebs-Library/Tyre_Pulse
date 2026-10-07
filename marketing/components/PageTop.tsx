import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Inner-page opening: breadcrumb, title, one line of purpose, demo button. */
export function PageTop({ crumbs, title, lead, cta = true }: { crumbs: { href?: string; label: string }[]; title: string; lead: string; cta?: boolean }) {
  return (
    <section className="page-top">
      <div className="ptop-tyre" aria-hidden="true"><i /><b /></div>
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
        <div className="page-top-grid">
          <div>
            <h1 className="page-h1">{title}</h1>
            <p className="page-lead">{lead}</p>
          </div>
          {cta && <Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight className="cta-arrow" size={17} aria-hidden="true" /></Link>}
        </div>
      </div>
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
