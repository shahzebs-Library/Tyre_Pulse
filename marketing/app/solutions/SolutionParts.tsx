import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JsonLd } from "../schema";
import "./solutions.css";

/**
 * Building blocks shared by the /solutions pages. Kept beside the pages (not in
 * components/) because nothing else on the site uses them.
 */

export type Faq = readonly (readonly [string, string])[];

/** The problem the page answers: a short paragraph and the pains that cost money. */
export function Problem({ id, title, text, pains }: { id: string; title: string; text: string; pains: readonly (readonly [string, string])[] }) {
  return (
    <section className="section-pad" aria-labelledby={id}>
      <div className="site-shell sol-problem">
        <div>
          <h2 className="sec-h" id={id}>{title}</h2>
          <p>{text}</p>
        </div>
        <ul className="sol-pains">
          {pains.map(([b, s]) => <li key={b}><b>{b}</b><span>{s}</span></li>)}
        </ul>
      </div>
    </section>
  );
}

/** How it works, always three steps, numbered by the shared .next-steps style. */
export function Steps({ id, title, lead, steps }: { id: string; title: string; lead: string; steps: readonly (readonly [string, string])[] }) {
  return (
    <section className="section-pad soft-bg" aria-labelledby={id}>
      <div className="site-shell split split-top">
        <div>
          <h2 className="sec-h" id={id}>{title}</h2>
          <p className="panel-text">{lead}</p>
        </div>
        <ol className="next-steps">{steps.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
      </div>
    </section>
  );
}

/** The platform modules this use case runs on, each linking to its page. */
export function Modules({ id, title, items }: { id: string; title: string; items: readonly { href: string; label: string; text: string; cta?: string }[] }) {
  return (
    <section className="section-pad" aria-labelledby={id}>
      <div className="site-shell">
        <h2 className="sec-h" id={id}>{title}</h2>
        <ul className="sol-modules">
          {items.map((m) => (
            <li key={m.href + m.label}>
              <Link href={m.href}>
                <b>{m.label}</b>
                <span>{m.text}</span>
                <em>{m.cta ?? "See the module"} <ArrowRight size={15} aria-hidden="true" /></em>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** What a customer has to bring. Each line says whether it is needed or optional. */
export function StartList({ id, title, lead, items }: { id: string; title: string; lead: string; items: readonly { need: boolean; label: string; text: string }[] }) {
  return (
    <section className="section-pad soft-bg" aria-labelledby={id}>
      <div className="site-shell">
        <h2 className="sec-h" id={id}>{title}</h2>
        <p className="panel-text">{lead}</p>
        <ul className="sol-start">
          {items.map((i) => (
            <li key={i.label}>
              <span className={i.need ? "sol-tag" : "sol-tag opt"}>{i.need ? "Needed" : "Optional"}</span>
              <b>{i.label}</b>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** FAQPage structured data for one page's visible questions. */
export function faqSchema(faq: Faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

/**
 * Visible questions plus the matching FAQPage JSON-LD. The schema is emitted
 * from the same array the page renders, so the two can never disagree.
 */
export function FaqBlock({ id, title, faq }: { id: string; title: string; faq: Faq }) {
  return (
    <section className="section-pad" aria-labelledby={id}>
      <JsonLd data={faqSchema(faq)} />
      <div className="site-shell">
        <h2 className="sec-h" id={id}>{title}</h2>
        <dl className="faq-list">{faq.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
      </div>
    </section>
  );
}
