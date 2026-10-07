import { CountUp } from "@/components/motion/CountUp";
import { PROOF } from "@/lib/proof";

/** The real production figures, reused wherever a claim needs its evidence beside it. */
export function ProofStrip({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <section className="proof proof-solo" aria-labelledby={id}>
      <div className="site-shell">
        <div className="proof-head">
          <h2 id={id}>{title}</h2>
          <p>{text}</p>
        </div>
        <dl className="proof-stats">
          {PROOF.map((p) => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd><b><CountUp value={p.value} suffix={p.suffix} /></b><span>{p.text}</span></dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
