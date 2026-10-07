"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type FormEvent } from "react";
import "./assistant.css";

/**
 * Anum, the Tyre Pulse guide. A scripted helper: every answer below is written by hand from
 * the site's own copy (home FAQ, pricing, security). There is no AI backend and no person
 * behind it, and the panel says so. Anything it cannot answer goes to WhatsApp or the form.
 */

type Lang = "en" | "ar";
type LinkOut = { href: string; label: string; external?: boolean };
type Msg = { id: number; from: "bot" | "user"; text: string; links?: LinkOut[] };
type IntentId = "demo" | "pricing" | "offline" | "import" | "countries" | "security" | "whatsapp";
type Intent = { id: IntentId; label: string; keywords: string[]; answer: string; links: LinkOut[] };

const SEEN_KEY = "tp-anum-greeted";
const GREET_DELAY_MS = 6000;

function readSeen(): boolean {
  try { return window.sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: the greeting may show again, harmless */ }
}

const COPY = {
  en: {
    greeting: "Hi, I'm Anum. How may I help you?",
    name: "Anum",
    role: "Tyre Pulse guide",
    intro: "Hi, I'm Anum, the Tyre Pulse guide. I answer common questions with set replies, I am not a live person. Pick a topic or type your question.",
    launcherOpen: "Open Anum, Tyre Pulse guide",
    launcherClose: "Close Anum, Tyre Pulse guide",
    close: "Close",
    dismiss: "Dismiss greeting",
    dialog: "Anum, Tyre Pulse guide",
    placeholder: "Type a question",
    send: "Send",
    inputLabel: "Your question",
    fallback: "I only have set answers for a few common questions, so I cannot answer that one well. The team can help directly.",
    fallbackNoWa: "I only have set answers for a few common questions, so I cannot answer that one well. Send it through the contact form and the team will reply.",
    contactLabel: "Use the contact form",
    waLabel: "Message us on WhatsApp",
  },
  ar: {
    greeting: "مرحبًا، أنا أنعم. كيف يمكنني مساعدتك؟",
    name: "أنعم",
    role: "دليل Tyre Pulse",
    intro: "مرحبًا، أنا أنعم، دليل Tyre Pulse. أجيب عن الأسئلة الشائعة بردود محددة مسبقًا، ولست شخصًا حقيقيًا. اختر موضوعًا أو اكتب سؤالك.",
    launcherOpen: "افتح أنعم، دليل Tyre Pulse",
    launcherClose: "أغلق أنعم، دليل Tyre Pulse",
    close: "إغلاق",
    dismiss: "إخفاء الترحيب",
    dialog: "أنعم، دليل Tyre Pulse",
    placeholder: "اكتب سؤالك",
    send: "إرسال",
    inputLabel: "سؤالك",
    fallback: "لدي ردود محددة لعدد قليل من الأسئلة الشائعة فقط، لذلك لا أستطيع الإجابة عن هذا السؤال جيدًا. يمكن للفريق مساعدتك مباشرة.",
    fallbackNoWa: "لدي ردود محددة لعدد قليل من الأسئلة الشائعة فقط، لذلك لا أستطيع الإجابة عن هذا السؤال جيدًا. أرسله عبر نموذج التواصل وسيرد الفريق.",
    contactLabel: "نموذج التواصل",
    waLabel: "راسلنا عبر واتساب",
  },
} as const;

