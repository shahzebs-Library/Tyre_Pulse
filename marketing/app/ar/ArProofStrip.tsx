import { CountUp } from "@/components/motion/CountUp";
import { PROOF } from "@/lib/proof";

/*
 * Arabic wording for the shared proof figures. The numbers themselves come from
 * lib/proof.ts (PROOF), the single source for every page, so the Arabic page can
 * never quote a different figure from the English one. Keyed by the English label:
 * a figure added to PROOF without an Arabic line here is left out rather than
 * shown in English inside the Arabic page.
 */
const AR: Record<string, { label: string; text: string }> = {
  "machines on record": { label: "معدة وآلية ومركبة مسجلة", text: "خلاطات ومضخات ولوادر ومولدات ومعدات ثابتة." },
  "job cards": { label: "بطاقة عمل", text: "مستوردة من نظام تخطيط الموارد ومُدارة داخل التطبيق." },
  "expense lines": { label: "بند مصروفات", text: "مصنفة إلى إطارات وقطع غيار وزيوت." },
  countries: { label: "دول", text: "السعودية والإمارات ومصر، كل دولة بعملتها الخاصة." },
};

/** Used only by /ar. Same markup and classes as components/ProofStrip, Arabic copy. */
export function ArProofStrip() {
  const rows = PROOF.flatMap((p) => (AR[p.label] ? [{ ...p, ar: AR[p.label] }] : []));
  return (
    <section className="proof proof-solo" aria-labelledby="ar-proof">
      <div className="site-shell">
        <div className="proof-head">
          <h2 id="ar-proof">يعمل اليوم في تشغيل فعلي لأسطول خرسانة جاهزة.</h2>
          <p>أرقام حقيقية من التشغيل الحالي في ثلاث دول، مقربة إلى الأدنى.</p>
        </div>
        <dl className="proof-stats">
          {rows.map((p) => (
            <div key={p.label}>
              <dt>{p.ar.label}</dt>
              <dd><b><CountUp value={p.value} suffix={p.suffix} /></b><span>{p.ar.text}</span></dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
