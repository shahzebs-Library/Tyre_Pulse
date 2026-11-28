import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BarChart3, Box, CircleDot, ClipboardCheck, FileCheck2, Fuel, Settings, ShieldCheck, Truck, Wrench } from "lucide-react";
import { CtaBand } from "@/components/CtaBand";
import { Photo } from "@/components/art/Photos";
import { FleetCostPanel } from "@/components/mock/Screens";
import { alternatesFor } from "../schema";
import { OG_IMAGES } from "@/lib/site";
import { ArProofStrip } from "./ArProofStrip";

export const metadata: Metadata = {
  title: { absolute: "تاير بالس | إدارة المعدات والآليات والمركبات" },
  description:
    "تاير بالس يربط أصول المعدات والآليات والمركبات بالورشة والفرق الميدانية والمستودعات في مساحة عمل تشغيلية واحدة، على الويب وأندرويد.",
  alternates: alternatesFor("/ar"),
  openGraph: { images: OG_IMAGES,
    title: "تاير بالس | تحكم كامل في عمليات المعدات والآليات والمركبات",
    description: "الأصول والورشة والفحوصات والمستودعات في مساحة عمل واحدة.",
    url: "/ar",
    locale: "ar_SA",
    alternateLocale: "en_US",
    type: "website",
  },
};

/* Mirrors the English home page modules, so both languages describe the same product. */
const MODULES = [
  [Truck, "دورة حياة الأسطول والأصول", "تتبع المعدات والآليات والمركبات من الشراء حتى الاستبعاد."],
  [Wrench, "الصيانة الوقائية (عند الطلب)", "خطط صيانة حسب الساعات أو الكيلومترات أو التاريخ، تُعَدّ عند الطلب وفق فترات الخدمة لديك."],
  [Settings, "الورشة وبطاقات العمل", "إدارة الأعمال والعمالة وقطع الغيار وخدمات الموردين الخارجيين."],
  [CircleDot, "دورة حياة الإطارات", "الفحص والتركيب والإزالة والتكلفة لكل كيلومتر أو ساعة تشغيل."],
  [ClipboardCheck, "الفحوصات والسلامة", "قوائم فحص على تطبيق أندرويد بالصور والقراءات والتوقيع، مع العمل دون اتصال."],
  [ShieldCheck, "الحوادث والتأمين", "تسجيل الحوادث وإدارة المطالبات ومتابعة بيانات التأمين."],
  [Box, "المستودعات وقطع الغيار", "مخزون كل موقع وصرف القطع على بطاقة العمل. طلبات الشراء تُفعَّل عند الطلب."],
  [Fuel, "تكاليف التشغيل", "تكاليف التشغيل حسب الأصل والموقع. سجلات الوقود تُفعَّل عند الطلب."],
] as const;

const STEPS = [
  ["الإبلاغ والفحص", "تسجيل العطل والتقاط الصور ونتائج الفحص من الموقع."],
  ["المراجعة والاعتماد", "مراجعة فنية وإضافة تفاصيل العمل واعتماد المهمة."],
  ["الإصلاح وصرف القطع", "إنجاز الإصلاح وصرف القطع من المستودع وتسجيل العمالة والتكلفة."],
  ["التحقق والإعادة للخدمة", "تأكيد إنجاز العمل وتحديث السجل وإعادة الأصل إلى التشغيل."],
] as const;

export default function ArabicPage() {
  return <>
      <section className="home-hero" aria-label="تاير بالس">
        <div className="site-shell">
          <div className="hc-stage">
            <div className="hc-slide is-on">
              <div className="hc-copy">
                <span className="kicker">المعدات والآليات والمركبات</span>
                <h1 className="hero-h1">تحكم كامل في عمليات أسطولك.</h1>
                <p className="hero-lead">اربط الأصول والورشة والفرق الميدانية والمستودعات في مساحة عمل تشغيلية واحدة.</p>
                <div className="hero-cta">
                  <Link className="btn btn-primary" href="/ar/contact" data-source="hero">احجز عرضاً <ArrowLeft size={18} aria-hidden="true" /></Link>
                  <Link className="btn-text" href="/ar/platform">تعرّف على المنصة <ArrowLeft size={17} aria-hidden="true" /></Link>
                </div>
              </div>
              <div className="hc-visual">
                <div className="hc-photo"><Photo name="riyadh" position="30% 100%" alt="محمل بعجلات أمام أفق مدينة الرياض ليلاً" sizes="(max-width: 900px) 100vw, 640px" priority /></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ArProofStrip />

      <section className="section-pad" aria-labelledby="ar-flow">
        <div className="site-shell">
          <h2 className="sec-h" id="ar-flow">من بلاغ في الموقع إلى مهمة مغلقة.</h2>
          <ol className="ar-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="ar-step-n" aria-hidden="true">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section-pad" style={{ paddingTop: 0 }} aria-labelledby="ar-modules">
        <div className="site-shell">
          <h2 className="sec-h" id="ar-modules">الصورة الكاملة لعملياتك.</h2>
          <ul className="module-grid">
            {MODULES.map(([Icon, title, text]) => (
              <li key={title}>
                <Icon size={32} strokeWidth={1.6} aria-hidden="true" />
                <div><h3>{title}</h3><p>{text}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-pad" style={{ paddingTop: 0 }} aria-labelledby="ar-cost">
        <div className="site-shell ar-split">
          <div>
            <h2 className="sec-h" id="ar-cost">أرقام واضحة لكل موقع.</h2>
            <p className="lead">تكلفة التشغيل والصيانة والجاهزية لكل أصل وموقع، بعملة كل دولة ودون خلط بين العملات.</p>
            <ul className="ar-points">
              <li><FileCheck2 size={18} aria-hidden="true" /> تقارير PDF وExcel وPowerPoint</li>
              <li><BarChart3 size={18} aria-hidden="true" /> لوحات عرض مباشرة للإدارة والشاشات</li>
              <li><ShieldCheck size={18} aria-hidden="true" /> صلاحيات حسب الدور والدولة، مع إمكانية التقييد حسب الموقع</li>
            </ul>
          </div>
          {/* The product ships in English and Arabic; this sample screen is the English interface. */}
          <div className="hc-panel" dir="ltr" lang="en"><FleetCostPanel /></div>
        </div>
      </section>
    <CtaBand title="شاهد كيف يناسب تاير بالس أسطولك." text="عرض مبني على مواقعك وأصولك وتسلسل الموافقات لديك." button="احجز عرضاً" href="/ar/contact" />
  </>;
}
