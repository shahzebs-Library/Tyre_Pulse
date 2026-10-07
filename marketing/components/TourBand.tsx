import { Walkthrough, type ScenarioId } from "@/components/motion/walkthrough/Walkthrough";

/** A bright band holding the module tours that belong to one page. */
export function TourBand({ id, title, only }: { id: string; title: string; lead?: string; only?: ScenarioId[] }) {
  return (
    <section className="bright-band" aria-labelledby={id}>
      <div className="site-shell">
        <h2 className="sec-h" id={id}>{title}</h2>
        <Walkthrough only={only} />
      </div>
    </section>
  );
}
