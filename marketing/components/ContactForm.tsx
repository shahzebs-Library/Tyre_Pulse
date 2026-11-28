"use client";

import { useState } from "react";
import { buildFallbackLinks, contactSummary, fallbackMessage, shouldOfferFallback } from "@/lib/contactFallback";
import { CONTACT_EMAIL, WHATSAPP_NUMBER } from "@/lib/site";
import { track } from "@/lib/track";

type Locale = "en" | "ar";

/**
 * The one request form on the site, in two variants and two languages:
 *  - demo:  the full demo request on the contact page;
 *  - quote: the short "get a quote" form on the pricing page. It posts to the same
 *           /api/contact route; the preferred pricing model travels in the message, so the
 *           server, its validation and the sales inbox need no change.
 * The request is never lost: when the form cannot deliver, the same details are offered as a
 * prefilled WhatsApp message and a prefilled email.
 */
const COPY = {
  en: {
    required: " (required)", optional: " (optional)", key: "Fields marked", keyTail: "are required.", keySr: "with an asterisk",
    name: "Full name", email: "Work email", phone: "Phone or WhatsApp", company: "Company", country: "Country", fleet: "Fleet size",
    industry: "Industry", message: "Which machines, and what problem?", messageQuote: "Anything we should know?",
    model: "How would you like to be priced?",
    selectCountry: "Select country", selectFleet: "Select range", selectIndustry: "Select industry", selectModel: "Not sure yet",
    countries: ["Saudi Arabia", "United Arab Emirates", "Egypt", "Other"],
    fleets: ["1 to 25 assets", "26 to 100 assets", "101 to 500 assets", "501 to 2,000 assets", "2,000+ assets"],
    industries: ["Construction", "Transport & Logistics", "Ready-Mix Concrete", "Heavy Equipment Rental", "Workshop / Service Centre", "Other"],
    models: ["Per vehicle", "Per user", "Per module bundle"],
    placeholder: "For example: 120 mixers, tyre cost per km rising, inspections still on paper",
    placeholderQuote: "For example: 3 sites, tyres and inspections first",
    send: "Request a demo", sendQuote: "Get my quote", sending: "Sending",
    note: "Your information is used only to respond to this request.",
    ok: "Thank you. We have your request and will reply to your work email.",
    okQuote: "Thank you. Your quote will reach your work email within one working day.",
    check: "Some details need checking. The fields are marked above.", failed: "Unable to send the request.",
    wa: "Send on WhatsApp", mail: "Send by email",
    help: {
      name: "Enter your full name.", email: "Enter a work email address we can reply to.", phone: "Use digits, spaces and + only, or leave this empty.",
      company: "Enter your company name.", country: "Choose a country.", fleetSize: "Choose a fleet size.", message: "Shorten the message to 2,000 characters.",
    } as Record<string, string>,
    checkField: "Check this field.",
    quotePrefix: "Quote request. Preferred pricing",
  },
  ar: {
    required: " (مطلوب)", optional: " (اختياري)", key: "الحقول المعلَّمة", keyTail: "مطلوبة.", keySr: "بنجمة",
    name: "الاسم الكامل", email: "البريد الإلكتروني للعمل", phone: "الهاتف أو واتساب", company: "الشركة", country: "الدولة", fleet: "حجم الأسطول",
    industry: "القطاع", message: "ما المعدات، وما المشكلة؟", messageQuote: "هل هناك ما ينبغي أن نعرفه؟",
    model: "كيف تفضّل أن يُحسب السعر؟",
    selectCountry: "اختر الدولة", selectFleet: "اختر النطاق", selectIndustry: "اختر القطاع", selectModel: "لم أقرر بعد",
    countries: ["السعودية", "الإمارات", "مصر", "دولة أخرى"],
    fleets: ["من 1 إلى 25 أصلاً", "من 26 إلى 100 أصل", "من 101 إلى 500 أصل", "من 501 إلى 2,000 أصل", "أكثر من 2,000 أصل"],
    industries: ["الإنشاءات", "النقل والخدمات اللوجستية", "الخرسانة الجاهزة", "تأجير المعدات الثقيلة", "ورشة أو مركز خدمة", "قطاع آخر"],
    models: ["لكل مركبة", "لكل مستخدم", "لكل باقة وحدات"],
    placeholder: "مثال: 120 خلاطة، وتكلفة الإطار لكل كيلومتر في ارتفاع، والفحوصات ما زالت ورقية",
    placeholderQuote: "مثال: ثلاثة مواقع، نبدأ بالإطارات والفحوصات",
    send: "اطلب عرضاً توضيحياً", sendQuote: "أرسل طلب عرض السعر", sending: "جارٍ الإرسال",
    note: "نستخدم بياناتك للرد على هذا الطلب فقط.",
    ok: "شكراً لك. وصلنا طلبك وسنرد على بريدك الإلكتروني للعمل.",
    okQuote: "شكراً لك. سيصلك عرض السعر على بريدك الإلكتروني خلال يوم عمل واحد.",
    check: "بعض البيانات تحتاج إلى مراجعة، والحقول المعنية معلَّمة أعلاه.", failed: "تعذّر إرسال الطلب.",
    wa: "أرسل عبر واتساب", mail: "أرسل بالبريد الإلكتروني",
    help: {
      name: "اكتب اسمك الكامل.", email: "اكتب بريداً إلكترونياً للعمل يمكننا الرد عليه.", phone: "استخدم الأرقام والمسافات و+ فقط، أو اترك الحقل فارغاً.",
      company: "اكتب اسم شركتك.", country: "اختر الدولة.", fleetSize: "اختر حجم الأسطول.", message: "اختصر الرسالة إلى 2,000 حرف.",
    } as Record<string, string>,
    checkField: "راجع هذا الحقل.",
    quotePrefix: "طلب عرض سعر. طريقة التسعير المفضلة",
  },
} as const;

