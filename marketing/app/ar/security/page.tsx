import type { Metadata } from "next";
import { Database, FileLock2, Fingerprint, KeyRound, LockKeyhole, ScrollText } from "lucide-react";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { FaqList, Section } from "@/components/ui/Section";
import { JsonLd, alternatesFor, faqSchema } from "../../schema";
import { CONTACT_EMAIL, LEGAL_LINKS, OG_IMAGES } from "@/lib/site";

const DESCRIPTION = "كيف يحمي تاير بالس بيانات الأسطول: عزل الدول داخل قاعدة البيانات، وصلاحيات حسب الدور، وسجل تدقيق، وتخزين خاص للملفات.";

export const metadata: Metadata = {
  title: { absolute: "الأمان وحماية البيانات | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/security"),
  openGraph: { images: OG_IMAGES, title: "الأمان وحماية البيانات | تاير بالس", description: DESCRIPTION, url: "/ar/security", locale: "ar_SA", type: "website" },
};

/* Only controls that exist in the product today, as on the English page. Nothing here is a certification. */
const CONTROLS: CardProps[] = [
  { icon: Database, title: "عزل الدول داخل قاعدة البيانات", text: "يقتصر كل مستخدم على الدول المسندة إليه، وتفرض قاعدة البيانات ذلك، فلا يكون إخفاء زر هو الحماية الوحيدة. التقييد حسب الموقع متاح، ويُعِدّ فريقنا كل عميل كشركة مستقلة.", status: "available" },
  { icon: KeyRound, title: "صلاحيات حسب الدور", text: "تحدد الأدوار والصلاحيات الفردية الوحدات التي يفتحها كل شخص. صلاحيات الإنشاء والتعديل والاعتماد مفروضة في قاعدة البيانات على السجلات الأساسية، والتصدير مضبوط داخل التطبيق.", status: "available" },
  { icon: Fingerprint, title: "تسجيل دخول متعدد العوامل", text: "عامل دخول ثانٍ متاح لحسابات المسؤولين.", status: "available" },
  { icon: ScrollText, title: "سجل التدقيق", text: "تُسجَّل عمليات الدخول وتغييرات الصلاحيات والاعتمادات وتعديلات السجلات في سجل يراجعه المسؤولون.", status: "available" },
  { icon: FileLock2, title: "تخزين خاص للملفات", text: "صور الفحوصات والتوقيعات والمستندات محفوظة بشكل خاص وتُفتح عبر روابط تنتهي صلاحيتها.", status: "available" },
  { icon: LockKeyhole, title: "تشفير أثناء النقل", text: "تطبيق الويب والتطبيق الميداني وواجهة البرمجة تعمل عبر HTTPS فقط.", status: "available" },
];

const LAYERS = [
  ["قاعدة البيانات تتحقق من كل قراءة.", "قواعد على مستوى الصف تقصر كل استعلام على شركتك والدول المسندة إليك، والتقييد حسب الموقع متاح."],
  ["التطبيق يتحقق من كل إجراء.", "تحدد الأدوار والصلاحيات الفردية الوحدات التي يفتحها الشخص ومن يعتمد، وتبقى المبالغ بعملة كل دولة."],
  ["السجل يحفظ الدليل.", "تُكتب عمليات الدخول وتغييرات الصلاحيات والاعتمادات في سجل تدقيق يراجعه المسؤولون."],
] as const;

const FAQ = [
  ["من يمكنه رؤية بياناتنا؟", "الحسابات التي يُعدّها فريقنا لشركتك فقط، وللدول المسندة لكل مستخدم فقط. تفرض قاعدة البيانات نطاق الدولة على كل استعلام، والتقييد حسب الموقع متاح."],
  ["هل يمكن لمستخدم موقع رؤية دولة أخرى؟", "لا. نطاق الدولة مطبق في قاعدة البيانات، فلا يعيد أي طلب مباشر شيئاً خارج دول المستخدم. ويُعدّ التقييد حسب الموقع معك."],
  ["هل تدعمون التحقق متعدد العوامل والدخول الموحد؟", "التحقق متعدد العوامل متاح للمسؤولين. والدخول الموحد يُعدّ عند الطلب بعد ربط مزوّد الهوية لديكم."],
] as const;

export default function ArabicSecurityPage() {
  const privacy = LEGAL_LINKS[0], deletion = LEGAL_LINKS[2];
  return <>
    <JsonLd data={faqSchema(FAQ, "/ar/security")} />
    <PageTop locale="ar" photo="engineer" photoPosition="35% 20%" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "الأمان وحماية البيانات" }]} title="بيانات أسطولك تبقى داخل شركتك ودولتك." lead="تُحدَّد الصلاحيات حسب الدور والدولة، وتفرض قاعدة البيانات نطاق الدولة على كل استعلام. التقييد حسب الموقع متاح. تعرض هذه الصفحة الضوابط الموجودة في المنتج اليوم." />
    <Section id="controls-ar" title="الضوابط الموجودة في المنتج اليوم.">
      <CardGrid cols={3}>{CONTROLS.map((c) => <Card key={c.title} locale="ar" {...c} />)}</CardGrid>
    </Section>
    <Section id="layers-ar" tone="soft" title="ثلاث طبقات تحقق على كل سجل." lead="بلاغ ميداني أو بطاقة عمل أو مطالبة، كلها تمر بالتحقق نفسه أياً كان من يفتحها.">
      <ol className="next-steps">{LAYERS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
    </Section>
    <Section id="data-ar" title="بياناتك وكيفية حذفها.">
      <div className="tp-prose">
        <p>سجلات شركتك ملك لشركتك. تُصدَّر السجلات إلى Excel وPDF، فيمكنك أخذ نسخة من بياناتك في أي وقت.</p>
        <p>يمكن للمستخدم طلب حذف حسابه من داخل التطبيق أو عبر <a className="linkish" href={deletion.href}>صفحة حذف البيانات</a>. وتوضح <a className="linkish" href={privacy.href}>سياسة الخصوصية</a> ما يُجمع ولماذا. (الصفحتان باللغة الإنجليزية.)</p>
        <p>لاستبيان أمني أو سؤال لا تجيب عنه هذه الصفحة، راسلنا على <a className="linkish" href={`mailto:${CONTACT_EMAIL}`} dir="ltr">{CONTACT_EMAIL}</a>.</p>
      </div>
    </Section>
    <Section id="faq-ar" tone="soft" title="ما تسأل عنه فرق الأمن.">
      <FaqList items={FAQ} />
    </Section>
    <CtaBand title="شاهد كيف يناسب تاير بالس أسطولك." text="عرض مبني على مواقعك وأصولك وتسلسل الموافقات لديك." button="احجز عرضاً" href="/ar/contact" />
  </>;
}
