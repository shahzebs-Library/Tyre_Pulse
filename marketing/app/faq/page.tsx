import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { FaqList } from "@/components/ui/Section";
import { JsonLd, alternatesFor, faqSchema, pageBreadcrumb } from "../schema";
import { FAQ_GROUPS } from "@/lib/faqs";
import { OG_IMAGES } from "@/lib/site";

const PATH = "/faq";
const TITLE = "Frequently asked questions";
const DESCRIPTION = "Answers about Tyre Pulse: deployment, users and roles, tyre data import, inspections, reporting, security, onboarding and pricing.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const ALL = FAQ_GROUPS.flatMap((g) => g.items);

export default function FaqPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("FAQ", PATH)} />
      <JsonLd data={faqSchema(ALL, PATH)} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { label: "FAQ" }]}
        title="Questions fleet teams ask us."
        lead="Short answers on deployment, roles, tyre data, inspections, reporting and security. If yours is not here, ask it in a demo."
      />
      <section className="tp-section is-tight" aria-label="Questions by topic">
        <div className="site-shell">
          <SubNav items={FAQ_GROUPS.map((g) => [`#${g.id}`, g.title] as [string, string])} />
          {FAQ_GROUPS.map((g) => (
            <div className="faq-group" key={g.id}>
              <h2 id={g.id}>{g.title}</h2>
              <FaqList items={g.items} />
            </div>
          ))}
        </div>
      </section>
      <CtaBand title="Ask the question that is specific to your fleet." text="A demo on your own asset list and tyre records answers it faster than a page can." />
    </PageFrame>
  );
}
