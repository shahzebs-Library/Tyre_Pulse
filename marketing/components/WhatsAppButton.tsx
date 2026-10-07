"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { WHATSAPP_URL } from "@/lib/site";
import { track } from "@/lib/track";
import { AssistantWidget } from "./AssistantWidget";
import { MobileActionBar } from "./MobileActionBar";

/**
 * Bottom corner dock: the Anum guide launcher with a discreet WhatsApp button under it.
 * Both share one fixed column so they can never overlap. WhatsApp renders only when a
 * real number is configured; the guide always renders.
 * On pages with the hero slide picker the dock stays tucked away until the visitor scrolls,
 * because it would otherwise cover the slide picker (on phones, and on desktop the last
 * tab sat under the launcher at 1280 and 1366 wide).
 * At 768px and below the floating launcher and WhatsApp bubble give way to a slim bottom
 * action bar (MobileActionBar); the dock then only hosts the guide panel.
 * On the contact page neither renders: the page carries its own WhatsApp and email links,
 * and a floating dock there would sit on top of the form fields.
 */
export function WhatsAppButton() {
  const [tucked, setTucked] = useState(false);
  const pathname = usePathname();
  const isArabic = pathname?.startsWith("/ar") ?? false;
  const onContact = /^\/(ar\/)?contact\/?$/.test(pathname ?? "");

  // Tucked while the hero slide picker is on screen: that row is what the dock (desktop) or
  // the bottom bar (phones) would otherwise cover. Watching the picker itself, not the whole
  // hero, keeps this right however tall the hero becomes. IntersectionObserver costs
  // nothing while scrolling, unlike a scroll listener.
  useEffect(() => {
    const target = document.querySelector(".home-hero .hc-picker") ?? document.querySelector(".home-hero");
    if (!target || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setTucked(e.isIntersecting), { threshold: [0] });
    io.observe(target);
    return () => { io.disconnect(); setTucked(false); };
  }, [pathname]);

  if (onContact) return null;

  // Keyed by language: switching between / and /ar remounts the guide so replies never mix languages.
  return (
    <>
    <MobileActionBar arabic={isArabic} tucked={tucked} whatsappUrl={WHATSAPP_URL} />
    <AssistantWidget key={isArabic ? "ar" : "en"} arabic={isArabic} tucked={tucked} whatsappUrl={WHATSAPP_URL}>
      {WHATSAPP_URL ? (
        <a
          className="wa-float"
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={isArabic ? "تواصل مع Tyre Pulse عبر واتساب" : "Chat with Tyre Pulse on WhatsApp"}
          tabIndex={tucked ? -1 : undefined}
          onClick={() => track("whatsapp_click", { source: "dock" })}
        >
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <path fill="#fff" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.8.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.2 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5 0-.2-.3-.3-.5-.4z"/>
          </svg>
        </a>
      ) : null}
    </AssistantWidget>
    </>
  );
}
