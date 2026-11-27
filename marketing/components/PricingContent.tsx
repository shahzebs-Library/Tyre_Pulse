import { BadgeDollarSign, Boxes, CheckCircle2, Truck, Users } from "lucide-react";
import { Card, CardGrid } from "@/components/ui/Card";
import { FaqList, Section } from "@/components/ui/Section";
import { ContactForm } from "@/components/ContactForm";
import { PRICE_FACTORS, PRICE_FIGURES, PRICING_MODELS, QUOTE_TURNAROUND } from "@/lib/pricing";

const ICONS = { perVehicle: Truck, perUser: Users, bundle: Boxes } as const;

const COPY = {
  en: {
    modelsTitle: "Three ways to price, combined when it helps.",
    modelsLead: "We price per vehicle, per user or per module bundle, and can mix them, for example a bundle for the head office and a per-vehicle rate for the sites.",
    quoted: "Quoted on your fleet",
    factorsTitle: "What affects the price.",
    factorsLead: "These are the numbers a quote is built from. Send them and the figure follows.",
    quoteTitle: `Get a quote in ${QUOTE_TURNAROUND.en}.`,
    quoteLead: "Four details are enough. The quote comes to your work email, with the model that fits your fleet best.",
    quotePoints: ["No obligation and no sales sequence.", "The quote names each line, so nothing is hidden in a total.", "Start with one site or one area of work if you prefer."],
  },
  ar: {
    modelsTitle: "ثلاث طرق للتسعير، ويمكن الجمع بينها.",
    modelsLead: "نسعّر لكل مركبة أو لكل مستخدم أو لكل باقة وحدات، ويمكن المزج بينها، مثل باقة للمكتب الرئيسي وسعر لكل مركبة في المواقع.",
    quoted: "يُحدَّد حسب أسطولك",
    factorsTitle: "ما الذي يحدد السعر.",
    factorsLead: "هذه هي الأرقام التي يُبنى عليها عرض السعر. أرسلها ويصلك الرقم.",
    quoteTitle: `احصل على عرض سعر خلال ${QUOTE_TURNAROUND.ar}.`,
    quoteLead: "أربع معلومات تكفي. يصل عرض السعر إلى بريدك الإلكتروني للعمل، مع طريقة التسعير الأنسب لأسطولك.",
    quotePoints: ["دون أي التزام ودون رسائل تسويقية متتابعة.", "يوضّح العرض كل بند على حدة، فلا شيء مخفي في المجموع.", "يمكنك البدء بموقع واحد أو مجال عمل واحد إن شئت."],
  },
} as const;

/**
 * The pricing explanation shared by /pricing and /ar/pricing: the three models, what affects
 * the price, and the short quote form. No figure is shown until the owner sets PRICE_FIGURES.
 */
export function PricingModels({ locale = "en" }: { locale?: "en" | "ar" }) {
  const t = COPY[locale];
  return (
    <>
      <Section id={`models-${locale}`} title={t.modelsTitle} lead={t.modelsLead}>
        <CardGrid cols={3}>
          {PRICING_MODELS.map((m) => {
            const c = m[locale];
            const figure = PRICE_FIGURES ? PRICE_FIGURES[m.id] : null;
            return (
              <Card key={m.id} icon={ICONS[m.id] ?? BadgeDollarSign} title={c.title} text={c.text} note={c.fit}>
                <p className="price-figure">{figure ?? t.quoted}</p>
              </Card>
            );
          })}
        </CardGrid>
      </Section>
      <Section id={`factors-${locale}`} tone="soft" title={t.factorsTitle} lead={t.factorsLead}>
        <FaqList items={PRICE_FACTORS[locale]} />
      </Section>
      <section className="section-pad" id="quote" aria-labelledby={`quote-${locale}`}>
        <div className="site-shell contact-layout quote-layout">
          <div className="quote-intro">
            <h2 className="sec-h" id={`quote-${locale}`}>{t.quoteTitle}</h2>
            <p className="panel-text">{t.quoteLead}</p>
            <ul className="quote-points">{t.quotePoints.map((p) => <li key={p}><CheckCircle2 size={18} aria-hidden="true" />{p}</li>)}</ul>
          </div>
          <div className="card form-card">
            <ContactForm locale={locale} variant="quote" idPrefix="q-" />
          </div>
        </div>
      </section>
    </>
  );
}
