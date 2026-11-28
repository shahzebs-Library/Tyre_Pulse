import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { alternatesFor } from "../../schema";
import { OG_IMAGES } from "@/lib/site";
import "../../solutions/solutions.css";

const DESCRIPTION = "تاير بالس حسب حالة الاستخدام: إدارة الإطارات لأساطيل الخليج، وصيانة أسطول الخرسانة الجاهزة، والانتقال من الجداول إلى منصة واحدة.";

export const metadata: Metadata = {
  title: { absolute: "الحلول حسب حالة الاستخدام | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/solutions"),
  openGraph: { images: OG_IMAGES, title: "الحلول حسب حالة الاستخدام | تاير بالس", description: DESCRIPTION, url: "/ar/solutions", locale: "ar_SA", type: "website" },
};

/* The detailed use-case pages are in English; each card says so before the visitor follows it. */
const CARDS = [
  { href: "/solutions/tyre-management", title: "إدارة الإطارات", text: "التكلفة لكل كيلومتر حسب العلامة والمقاس، وتوقع عمر الإطار من الكيلومترات والساعات، وسجل لكل رقم تسلسلي. تنبيهات ضغط الإطارات المباشرة (TPMS) مخطط لها." },
  { href: "/solutions/ready-mix-fleet", title: "أسطول الخرسانة الجاهزة", text: "توقف الأعطال مقسوماً بين الانتظار والإصلاح، والتكلفة لكل متر مكعب، وخطط صيانة عند الطلب للخلاطات والمضخات والمحطات." },
  { href: "/solutions/spreadsheets-to-platform", title: "من الجداول إلى المنصة", text: "مقارنة واقعية مع الجداول وأدوات الصيانة العامة، وما يتطلبه نقل ملفاتك." },
] as const;

export default function ArabicSolutionsPage() {
  return <>
    <PageTop locale="ar" photo="engineer" photoPosition="35% 20%" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "الحلول" }]} title="ابدأ من المشكلة التي تريد حلها." lead="كل صفحة تغطي حالة استخدام واحدة: المشكلة، وكيف يعالجها تاير بالس في ثلاث خطوات، والوحدات المعنية، وما تحتاجه للبدء." />
    <section className="section-pad tight" aria-label="حالات الاستخدام">
      <div className="site-shell">
        <ul className="sol-cards">
          {CARDS.map((c) => (
            <li key={c.href}>
              <Link href={c.href} hrefLang="en">
                <h2>{c.title}</h2>
                <p>{c.text}</p>
                <em>اقرأ حالة الاستخدام (بالإنجليزية) <ArrowLeft size={15} aria-hidden="true" /></em>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
    <section className="section-pad soft-bg" aria-labelledby="sol-more-ar">
      <div className="site-shell">
        <h2 className="sec-h" id="sol-more-ar">تبحث حسب القطاع أو الوحدة؟</h2>
        <p className="panel-text">صفحة القطاعات تغطي الخرسانة الجاهزة والإنشاءات والمعدات الثقيلة والنقل والحافلات وشبكات الورش. وصفحة المنصة تصف كل وحدة.</p>
        <p><Link className="btn-text" href="/ar/industries">تصفح القطاعات <ArrowLeft size={16} aria-hidden="true" /></Link> <Link className="btn-text" href="/ar/platform">تصفح المنصة <ArrowLeft size={16} aria-hidden="true" /></Link></p>
      </div>
    </section>
    <CtaBand title="شاهد كيف يناسب تاير بالس أسطولك." text="عرض مبني على مواقعك وأصولك وتسلسل الموافقات لديك." button="احجز عرضاً" href="/ar/contact" />
  </>;
}
