import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { OG_IMAGES } from "@/lib/site";
import "./solutions.css";

const DESCRIPTION = "Tyre Pulse by use case: tyre management for GCC fleets, ready-mix fleet maintenance and moving a fleet off spreadsheets.";

export const metadata: Metadata = {
  title: "Solutions",
  description: DESCRIPTION,
  alternates: alternatesFor("/solutions"),
  openGraph: { images: OG_IMAGES, title: "Solutions | Tyre Pulse", description: DESCRIPTION, url: "/solutions", type: "website" },
};

const CARDS = [
  { href: "/solutions/tyre-management", title: "Tyre management", text: "Cost per km by brand and size, removal forecasts, an RFID or serial passport per tyre, and TPMS alerts through telematics." },
  { href: "/solutions/ready-mix-fleet", title: "Ready-mix fleet", text: "Preventive maintenance for mixers, pumps and plant, breakdown downtime split into waiting and repair, and cost per m3." },
  { href: "/solutions/spreadsheets-to-platform", title: "Spreadsheets to platform", text: "A factual comparison with spreadsheets and generic maintenance tools, and what moving your files involves." },
] as const;

export default function SolutionsPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Solutions", "/solutions")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { label: "Solutions" }]}
        title="Start from the problem you need solved."
        lead="Each page covers one use case: the problem, how Tyre Pulse handles it in three steps, the modules involved and what you need to start."
      />
      <section className="section-pad tight" aria-label="Use cases">
        <div className="site-shell">
          <ul className="sol-cards">
            {CARDS.map((c) => (
              <li key={c.href}>
                <Link href={c.href}>
                  <h2>{c.title}</h2>
                  <p>{c.text}</p>
                  <em>Read the use case <ArrowRight size={15} aria-hidden="true" /></em>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section-pad soft-bg" aria-labelledby="sol-more">
        <div className="site-shell">
          <h2 className="sec-h" id="sol-more">Looking by industry or by module?</h2>
          <p className="panel-text">The industries page covers construction, transport, rental, workshop networks and government fleets. The platform pages describe each module in detail.</p>
          <p><Link className="btn-text" href="/industries">Browse industries <ArrowRight size={16} aria-hidden="true" /></Link> <Link className="btn-text" href="/platform">Browse the platform <ArrowRight size={16} aria-hidden="true" /></Link></p>
        </div>
      </section>
      <CtaBand title="Tell us which problem costs you most." text="Send your fleet size and the use case. We build the demo around your own records." button="Book a demo on your data" />
    </PageFrame>
  );
}
