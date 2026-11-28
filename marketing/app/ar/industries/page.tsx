import type { Metadata } from "next";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { alternatesFor } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

const DESCRIPTION = "تاير بالس للخرسانة الجاهزة والإنشاءات والمعدات الثقيلة والنقل والحافلات وشبكات الورش والعمليات متعددة المواقع.";

export const metadata: Metadata = {
  title: { absolute: "القطاعات | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/industries"),
  openGraph: { images: OG_IMAGES, title: "القطاعات | تاير بالس", description: DESCRIPTION, url: "/ar/industries", locale: "ar_SA", type: "website" },
};

/* Mirrors /industries: ready-mix is in production today; the other models are configured with you. */
const INDUSTRIES: CardProps[] = [
  { photo: { name: "mixer", alt: "شاحنة خلاطة خرسانة" }, title: "الخرسانة الجاهزة", text: "الخلاطات والمضخات ومحطات الخلط، حيث يحدد الحمل والوصول إلى الموقع والتوقف وأعطال الإطارات مسار اليوم.", note: "قيد التشغيل اليوم" },
  { photo: { name: "loaderSite", alt: "محمل بعجلات متوقف في موقع إنشاء" }, title: "أساطيل الإنشاءات", text: "مركبات ومعدات ثقيلة عبر المشاريع والمواقع النائية، تُقاس بساعات التشغيل حيث لا يوجد عداد مسافة.", note: "يُهيّأ معك" },
  { photo: { name: "loader", position: "30% 60%", alt: "محمل بعجلات في محجر" }, title: "المعدات الثقيلة", text: "المحملات والحفارات والمولدات، بصيانة حسب الساعات ومقاسات إطارات الطرق الوعرة وقوائم فحص خاصة بها.", note: "يُهيّأ معك" },
  { title: "شبكات الورش", text: "الأعمال المفتوحة والفنيون وتأخر القطع عبر أكثر من ورشة.", note: "يُهيّأ معك" },
  { title: "النقل والخدمات اللوجستية", text: "شاحنات ومقطورات بمسافات طويلة: عمر الإطار والتكلفة لكل كيلومتر والفحوصات والجاهزية حسب المستودع.", note: "يُهيّأ معك" },
  { title: "الحافلات والمركبات التجارية", text: "فحوصات يومية قبل الرحلة، وحالة الإطار حسب موضع العجلة، وصيانة حسب الكيلومترات أو التاريخ.", note: "يُهيّأ عند الطلب" },
  { title: "العمليات متعددة المواقع والدول", text: "ترى كل دولة سجلاتها بعملتها، ويرى المكتب الرئيسي الجميع. التقييد حسب الموقع متاح.", note: "قيد التشغيل اليوم" },
  { title: "تأجير المعدات الثقيلة", text: "إسناد المعدات للعملاء وساعات التشغيل وفحوصات التسليم.", note: "يُهيّأ عند الطلب" },
  { title: "الأساطيل الحكومية والمؤسسية", text: "صلاحيات صارمة حسب الموقع وحدود للاعتماد وسجل تدقيق كامل.", note: "يُهيّأ عند الطلب" },
];

export default function ArabicIndustriesPage() {
  return <>
    <PageTop locale="ar" photo="fleetLineup" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "القطاعات" }]} title="مهيأ لطريقة عمل منشأتك." lead="بُني داخل منشأة خرسانة جاهزة تشغّل خلاطات ومضخات ومحطات خلط في السعودية والإمارات ومصر. الخرسانة الجاهزة هي التشغيل القائم اليوم، أما النماذج الأخرى أدناه فتُهيّأ معك ولم تُشغَّل بعد." />
    <section className="section-pad tight" aria-label="القطاعات"><div className="site-shell">
      <CardGrid cols={3}>
        {INDUSTRIES.map((c) => <Card key={c.title} titleAs="h2" locale="ar" {...c} />)}
      </CardGrid>
      <p className="ar-en-note">&quot;يُهيّأ عند الطلب&quot; تعني أن المنصة تُعدّ لهذا النموذج معك، وهي لا تعمل فيه اليوم.</p>
    </div></section>
    <CtaBand title="شاهد كيف يناسب تاير بالس أسطولك." text="عرض مبني على مواقعك وأصولك وتسلسل الموافقات لديك." button="احجز عرضاً" href="/ar/contact" />
  </>;
}
