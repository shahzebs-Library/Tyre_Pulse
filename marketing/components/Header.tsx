"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, ArrowUpRight } from "lucide-react";
import { useState } from "react";

const links = [
  ["Product", "/product"],
  ["Industries", "/industries"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["Contact", "/contact"],
];

export function Header() {
  const [open, setOpen] = useState(false);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.tyrepulse.app";

  return (
    <div className="nav-wrap">
      <div className="site-shell">
        <header className="nav">
          <Link className="nav-logo" href="/" aria-label="Tyre Pulse home">
            <Image src="/brand/logo.png" alt="Tyre Pulse" width={360} height={116} priority />
          </Link>
          <nav className="nav-links" aria-label="Main navigation">
            {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
            <Link href="/ar">العربية</Link>
          </nav>
          <div className="nav-actions">
            <a className="btn btn-secondary" href={appUrl}>Login</a>
            <Link className="btn btn-primary" href="/contact">Book a demo <ArrowUpRight size={17} /></Link>
            <button className="mobile-menu" type="button" aria-label="Open menu" onClick={() => setOpen(!open)}><Menu /></button>
          </div>
        </header>
        {open && (
          <nav className="card" style={{ padding: 14, display: "grid", gap: 8, marginTop: 8 }} aria-label="Mobile navigation">
            {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
            <Link href="/ar" onClick={() => setOpen(false)}>العربية</Link>
          </nav>
        )}
      </div>
    </div>
  );
}
