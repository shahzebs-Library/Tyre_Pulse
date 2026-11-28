import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BarChart3, Box, CheckCircle2, CircleDot, ClipboardCheck, FileCheck2, ShieldAlert, Truck, Wrench } from "lucide-react";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { alternatesFor } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

const DESCRIPTION = "منصة إدارة المعدات والآليات والمركبات: الأسطول والأصول والصيانة والفحوصات والإطارات والحوادث والمستودعات والتكاليف في نظام مترابط.";

export const metadata: Metadata = {
  title: { absolute: "المنصة | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/platform"),
  openGraph: { images: OG_IMAGES, title: "المنصة | تاير بالس", description: DESCRIPTION, url: "/ar/platform", locale: "ar_SA", type: "website" },
};

/* Mirrors the English /platform areas. Each detail page is in English and is marked so. */
const AREAS = [
  { icon: Truck, title: "إدارة الأسطول والأصول", text: "تتبّع كل المعدات والآليات والمركبات، واحفظ بيانات الأصل وسجله ومستنداته وتكاليفه في مكان واحد.",
    points: ["قراءات العدادات والاستخدام محدّثة", "سجل الخدمة والتكاليف والمستندات لكل معدة", "الموقع والملكية ومركز التكلفة على كل سجل"], href: "/platform/fleet-assets" },
  { icon: Wrench, title: "الصيانة والورشة", text: "الأعطال والأعمال المخططة في قائمة واحدة، مع الفنيين والقطع والإصلاحات الخارجية على كل بطاقة عمل.",
    points: ["أوامر العمل حسب الأولوية والموقع والحالة", "خطط وقائية حسب الساعات أو الكيلومترات أو التاريخ، عند الطلب", "العمالة والقطع والخدمات الخارجية على العمل"], href: "/platform/maintenance" },
  { icon: ClipboardCheck, title: "الفحوصات والسلامة", text: "فحوصات يومية على الهاتف دون اتصال، بالصور وقراءات العدادات وتوقيع المشرف.",
    points: ["قوائم فحص مهيأة حسب نوع الأصل", "الأعطال تنشئ إجراءات وأوامر عمل", "الاعتماد على الهاتف"], href: "/platform/inspections" },
  { icon: CircleDot, title: "دورة حياة الإطارات", text: "كل إطار من التركيب حتى الإتلاف، حسب الرقم التسلسلي وموضع العجلة، مع تكلفته لكل كيلومتر أو ساعة تشغيل.",
    points: ["التركيب والإزالة حسب الرقم التسلسلي والموضع", "أسباب الإتلاف مسجلة مع من ومتى", "التكلفة لكل كيلومتر أو ساعة حسب العلامة والمقاس"], href: "/platform/tyre-lifecycle" },
  { icon: Box, title: "المستودعات وقطع الغيار", text: "تُصرف القطع على بطاقة العمل والمعدة، فيُظهر كل عمل ما استهلكه. طلبات الشراء مع الاعتماد تُعدّ عند الطلب.",
    points: ["المخزون وحد إعادة الطلب لكل موقع", "صرف القطع على العمل والأصل", "طلبات شراء مع اعتماد، عند الطلب"], href: "/platform/inventory" },
  { icon: BarChart3, title: "التكاليف والتقارير", text: "تُجمع تكاليف الإطارات والقطع والزيوت والإصلاحات حسب المعدة والموقع والشهر، ولكل دولة عملتها.",
    points: ["التكلفة حسب الأصل والموقع والفئة", "الجاهزية والتوقف", "تقارير مجدولة وتصدير"], href: "/platform/reports" },
] as const;

const MORE: CardProps[] = [
  { icon: ShieldAlert, title: "الحوادث والمطالبات", text: "ملفات الحوادث بالصور والأضرار والسبب الجذري ومستندات المطالبة.", status: "available" },
  { icon: FileCheck2, title: "الأدوار والاعتماد", text: "صلاحيات حسب الدور والدولة، مع اعتماد الفحوصات وقوائم الفحص وإغلاق الحوادث.", status: "available", href: "/ar/security", linkLabel: "اطّلع على ضبط الصلاحيات" },
];

export default function ArabicPlatformPage() {
  return <>
    <PageTop locale="ar" photo="fleetLineup" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "المنصة" }]} title="منصة واحدة للإطارات والمعدات والورشة والمستودعات." lead="خلاطات ومضخات ومحملات ومولدات: سجل واحد لكل معدة، يتشاركه الميدان والورشة والمستودعات والمالية." />
    <Section id="areas-ar" title="كل مجال على سجل الأصل نفسه." lead="تعمل المجالات كلها على سجل الأصل ذاته، فلا يُكتب شيء مرتين.">
      <ul className="ar-areas">
        {AREAS.map(({ icon: Icon, title, text, points, href }) => (
          <li key={title}>
            <Icon size={28} strokeWidth={1.7} aria-hidden="true" />
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
              <ul className="quote-points">{points.map((p) => <li key={p}><CheckCircle2 size={17} aria-hidden="true" />{p}</li>)}</ul>
              <Link className="btn-text" href={href} hrefLang="en">التفاصيل الكاملة (بالإنجليزية) <ArrowLeft size={16} aria-hidden="true" /></Link>
            </div>
          </li>
        ))}
      </ul>
    </Section>
    <Section id="more-ar" tone="soft" title="وأيضاً على المنصة.">
      <CardGrid cols={2}>{MORE.map((c) => <Card key={c.title} locale="ar" {...c} />)}</CardGrid>
    </Section>
    <section className="section-pad tight" id="tours" aria-labelledby="tours-ar"><div className="site-shell">
      <h2 className="sec-h" id="tours-ar">جولات المنتج.</h2>
      <p className="panel-text">ست مسارات عمل خطوة بخطوة، على الهاتف والويب جنباً إلى جنب. الجولات التفاعلية متاحة باللغة الإنجليزية.</p>
      <p><Link className="btn-text" href="/platform#tours" hrefLang="en">شاهد الجولات (بالإنجليزية) <ArrowLeft size={16} aria-hidden="true" /></Link></p>
    </div></section>
    <CtaBand title="شاهد أسطولك على تاير بالس." text="أحضر قائمة أصولك وشهراً من بطاقات العمل، ونحمّلها قبل الاتصال." button="احجز عرضاً على بياناتك" href="/ar/contact" />
  </>;
}