function buildIntents(lang: Lang, wa: string | null): Intent[] {
  const ar = lang === "ar";
  const contact: LinkOut = { href: "/contact", label: ar ? "احجز عرضًا" : "Book a demo" };
  const list: Intent[] = [
    {
      id: "demo",
      label: ar ? "احجز عرضًا" : "Book a demo",
      keywords: ["demo", "book", "trial", "meeting", "call", "contact", "start", "عرض", "تجربة", "حجز", "احجز", "اجتماع", "تواصل"],
      answer: ar
        ? "أرسل لنا قائمة الأصول وشهرًا من أوامر العمل وسجلات الإطارات كما تصدرها من نظامك أو من Excel، ونعرض لك المنصة على بياناتك أنت. يكفي ملء النموذج وسيتواصل الفريق معك."
        : "Send an asset list, a month of job cards and your tyre records in the formats your ERP and Excel produce, and we show you the platform on your own data. Fill in the short form and the team gets back to you.",
      links: [contact],
    },
    {
      id: "pricing",
      label: ar ? "الأسعار" : "Pricing",
      keywords: ["price", "pricing", "cost", "quote", "plan", "plans", "how much", "subscription", "سعر", "الأسعار", "تكلفة", "عرض سعر", "اشتراك", "باقة"],
      answer: ar
        ? "لا توجد أسعار منشورة، لأن الأساطيل تختلف في عدد المعدات والمواقع والدول والتكاملات. يُبنى السعر على حجم الأسطول وعدد المستخدمين والوحدات والدول. أرسل حجم أسطولك ونرد عليك برقم. ويمكنك البدء بموقع واحد أو وحدة واحدة."
        : "There is no published price, because fleets differ by machine count, sites, countries and integrations. Pricing is based on fleet size, users, modules, countries and integrations. Send your fleet size and we reply with a figure. You can also start small, with one site or one module.",
      links: [{ href: "/pricing", label: ar ? "صفحة الأسعار" : "See pricing" }, contact],
    },
    {
      id: "offline",
      label: ar ? "هل يعمل دون اتصال؟" : "Does it work offline?",
      keywords: ["offline", "signal", "internet", "network", "connection", "no coverage", "sync", "اتصال", "إنترنت", "انترنت", "تغطية", "إشارة", "شبكة", "مزامنة"],
      answer: ar
        ? "نعم. الفحوصات والصور وقراءات العدادات والتوقيعات تُحفظ على الهاتف وتُزامن عند عودة الاتصال، لذلك تعمل المواقع ذات الإشارة الضعيفة دون انقطاع."
        : "Yes. Inspections, photos, meter readings and signatures save on the phone and sync when the connection returns, so sites with weak signal keep working.",
      links: [{ href: "/platform/inspections", label: ar ? "الفحوصات" : "See inspections" }],
    },
    {
      id: "import",
      label: ar ? "الاستيراد من ERP أو Excel" : "Can I import from ERP or Excel?",
      keywords: ["import", "erp", "excel", "spreadsheet", "csv", "upload", "migrate", "migration", "data", "استيراد", "إكسل", "اكسل", "ملف", "ترحيل", "بيانات", "رفع"],
      answer: ar
        ? "نعم. أوامر العمل والمصروفات وسجلات الإطارات وقوائم الأصول تُستورد من الملفات التي تصدرها بالفعل من نظام ERP أو Excel، ويتم فحص التكرار قبل إدخالها، وربط كل سطر بمعدة وموقع ودولة."
        : "Yes. Job cards, expenses, tyre records and asset lists import from the files you already export, with duplicates checked before they land, and every row is tied to a machine, a site and a country.",
      links: [contact],
    },
    {
      id: "countries",
      label: ar ? "الدول واللغة العربية" : "Which countries / Arabic?",
      keywords: ["country", "countries", "arabic", "english", "language", "currency", "ksa", "saudi", "uae", "egypt", "multi", "دولة", "دول", "عربي", "العربية", "لغة", "عملة", "السعودية", "الإمارات", "مصر"],
      answer: ar
        ? "يعمل Tyre Pulse عبر عدة دول، وكل دولة وموقع يرى سجلاته فقط وبعملته الخاصة، ويُطبَّق ذلك في قاعدة البيانات. العربية والإنجليزية مدعومتان، على الويب وعلى الهاتف."
        : "Tyre Pulse runs across more than one country. Each country and site sees only its own records, in its own currency, enforced in the database. Arabic and English are both supported, on the web and on the phone.",
      links: [{ href: "/industries", label: ar ? "القطاعات" : "See industries" }],
    },
    {
      id: "security",
      label: ar ? "الأمان" : "Security",
      keywords: ["security", "secure", "privacy", "access", "permission", "mfa", "sso", "audit", "safe", "أمان", "الأمان", "خصوصية", "صلاحيات", "صلاحية", "تدقيق", "حماية"],
      answer: ar
        ? "قاعدة البيانات تفحص كل قراءة، فلا يرى المستخدم إلا شركته ودوله ومواقعه المسموح بها. الأدوار والصلاحيات تحدد من ينشئ أو يعدّل أو يعتمد أو يصدّر، وسجل التدقيق يحفظ تسجيلات الدخول والاعتمادات والتصدير. المسؤولون يسجلون الدخول بعامل ثانٍ."
        : "The database checks every read, so a user sees only their company and the countries and sites they are assigned. Roles and per-user grants decide who can create, edit, approve or export, and an audit trail records sign-ins, approvals and exports. Administrators sign in with a second factor.",
      links: [{ href: "/security", label: ar ? "صفحة الأمان" : "See security" }],
    },
  ];
  if (wa) {
    list.push({
      id: "whatsapp",
      label: ar ? "تحدث عبر واتساب" : "Talk on WhatsApp",
      keywords: ["whatsapp", "whats app", "chat", "human", "person", "agent", "sales", "talk", "واتساب", "واتس", "شخص", "مبيعات", "تحدث", "محادثة"],
      answer: ar
        ? "يسعد الفريق بالتحدث معك عبر واتساب. افتح المحادثة وأرسل سؤالك أو حجم أسطولك."
        : "The team is happy to talk on WhatsApp. Open the chat and send your question or your fleet size.",
      links: [{ href: wa, label: ar ? "افتح واتساب" : "Open WhatsApp", external: true }],
    });
  }
  return list;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Best keyword match, or null. Counts keyword hits; ties go to the earlier intent. */
function matchIntent(text: string, intents: Intent[]): Intent | null {
  const q = ` ${norm(text)} `;
  let best: Intent | null = null;
  let bestScore = 0;
  for (const it of intents) {
    let score = 0;
    for (const k of it.keywords) if (q.includes(norm(k))) score += 1;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}

type Props = { arabic: boolean; tucked: boolean; whatsappUrl: string | null; children?: ReactNode };

export function AssistantWidget({ arabic, tucked, whatsappUrl, children }: Props) {
  const lang: Lang = arabic ? "ar" : "en";
  const t = COPY[lang];
  const intents = buildIntents(lang, whatsappUrl);

  const [open, setOpen] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The greeting appears once per session, a few seconds in, never over an open panel.
  useEffect(() => {
    if (readSeen()) return;
    const id = window.setTimeout(() => setBubble(true), GREET_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  const push = useCallback((m: Omit<Msg, "id">[]) => {
    setMsgs((prev) => [...prev, ...m.map((x) => ({ ...x, id: nextId.current++ }))]);
  }, []);

  const openPanel = () => {
    setBubble(false);
    markSeen();
    if (msgs.length === 0) push([{ from: "bot", text: t.intro }]);
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const dismissBubble = () => {
    setBubble(false);
    markSeen();
  };

  const answer = (it: Intent, userText: string) => {
    push([{ from: "user", text: userText }, { from: "bot", text: it.answer, links: it.links }]);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim().slice(0, 300);
    if (!text) return;
    setDraft("");
    const it = matchIntent(text, intents);
    if (it) return answer(it, text);
    const links: LinkOut[] = [{ href: "/contact", label: t.contactLabel }];
    if (whatsappUrl) links.unshift({ href: whatsappUrl, label: t.waLabel, external: true });
    push([{ from: "user", text }, { from: "bot", text: whatsappUrl ? t.fallback : t.fallbackNoWa, links }]);
  };

  // Escape closes; Tab stays inside the panel while it is open.
  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const hideDock = tucked && !open;

  return (
    <div className={`tp-dock${hideDock ? " is-tucked" : ""}${arabic ? " is-rtl" : ""}`} dir={arabic ? "rtl" : "ltr"} lang={lang}>
      {open ? (
        <div
          ref={panelRef}
          className="anum-panel"
          role="dialog"
          aria-modal="false"
          aria-label={t.dialog}
          aria-describedby={titleId}
          onKeyDown={onPanelKey}
        >
          <div className="anum-head">
            <span className="anum-avatar" aria-hidden="true">{arabic ? "أ" : "A"}</span>
            <div className="anum-who" id={titleId}>
              <b>{t.name}</b>
              <span>{t.role}</span>
            </div>
            <button ref={closeRef} type="button" className="anum-x" onClick={closePanel} aria-label={t.close}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>

          <div ref={logRef} className="anum-log" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={`anum-msg is-${m.from}`}>
                <p>{m.text}</p>
                {m.links && m.links.length > 0 ? (
                  <div className="anum-links">
                    {m.links.map((l) => l.external
                      ? <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                      : <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="anum-quick" role="group" aria-label={arabic ? "أسئلة سريعة" : "Quick questions"}>
            {intents.map((it) => (
              <button key={it.id} type="button" onClick={() => answer(it, it.label)}>{it.label}</button>
            ))}
          </div>

          <form className="anum-form" onSubmit={onSubmit}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.placeholder}
              aria-label={t.inputLabel}
              maxLength={300}
              autoComplete="off"
            />
            <button type="submit" aria-label={t.send} disabled={!draft.trim()}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="anum-send-ico"><path d="M3 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </div>
      ) : null}

      {!open && bubble ? (
        <div className="anum-bubble">
          <button type="button" className="anum-bubble-text" onClick={openPanel}>
            <span className="anum-avatar sm" aria-hidden="true">{arabic ? "أ" : "A"}</span>
            <span>{t.greeting}</span>
          </button>
          <button type="button" className="anum-bubble-x" onClick={dismissBubble} aria-label={t.dismiss}>
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        className="anum-launcher"
        aria-expanded={open}
        aria-label={open ? t.launcherClose : t.launcherOpen}
        onClick={() => (open ? closePanel() : openPanel())}
        tabIndex={hideDock ? -1 : undefined}
      >
        {open
          ? <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          : <span aria-hidden="true">{arabic ? "أ" : "A"}</span>}
      </button>

      {children}
    </div>
  );
}
