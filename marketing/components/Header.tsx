"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_URL } from "@/lib/site";
import { PLATFORM_PAGES, RESOURCE_PAGES, SOLUTION_PAGES } from "@/lib/nav";
import { A11yStyles } from "./A11yStyles";
import { Logo } from "./Logo";

const MENUS = [
  { id: "platform", label: "Platform", items: PLATFORM_PAGES },
  { id: "solutions", label: "Solutions", items: SOLUTION_PAGES },
  { id: "resources", label: "Resources", items: RESOURCE_PAGES },
] as const;

export function Header() {
  const pathname = usePathname();
  const [menu, setMenu] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeAll = useCallback(() => { setMenu(null); setMobile(false); }, []);

  // Escape closes and returns focus; a click outside the bar closes.
  useEffect(() => {
    if (!menu && !mobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) (document.getElementById(`menu-btn-${menu}`) as HTMLButtonElement | null)?.focus();
      else toggleRef.current?.focus();
      closeAll();
    };
    const onDown = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) closeAll(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [menu, mobile, closeAll]);

  return (
    <div className="topbar" ref={barRef}>
      <A11yStyles />
      <div className="site-shell topbar-inner">
        <Link className="topbar-logo" href="/" aria-label="Tyre Pulse home"><Logo /></Link>
        <nav className="topnav" aria-label="Main">
          {MENUS.map((m) => (
            <div className="topnav-item" key={m.id}>
              <button
                id={`menu-btn-${m.id}`}
                type="button"
                aria-expanded={menu === m.id}
                aria-controls={`menu-${m.id}`}
                onClick={() => setMenu(menu === m.id ? null : m.id)}
              >
                {m.label} <ChevronDown size={14} aria-hidden="true" />
              </button>
              {menu === m.id && (
                <div className="dropdown" id={`menu-${m.id}`}>
                  {m.items.map((it) => (
                    <Link key={it.href} href={it.href} onClick={closeAll} aria-current={pathname === it.href ? "page" : undefined}>
                      <b>{it.label}</b><span>{it.text}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="lang">
            {pathname === "/ar"
              ? <><Link href="/" lang="en">EN</Link><span aria-hidden="true">|</span><span aria-current="true" lang="ar">العربية</span></>
              : <><span aria-current="true">EN</span><span aria-hidden="true">|</span><Link href="/ar" lang="ar">العربية</Link></>}
          </span>
          <a className="topbar-login" href={APP_URL}>Log in</a>
          <Link className="btn btn-primary btn-sm" href="/contact">Book a demo</Link>
          <button
            ref={toggleRef}
            className="mobile-menu"
            type="button"
            aria-label={mobile ? "Close menu" : "Open menu"}
            aria-expanded={mobile}
            aria-controls="mobile-nav"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      {mobile && (
        <nav id="mobile-nav" className="mobile-panel" aria-label="Site">
          <div className="site-shell">
            {MENUS.map((m) => (
              <div key={m.id} className="mobile-group">
                <span className="mobile-group-h">{m.label}</span>
                {m.items.map((it) => <Link key={it.href} href={it.href} onClick={closeAll}>{it.label}</Link>)}
              </div>
            ))}
            <div className="mobile-group">
              <a href={APP_URL}>Log in</a>
              <Link href="/ar" lang="ar" onClick={closeAll}>العربية</Link>
            </div>
          </div>
        </nav>
      )}
    </div>
  );
}
