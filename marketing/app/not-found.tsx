import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { PLATFORM_PAGES } from "@/lib/nav";

// A missing page must not claim to be the home page, so no canonical, and it must not be indexed.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <PageFrame>
      <section className="nf">
        <div className="site-shell">
          <p className="nf-code">404 &middot; Page not found</p>
          <h1 className="page-h1">This page is not here.</h1>
          <p className="lead">The link may be old, or the page may have moved. These are the pages people usually look for.</p>
          <ul className="nf-links">
            <li><Link href="/">Home</Link></li>
            {PLATFORM_PAGES.map((p) => <li key={p.href}><Link href={p.href}>{p.label}</Link></li>)}
            <li><Link href="/pricing">Pricing</Link></li>
            <li><Link href="/contact">Book a demo</Link></li>
          </ul>
        </div>
      </section>
    </PageFrame>
  );
}
