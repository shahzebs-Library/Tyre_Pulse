import type { Metadata } from "next";
import { PageTop } from "@/components/PageTop";
import { ContactForm } from "@/components/ContactForm";
import { alternatesFor } from "../../schema";
import { CONTACT_EMAIL, OG_IMAGES, whatsappLink } from "@/lib/site";

const DESCRIPTION = "احجز عرضاً توضيحياً لتاير بالس على أسطولك. أخبرنا بعدد الأصول والدول والمواقع والمستخدمين، ونعرض لك ما يهم عملياتك.";

export const metadata: Metadata = {
  title: { absolute: "احجز عرضاً توضيحياً | تاير بالس" },
  description: DESCRIPTION,
  alternates: alternatesFor("/ar/contact"),
  openGraph: { images: OG_IMAGES, title: "احجز عرضاً توضيحياً | تاير بالس", description: DESCRIPTION, url: "/ar/contact", locale: "ar_SA", type: "website" },
};

const WA = whatsappLink("مرحباً تاير بالس، أود حجز عرض توضيحي.");

export default function ArabicContactPage() {
  return <>
    <PageTop locale="ar" crumbs={[{ href: "/ar", label: "الرئيسية" }, { label: "تواصل معنا" }]} title="احجز عرضاً توضيحياً على أسطولك." lead="أخبرنا بعدد الأصول والدول والمواقع والمستخدمين لديك، ويغطي العرض مسارات العمل والضوابط التي تهمك." cta={false} />
    <section className="section-pad tight"><div className="site-shell contact-layout"><div className="card form-card">
      <ContactForm locale="ar" />
    </div>
    <aside className="contact-aside" aria-labelledby="next-h">
      <h2 id="next-h">ما الذي يحدث بعد ذلك</h2>
      <ol className="next-steps">
        <li><b>نحدد موعداً.</b><span>رد على بريدك الإلكتروني للعمل بموعد يناسب مواقعك.</span></li>
        <li><b>ترسل عيّنة إن رغبت.</b><span>شهر واحد من بطاقات العمل وسجلات الإطارات يكفي، ويبقى خاصاً بالعرض.</span></li>
        <li><b>نستعرض بياناتك أنت.</b><span>التكلفة لكل كيلومتر والأعمال المفتوحة والفحوصات، على معداتك.</span></li>
      </ol>
      <div className="contact-direct">
        {WA && <a className="btn btn-dark" href={WA} target="_blank" rel="noopener noreferrer" data-source="contact_aside">راسلنا عبر واتساب</a>}
        <a className="btn-text" href={`mailto:${CONTACT_EMAIL}`} dir="ltr">{CONTACT_EMAIL}</a>
      </div>
      <div className="contact-support">
        <h2>تستخدم تاير بالس بالفعل؟</h2>
        <p>للدخول إلى الحساب أو تسجيل الدخول أو دعم التطبيق، راسل فريقنا بالبريد الإلكتروني. يمكنك التواصل معنا من هنا دون تسجيل الدخول.</p>
        <a className="btn-text" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Tyre Pulse customer support")}`}>تواصل مع دعم العملاء</a>
      </div>
    </aside>
    </div></section>
  </>;
}
