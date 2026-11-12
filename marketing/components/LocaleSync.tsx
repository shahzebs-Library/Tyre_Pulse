"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The root layout is shared by every route, so it can only declare one page language.
 * /ar is Arabic: this keeps <html lang> true to the page (WCAG 3.1.1) on first load and
 * across client-side navigation, and gives the skip link the reader's language.
 * Direction is set on <html> too, so the scrollbar side and anything rendered outside the
 * page container (the dock, the action bar) follow the page language.
 */
export function LocaleSync() {
  const isArabic = usePathname()?.startsWith("/ar") ?? false;

  useEffect(() => {
    document.documentElement.lang = isArabic ? "ar" : "en";
    document.documentElement.dir = isArabic ? "rtl" : "ltr";
  }, [isArabic]);

  return (
    <a className="skip-link" href="#main-content">
      {isArabic ? "تخطَّ إلى المحتوى الرئيسي" : "Skip to main content"}
    </a>
  );
}
