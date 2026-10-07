"use client";

import { AnumAvatar } from "./AnumAvatar";
import Link from "next/link";
import { track } from "@/lib/track";

/** Opens the Anum guide from anywhere. AssistantWidget listens for this window event. */
export const ANUM_OPEN_EVENT = "tp:anum-open";

const LABELS = {
  en: { nav: "Quick actions", demo: "Book a demo", waAria: "Chat with Tyre Pulse on WhatsApp", anum: "Ask Anum", anumAria: "Ask Anum, the Tyre Pulse guide" },
  ar: { nav: "إجراءات سريعة", demo: "احجز عرضًا", waAria: "تواصل مع Tyre Pulse عبر واتساب", anum: "اسأل أنعم", anumAria: "اسأل أنعم، دليل Tyre Pulse" },
} as const;

type Props = { arabic: boolean; tucked: boolean; whatsappUrl: string | null };

/**
 * Phones and small tablets (CSS shows it at 768px and below): a slim bar pinned to the
 * bottom edge instead of floating bubbles, so it never sits on top of a form field or a
 * tab. A spacer of the same height closes the page, so the last content is never covered.
 * It respects the safe-area inset and, on the home hero, waits until the visitor scrolls.
 */
export function MobileActionBar({ arabic, tucked, whatsappUrl }: Props) {
  const t = LABELS[arabic ? "ar" : "en"];
  const off = tucked ? -1 : undefined;
  return (
    <>
      <div className="tp-mbar-spacer" aria-hidden="true" />
      <nav className={`tp-mbar${tucked ? " is-tucked" : ""}`} aria-label={t.nav} dir={arabic ? "rtl" : "ltr"} aria-hidden={tucked || undefined}>
        <Link className="tp-mbar-btn is-primary" href="/contact" tabIndex={off}>{t.demo}</Link>
        {whatsappUrl ? (
          <a
            className="tp-mbar-btn is-icon"
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.waAria}
            tabIndex={off}
            onClick={() => track("whatsapp_click", { source: "mobile_bar" })}
          >
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <path fill="#25d366" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.8.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.2 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5 0-.2-.3-.3-.5-.4z" />
            </svg>
          </a>
        ) : null}
        <button
          type="button"
          className="tp-mbar-btn is-anum"
          aria-haspopup="dialog"
          aria-label={t.anumAria}
          tabIndex={off}
          onClick={() => window.dispatchEvent(new Event(ANUM_OPEN_EVENT))}
        >
          <span className="tp-mbar-avatar" aria-hidden="true"><AnumAvatar size={22} /></span>
          <span>{t.anum}</span>
        </button>
      </nav>
    </>
  );
}
