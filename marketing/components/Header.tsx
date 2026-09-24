"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_URL } from "@/lib/site";
import { A11yStyles } from "./A11yStyles";

const links = [
  ["Product", "/product"],
  ["Industries", "/industries"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["Contact", "/contact"],
];

const MOBILE_NAV_ID = "mobile-nav";

export function Header() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Escape closes the mobile menu and returns focus to the control that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  /*
   * There is deliberately no skip link here. app/layout.tsx already renders one
   * site wide as the first focusable element, targeting #main-content, and every
   * page carries that id. A second "Skip to main content" link immediately after
   * it would be a duplicate, which is worse for a keyboard user than one link.
   */

  return (
    <div className="nav-wrap">
      <A11yStyles />
      <div className="site-shell">
        <header className="nav">
          <Link className="nav-logo" href="/" aria-label="Tyre Pulse home">
            {/* The link carries the name, so the image must not repeat it. */}
            <Image src="/brand/logo.png" alt="" width={360} height={116} priority />
          </Link>
          <nav className="nav-links" aria-label="Main">
            {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
            <Link href="/ar" lang="ar">العربية</Link>
          </nav>
          <div className="nav-actions">
            <a className="btn btn-secondary" href={APP_URL}>Login</a>
            <Link className="btn btn-primary" href="/contact">
              Book a demo <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <button
              ref={toggleRef}
              className="mobile-menu"
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls={MOBILE_NAV_ID}
              onClick={() => setOpen(!open)}
            >
              {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </header>
        {open && (
          <nav
            id={MOBILE_NAV_ID}
            className="card nav-mobile-panel"
            style={{ padding: 14, display: "grid", gap: 4, marginTop: 8 }}
            aria-label="Site"
          >
            {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
            <Link href="/ar" lang="ar" onClick={() => setOpen(false)}>العربية</Link>
            {/*
              The login button is hidden below 640px by globals.css and was not
              reachable anywhere else, so phone visitors had no way to sign in.
            */}
            <a href={APP_URL} onClick={() => setOpen(false)}>Login</a>
          </nav>
        )}
      </div>
    </div>
  );
}
