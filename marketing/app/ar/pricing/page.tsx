import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { PageTop } from "@/components/PageTop";
import { PricingModels } from "@/components/PricingContent";
import { FaqList, Section } from "@/components/ui/Section";
import { JsonLd, alternatesFor, faqSchema } from "../../schema";
import { OG_IMAGES } from "@/lib/site";
import { QUOTE_TURNAROUND } from "@/lib/pricing";

const DESCRIPTION = "تسعير تاير بالس حسب العقد، لكل مركبة أو لكل مستخدم أو لكل باقة وحدات. تعرّف على ما يحدد السعر واحصل على عرض سعر لأسطولك خلال يوم عمل واحد.";

export const metadata: Metadata = {
  title: { absolute: "الأسعار | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/pricing"),
  openGraph: { images: OG_IMAGES, title: "الأسعار | تاير بالس", description: DESCRIPTION, url: "/ar/pricing", locale: "ar_SA", type: "website" },
};

const INCLUDED = [
  "تطبيق أندرويد للفرق الميدانية يعمل دون اتصال",
  "العربية والإنجليزية، ولكل دولة عملتها الخاصة",
  "الاستيراد من ملفات نظام تخطيط الموارد وExcel",
  "صلاحيات حسب الدور والدولة، مع إمكانية التقييد حسب الموقع",
  "تصدير Excel وPDF من كل سجل",
  "تهيئة المنصة على قائمة أصولك أنت",
];

const FAQ = [
  ["لماذا لا توجد أسعار منشورة؟", "الأسعار حسب العقد. تختلف الأساطيل في عدد المعدات والمواقع والدول والتكاملات. عرض السعر المبني على أرقامك أوفر من سعر عام مرتفع يغطي الجميع."],
  ["هل يمكننا البدء بشكل محدود؟", "نعم. تبدأ معظم الأساطيل بموقع واحد ومجال عمل واحد، مثل الإطارات أو الفحوصات، ثم تضيف الباقي عندما يثبت جدواه."],
  ["ماذا تحتاجون منا لإعداد عرض السعر؟", "حجم الأسطول وعدد المستخدمين والدول التي تعملون فيها والأنظمة التي تريدون ربطها. رسالة قصيرة تكفي."],
] as const;

export default function ArabicPricingPage() {
  return <>
    <JsonLd data={faqSchema(FAQ, "/ar/pricing")} />
    <PageTop locale="ar" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "الأسعار" }]} title="التسعير لكل مركبة أو لكل مستخدم أو لكل باقة وحدات." lead={`الأسعار حسب العقد. اختر الطريقة التي تناسب طريقة إدارة أسطولك، أو اجمع بينها. أرسل حجم أسطولك ويصلك عرض السعر خلال ${QUOTE_TURNAROUND.ar}. يتولى فريقنا إعداد كل عميل، ولا يوجد تسجيل ذاتي.`} cta={false} />
    <PricingModels locale="ar" />
    <Section id="incl-ar" tone="soft" title="مشمول في كل باقة.">
      <ul className="quote-points ar-incl">{INCLUDED.map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}</ul>
    </Section>
    <Section id="faq-ar" title="أسئلة قبل عرض السعر.">
      <FaqList items={FAQ} />
    </Section>
  </>;
}
