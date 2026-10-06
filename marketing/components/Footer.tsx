import Link from "next/link";
import { APP_STORE_URL } from "@/app/schema";
import { APP_URL, CONTACT_EMAIL, LEGAL_LINKS, WHATSAPP_URL } from "@/lib/site";
import { PLATFORM_PAGES } from "@/lib/nav";
import { Logo } from "./Logo";
import { StoreBadges } from "./StoreBadges";

const COPY = {
  en: {
    about: "One operational workspace for plant, machinery and vehicles: assets, workshop, field teams and stores.",
    mobile: "Mobile app",
    mobileText: "Inspections, meter readings and job cards from the yard, online or offline.",
    platform: "Platform",
    company: "Company",
    access: "Access",
    login: "Customer login",
    whatsapp: "WhatsApp sales",
    legal: "Legal",
    adminNote: "Company administration is inside the app.",
    company_links: [["/industries", "Industries"], ["/pricing", "Pricing"], ["/security", "Security"], ["/contact", "Contact"]],
    rights: "Tyre Pulse. All rights reserved.",
    sample: "Product screens on this site show illustrative sample data. Module availability depends on your plan.",
  },
  ar: {
    about: "مساحة عمل تشغيلية واحدة للمعدات والآليات والمركبات: الأصول والورشة والفرق الميدانية والمستودعات.",
    mobile: "تطبيق الجوال",
    mobileText: "الفحوصات وقراءات العدادات وبطاقات العمل من الموقع، مع الاتصال أو بدونه.",
    platform: "المنصة",
    company: "الشركة",
    access: "الدخول",
    login: "دخول العملاء",
    whatsapp: "المبيعات عبر واتساب",
    legal: "قانوني",
    adminNote: "إدارة الشركة تتم داخل التطبيق.",
    company_links: [["/industries", "القطاعات"], ["/pricing", "الأسعار"], ["/security", "الأمان"], ["/contact", "تواصل معنا"]],
    rights: "تاير بالس. جميع الحقوق محفوظة.",
    sample: "شاشات المنتج في هذا الموقع تعرض بيانات توضيحية. توفر الوحدات يعتمد على خطتك.",
  },
} as const;

/**
 * The column labels are not headings: every page's outline should be its own
 * content, not four copies of "Platform / Company / Access". Each column is a
 * labelled nav landmark instead, which is what a screen reader lists.
 */
export function Footer({ locale = "en" }: { locale?: "en" | "ar" }) {
  const ar = locale === "ar";
  const c = COPY[locale];
  return (
    <footer className="footer">
      <div className="site-shell">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="footer-text">{c.about}</p>
            <p className="footer-heading">{c.mobile}</p>
            <p className="footer-text">{c.mobileText}</p>
            <StoreBadges tone="dark" appStoreUrl={APP_STORE_URL} />
          </div>
          <nav aria-label={c.platform}>
            <p className="footer-heading" aria-hidden="true">{c.platform}</p>
            <div className="footer-links">
              {PLATFORM_PAGES.map((p) => <Link key={p.href} href={p.href}>{ar ? p.labelAr : p.label}</Link>)}
            </div>
          </nav>
          <nav aria-label={c.company}>
            <p className="footer-heading" aria-hidden="true">{c.company}</p>
            <div className="footer-links">
              {c.company_links.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
              {ar ? <Link href="/" lang="en">English</Link> : <Link href="/ar" lang="ar">العربية</Link>}
            </div>
          </nav>
          <nav aria-label={c.access}>
            <p className="footer-heading" aria-hidden="true">{c.access}</p>
            <div className="footer-links">
              <a href={APP_URL}>{c.login}</a>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              {WHATSAPP_URL && <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">{c.whatsapp}</a>}
              <span className="footer-note">{c.adminNote}</span>
            </div>
          </nav>
        </div>
        <div className="footer-bottom">
          <span><bdi>&copy; {new Date().getFullYear()}</bdi> {c.rights}</span>
          <nav className="footer-legal" aria-label={c.legal}>
            {LEGAL_LINKS.map((l) => <a key={l.href} href={l.href}>{ar ? l.labelAr : l.label}</a>)}
          </nav>
          <span className="footer-sample">{c.sample}</span>
        </div>
      </div>
    </footer>
  );
}
