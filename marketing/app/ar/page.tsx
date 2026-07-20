import Image from "next/image";
import Link from "next/link";
import { BarChart3, CheckCircle2, ClipboardCheck, ShieldCheck, Truck, Wrench } from "lucide-react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hero3D } from "@/components/Hero3D";

const features = [
  [Truck, "إدارة دورة حياة الإطارات", "متابعة التركيب والفك والضغط وعمق النقشة والإصلاح والضمان والتكلفة لكل كيلومتر."],
  [Wrench, "إدارة الورش والصيانة", "متابعة أوامر العمل والتوقف وإنتاجية الفنيين وتأخير قطع الغيار وجودة الإصلاح."],
  [ClipboardCheck, "الفحوصات الميدانية", "نماذج للجوال مع الصور والقراءات والتوقيعات والمسودات والموافقات والعمل دون اتصال."],
  [BarChart3, "التقارير التنفيذية", "مؤشرات أداء وتقارير PDF وPowerPoint ولوحات عرض مباشرة للإدارة."],
  [ShieldCheck, "صلاحيات مؤسسية", "التحكم حسب الشركة والدولة والموقع والدور ونوع البيانات وصلاحية الموافقة."],
];

export default function ArabicPage() {
  return <div className="rtl"><Header /><main>
    <section className="hero"><div className="site-shell hero-grid">
      <div className="hero-copy"><span className="eyebrow">ذكاء الأسطول مبني على العمل الحقيقي</span><h1 className="display">تحكم في كل إطار. وافهم كل تكلفة.</h1><p className="lead">يربط تاير بالس بين دورة حياة الإطارات وصيانة الأسطول وإدارة الورش والفحوصات والموافقات والتقارير التنفيذية في منصة واحدة.</p><div className="hero-actions"><Link className="btn btn-primary" href="/contact">احجز عرضاً مخصصاً</Link><Link className="btn btn-secondary" href="/product">استكشف المنصة</Link></div><div className="hero-proof"><span><CheckCircle2 size={17} color="#0b9b6c" /> شركات ودول متعددة</span><span><CheckCircle2 size={17} color="#0b9b6c" /> فرق ميدانية وإدارية</span><span><CheckCircle2 size={17} color="#0b9b6c" /> العربية والإنجليزية</span></div></div>
      <div className="hero-stage"><Hero3D /><div className="floating-panel panel-one"><span className="muted">جاهزية الأسطول</span><strong>مؤشر مباشر</strong><span style={{ color: "var(--success)" }}>الهدف والاتجاه والانحراف</span></div><div className="floating-panel panel-two"><span className="muted">التحكم في التكلفة</span><strong>التكلفة لكل كيلومتر</strong><span>من الشراء إلى الإتلاف</span></div></div>
    </div></section>
    <section className="section"><div className="site-shell"><span className="eyebrow">منصة تشغيلية موحدة</span><h2 className="h2">مصممة للأعمال التي تنفذها فرقك فعلياً.</h2><p className="lead">تربط المنصة العمل الميداني والموافقات والمخزون والصيانة والتقارير بدلاً من إنشاء لوحات منفصلة وغير مترابطة.</p><div className="grid-3" style={{ marginTop: 32 }}>{features.map(([Icon,title,text]) => { const C = Icon as typeof Truck; return <article className="card feature-card" key={String(title)}><div className="icon-box"><C /></div><h3 className="h3">{String(title)}</h3><p>{String(text)}</p></article>; })}</div></div></section>
    <section className="section" style={{ background: "rgba(255,255,255,.58)" }}><div className="site-shell product-showcase"><div><span className="eyebrow">وضوح للإدارة</span><h2 className="h2">أرقام واضحة وقرارات أسرع.</h2><p className="lead">تعرض التقارير القيمة الحالية والهدف والانحراف والتكلفة والسبب الجذري والإجراء المطلوب دون قصص طويلة.</p></div><div className="product-window"><Image src="/screenshots/executive-report.png" alt="تقرير تنفيذي من تاير بالس" width={1600} height={900} /></div></div></section>
  </main><Footer /></div>;
}
