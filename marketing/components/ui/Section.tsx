import type { Faq } from "@/lib/faqs";
import { StatusBadge, type CapabilityStatus } from "./StatusBadge";

/**
 * A page section with the shared spacing and heading scale.
 * tone: plain (white), soft (warm grey band), dark (asphalt band).
 */
export function Section({
  id, title, lead, tone = "plain", tight, children, titleHidden,
}: {
  id: string; title: string; lead?: string; tone?: "plain" | "soft" | "dark"; tight?: boolean; titleHidden?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`tp-section tp-section--${tone}${tight ? " is-tight" : ""}`} aria-labelledby={id}>
      <div className="site-shell">
        <div className={`tp-head${titleHidden ? " sr-only" : ""}`}>
          <h2 className="sec-h" id={id}>{title}</h2>
          {lead && <p className="tp-lead">{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Question and answer list. The same markup on every page that shows FAQs. */
export function FaqList({ items }: { items: ReadonlyArray<Faq> }) {
  return (
    <dl className="faq-list">
      {items.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
    </dl>
  );
}

/** A list of capabilities, one row each: name, one line, status badge. */
export function CapabilityList({ items }: { items: ReadonlyArray<readonly [name: string, text: string, status: CapabilityStatus]> }) {
  return (
    <ul className="tp-caps">
      {items.map(([name, text, status]) => (
        <li key={name}>
          <div><b>{name}</b><span>{text}</span></div>
          <StatusBadge status={status} />
        </li>
      ))}
    </ul>
  );
}
