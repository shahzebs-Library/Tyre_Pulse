"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeDollarSign, Box, Building2, ChevronDown, CircleDot, ClipboardCheck, FileSpreadsheet, LayoutGrid, Mail, PlayCircle, ShieldCheck, Truck, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_URL } from "@/lib/site";
import { MENU_GROUPS } from "@/lib/nav";
import { A11yStyles } from "./A11yStyles";
import { Logo } from "./Logo";

const MENUS = MENU_GROUPS;

/** One icon per menu entry, keyed by its link. */
const ICONS: Record<string, typeof Truck> = {
  "/platform": LayoutGrid, "/platform/fleet-assets": Truck, "/platform/maintenance": Wrench, "/platform/inspections": ClipboardCheck,
  "/platform/inventory": Box, "/solutions/tyre-management": CircleDot, "/solutions/ready-mix-fleet": Truck, "/solutions/spreadsheets-to-platform": FileSpreadsheet, "/industries": Building2, "/pricing": BadgeDollarSign, "/platform#tours": PlayCircle, "/security": ShieldCheck, "/contact": Mail,
};

/** Header copy per locale. The Arabic page links to the English pages, which are the only other locale. */
const COPY = {
  en: { home: "Tyre Pulse home", main: "Main", login: "Log in", demo: "Book a demo", open: "Open menu", close: "Close menu", site: "Site" },
  ar: { home: "الصفحة الرئيسية لتاير بالس", main: "القائمة الرئيسية", login: "تسجيل الدخول", demo: "احجز عرضاً", open: "فتح القائمة", close: "إغلاق القائمة", site: "الموقع" },
} as const;

export function Header({ locale = "en" }: { locale?: "en" | "ar" }) {
  const ar = locale === "ar";
  const c = COPY[locale];
  const pathname = usePathname();
  const [menu, setMenu] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // The bar firms up (shadow, tighter height) once the page has moved under it.
  // A 1px sentinel above the bar, watched by IntersectionObserver: no scroll listener.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const closeAll = useCallback(() => { setMenu(null); setMobile(false); }, []);

  // Desktop with a real pointer: menus open on hover, with a short close delay so the
  // pointer can travel from the label into the panel. Click and keyboard still work.
  const hoverTimer = useRef<number | null>(null);
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hoverOpen = (id: string) => {
    if (!canHover()) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setMenu(id), 90);
  };
  const hoverClose = () => {
    if (!canHover()) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setMenu(null), 180);
  };
  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);

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
    <>
    <div className="topbar-sentinel" ref={sentinelRef} aria-hidden="true" />
    <div className={`topbar${scrolled ? " is-scrolled" : ""}`} ref={barRef}>
      <A11yStyles />
      <div className="site-shell topbar-inner">
        <Link className="topbar-logo" href="/" aria-label={c.home}><Logo /></Link>
        <nav className="topnav" aria-label={c.main}>
          {MENUS.map((m) => (
            <div className="topnav-item" key={m.id} onPointerEnter={() => hoverOpen(m.id)} onPointerLeave={hoverClose}>
              <button
                id={`menu-btn-${m.id}`}
                type="button"
                aria-expanded={menu === m.id}
                aria-controls={`menu-${m.id}`}
                className={m.items.some((it) => it.href === pathname) ? "is-current" : undefined}
                onClick={() => setMenu(menu === m.id ? null : m.id)}
              >
                {ar ? m.labelAr : m.label} <ChevronDown size={14} aria-hidden="true" />
              </button>
              {menu === m.id && (
                <div className="dropdown" id={`menu-${m.id}`}>
                  <div className="dd-list">
                    {m.items.map((it) => {
                      const Icon = ICONS[it.href] ?? LayoutGrid;
                      return (
                        <Link key={it.href} href={it.href} onClick={closeAll} aria-current={pathname === it.href ? "page" : undefined}>
                          <i className="dd-ic" aria-hidden="true"><Icon size={18} /></i>
                          <span className="dd-t"><b>{ar ? it.labelAr : it.label}</b><span>{ar ? it.textAr : it.text}</span></span>
                        </Link>
                      );
                    })}
                  </div>
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
          <a className="topbar-login" href={APP_URL}>{c.login}</a>
          <Link className="btn btn-primary btn-sm" href="/contact">{c.demo}</Link>
          <button
            ref={toggleRef}
            className="mobile-menu"
            type="button"
            aria-label={mobile ? c.close : c.open}
            aria-expanded={mobile}
            aria-controls="mobile-nav"
            onClick={() => setMobile(!mobile)}
          >
            <span className={`burger${mobile ? " is-open" : ""}`} aria-hidden="true"><i /><i /><i /></span>
          </button>
        </div>
      </div>
      {mobile && (
        <nav id="mobile-nav" className="mobile-panel" aria-label={c.site}>
          <div className="site-shell">
            {MENUS.map((m, gi) => (
              <div key={m.id} className="mobile-group" style={{ "--rv-delay": `${gi * 60}ms` } as React.CSSProperties}>
                <span className="mobile-group-h">{ar ? m.labelAr : m.label}</span>
                {m.items.map((it) => <Link key={it.href} href={it.href} onClick={closeAll} aria-current={pathname === it.href ? "page" : undefined}>{ar ? it.labelAr : it.label}</Link>)}
              </div>
            ))}
            <div className="mobile-group" style={{ "--rv-delay": `${MENUS.length * 60}ms` } as React.CSSProperties}>
              <Link className="btn btn-primary mobile-demo" href="/contact" onClick={closeAll}>{c.demo}</Link>
              <a href={APP_URL}>{c.login}</a>
              {ar
                ? <Link href="/" lang="en" onClick={closeAll}>English</Link>
                : <Link href="/ar" lang="ar" onClick={closeAll}>العربية</Link>}
            </div>
          </div>
        </nav>
      )}
    </div>
    </>
  );
}