const FALLBACK_AR: Record<string, string> = {
  "429": "أرسلت عدة طلبات خلال وقت قصير، لذا توقف النموذج لبضع دقائق. أرسل البيانات نفسها بلمسة واحدة:",
  null: "تعذّر وصول النموذج إلى الخادم. أرسل البيانات نفسها بلمسة واحدة:",
  other: "تعذّر على النموذج إرسال طلبك الآن. أرسل البيانات نفسها بلمسة واحدة:",
};

const Req = ({ label }: { label: string }) => <><span className="req" aria-hidden="true"> *</span><span className="sr-only">{label}</span></>;
const Opt = ({ label }: { label: string }) => <span className="opt">{label}</span>;

export function ContactForm({ locale = "en", variant = "demo", idPrefix = "" }: { locale?: Locale; variant?: "demo" | "quote"; idPrefix?: string }) {
  const t = COPY[locale];
  const quote = variant === "quote";
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "ok" | "error">("");
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [fallback, setFallback] = useState<{ wa: string | null; mail: string } | null>(null);
  const id = (f: string) => `${idPrefix}${f}`;
  const bad = (f: string) => (invalid.includes(f) ? { "aria-invalid": true as const, "aria-describedby": `${id(f)}-error` } : {});
  const help = (f: string) => invalid.includes(f) && <p className="field-error" id={`${id(f)}-error`}>{t.help[f] ?? t.checkField}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const formElement = e.currentTarget;
    setSending(true);
    setTone("");
    setStatus("");
    setInvalid([]);
    setFallback(null);
    const raw = Object.fromEntries(new FormData(formElement).entries()) as Record<string, string>;
    const { pricingModel, ...payload } = raw;
    if (quote) {
      payload.message = `${t.quotePrefix}: ${pricingModel || t.selectModel}.${payload.message ? `\n\n${payload.message}` : ""}`;
    }
    const offerFallback = (code: number | null) => {
      setTone("error");
      setStatus(locale === "ar" ? FALLBACK_AR[code === null ? "null" : code === 429 ? "429" : "other"] : fallbackMessage(code));
      setFallback(buildFallbackLinks(contactSummary(payload), { whatsappNumber: WHATSAPP_NUMBER, email: CONTACT_EMAIL }));
    };
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus(quote ? t.okQuote : t.ok);
        setTone("ok");
        formElement.reset();
        track(quote ? "quote_request" : "demo_request", { source: quote ? "pricing_form" : "contact_form", locale });
      } else if (shouldOfferFallback(res.status)) {
        offerFallback(res.status);
      } else {
        const fields: string[] = Array.isArray(data.fields) ? data.fields.map(String) : [];
        setInvalid(fields);
        setTone("error");
        setStatus(fields.length ? t.check : t.failed);
        if (fields[0]) (formElement.elements.namedItem(fields[0]) as HTMLElement | null)?.focus();
      }
    } catch {
      offerFallback(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} onInput={(e) => { const n = (e.target as HTMLInputElement).name; if (invalid.includes(n)) setInvalid(invalid.filter((f) => f !== n)); }} className="form-grid">
      <p className="form-key">{t.key} <span className="req" aria-hidden="true">*</span><span className="sr-only">{t.keySr}</span> {t.keyTail}</p>
      <div className="field"><label htmlFor={id("name")}>{t.name}<Req label={t.required} /></label><input id={id("name")} name="name" required minLength={2} maxLength={100} autoComplete="name" {...bad("name")} />{help("name")}</div>
      <div className="field"><label htmlFor={id("email")}>{t.email}<Req label={t.required} /></label><input id={id("email")} name="email" type="email" dir="ltr" required maxLength={200} autoComplete="email" {...bad("email")} />{help("email")}</div>
      {!quote && <div className="field"><label htmlFor={id("phone")}>{t.phone}<Opt label={t.optional} /></label><input id={id("phone")} name="phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="+966 5x xxx xxxx" {...bad("phone")} />{help("phone")}</div>}
      <div className="field"><label htmlFor={id("company")}>{t.company}<Req label={t.required} /></label><input id={id("company")} name="company" required minLength={2} maxLength={160} autoComplete="organization" {...bad("company")} />{help("company")}</div>
      <div className="field"><label htmlFor={id("country")}>{t.country}<Req label={t.required} /></label><select id={id("country")} name="country" required defaultValue="" {...bad("country")}><option value="" disabled>{t.selectCountry}</option>{t.countries.map((c) => <option key={c}>{c}</option>)}</select>{help("country")}</div>
      <div className="field"><label htmlFor={id("fleetSize")}>{t.fleet}<Req label={t.required} /></label><select id={id("fleetSize")} name="fleetSize" required defaultValue="" {...bad("fleetSize")}><option value="" disabled>{t.selectFleet}</option>{t.fleets.map((c) => <option key={c}>{c}</option>)}</select>{help("fleetSize")}</div>
      {quote
        ? <div className="field"><label htmlFor={id("pricingModel")}>{t.model}<Opt label={t.optional} /></label><select id={id("pricingModel")} name="pricingModel" defaultValue=""><option value="">{t.selectModel}</option>{t.models.map((c) => <option key={c}>{c}</option>)}</select></div>
        : <div className="field"><label htmlFor={id("industry")}>{t.industry}<Opt label={t.optional} /></label><select id={id("industry")} name="industry" defaultValue=""><option value="">{t.selectIndustry}</option>{t.industries.map((c) => <option key={c}>{c}</option>)}</select></div>}
      <div className="field full"><label htmlFor={id("message")}>{quote ? t.messageQuote : t.message}<Opt label={t.optional} /></label><textarea id={id("message")} name="message" maxLength={1800} rows={quote ? 3 : undefined} {...bad("message")} placeholder={quote ? t.placeholderQuote : t.placeholder} />{help("message")}</div>
      <div className="field full" aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" }}><label htmlFor={id("website")}>Website</label><input id={id("website")} name="website" tabIndex={-1} autoComplete="off" /></div>
      <div className="field full">
        <button className="btn btn-primary" type="submit" disabled={sending} aria-busy={sending}>{sending ? t.sending : quote ? t.sendQuote : t.send}{sending && <span className="btn-spin" aria-hidden="true" />}</button>
        <p className="form-note">{t.note}</p>
        <p className={`form-status${tone ? ` is-${tone}` : ""}`} role="status" aria-live="polite">{status}</p>
        {fallback && <div className="form-fallback">{fallback.wa && <a className="btn btn-dark" href={fallback.wa} target="_blank" rel="noopener noreferrer" data-source="contact_fallback">{t.wa}</a>}<a className="btn btn-secondary" href={fallback.mail}>{t.mail}</a></div>}
      </div>
    </form>
  );
}
