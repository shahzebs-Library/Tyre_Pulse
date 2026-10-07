"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type FormEvent } from "react";
import { track } from "@/lib/track";
import { ANUM_OPEN_EVENT } from "./MobileActionBar";
import { AnumAvatar } from "./AnumAvatar";
import { CONTACT_EMAIL } from "@/lib/site";
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
    minimize: "Minimize",
    restore: "Restore",
    maximize: "Maximize",
    unmaximize: "Restore size",
    more: "More options",
    newChat: "Start a new conversation",
    copyChat: "Copy conversation",
    emailChat: "Email this conversation",
    copied: "Conversation copied.",
    copyFailed: "Could not copy. Select the text and copy it instead.",
    emailSubject: "Question from the Tyre Pulse website",
    you: "You",
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
    minimize: "تصغير",
    restore: "استعادة",
    maximize: "تكبير",
    unmaximize: "استعادة الحجم",
    more: "خيارات إضافية",
    newChat: "بدء محادثة جديدة",
    copyChat: "نسخ المحادثة",
    emailChat: "إرسال المحادثة بالبريد",
    copied: "تم نسخ المحادثة.",
    copyFailed: "تعذر النسخ. حدد النص وانسخه يدويًا.",
    emailSubject: "سؤال من موقع Tyre Pulse",
    you: "أنت",
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
  // Window state of the open panel: normal, minimized to its header, or maximized.
  const [size, setSize] = useState<"normal" | "min" | "max">("normal");
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const nextId = useRef(1);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Where focus goes back to on close: the launcher on desktop, the bottom bar button on phones.
  const returnRef = useRef<HTMLElement | null>(null);
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

  const intro = t.intro;
  const openPanel = useCallback(() => {
    setBubble(false);
    markSeen();
    const active = document.activeElement;
    returnRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setMsgs((prev) => (prev.length === 0 ? [{ id: nextId.current++, from: "bot", text: intro }] : prev));
    setOpen(true);
    track("assistant_open");
  }, [intro]);

  // The phone bottom bar opens the guide through a window event (the launcher is hidden there).
  useEffect(() => {
    window.addEventListener(ANUM_OPEN_EVENT, openPanel);
    return () => window.removeEventListener(ANUM_OPEN_EVENT, openPanel);
  }, [openPanel]);

  const closePanel = () => {
    setOpen(false);
    setMenu(false);
    setSize("normal");
    const back = returnRef.current;
    // A hidden element (display: none) has no client rects; fall back to the launcher.
    if (back && back.isConnected && back.getClientRects().length > 0) back.focus();
    else launcherRef.current?.focus();
  };

  // Header controls. Closing keeps the conversation (reopening shows it again);
  // "New conversation" is the only thing that clears it.
  const toggleMin = () => { setMenu(false); setSize((s) => (s === "min" ? "normal" : "min")); };
  const toggleMax = () => { setMenu(false); setSize((s) => (s === "max" ? "normal" : "max")); };
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2600);
  };
  const transcript = () =>
    msgs.map((m) => `${m.from === "user" ? t.you : t.name}: ${m.text}`).join("\n\n");
  const newChat = () => {
    setMenu(false);
    setMsgs([{ id: nextId.current++, from: "bot", text: intro }]);
    setDraft("");
    setSize((s) => (s === "min" ? "normal" : s));
    track("assistant_new_chat");
  };
  const copyChat = async () => {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(transcript());
      flash(t.copied);
    } catch {
      flash(t.copyFailed);
    }
  };
  const emailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.emailSubject)}&body=${encodeURIComponent(transcript().slice(0, 1800))}`;

  // The menu closes on a click outside it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const root = panelRef.current?.querySelector(".anum-menu-wrap");
      if (root && !root.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

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
    if (e.key === "Escape") {
      e.preventDefault();
      // Escape steps back one level: menu, then maximized, then the panel itself.
      if (menu) { setMenu(false); menuBtnRef.current?.focus(); return; }
      if (size === "max") { setSize("normal"); return; }
      closePanel();
      return;
    }
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
          className={`anum-panel${size === "min" ? " is-min" : ""}${size === "max" ? " is-max" : ""}`}
          role="dialog"
          aria-modal="false"
          aria-label={t.dialog}
          aria-describedby={titleId}
          onKeyDown={onPanelKey}
        >
          <div className="anum-head">
            <span className="anum-avatar" aria-hidden="true"><AnumAvatar size={34} /></span>
            <div className="anum-who" id={titleId}>
              <b>{t.name}</b>
              <span>{t.role}</span>
            </div>
            <div className="anum-ctrls">
              <div className="anum-menu-wrap">
                <button
                  ref={menuBtnRef}
                  type="button"
                  className="anum-x"
                  aria-label={t.more}
                  title={t.more}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu((v) => !v)}
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor" /><circle cx="10" cy="10" r="1.6" fill="currentColor" /><circle cx="15.5" cy="10" r="1.6" fill="currentColor" /></svg>
                </button>
                {menu ? (
                  <div className="anum-menu" role="menu" aria-label={t.more}>
                    <button type="button" role="menuitem" onClick={newChat}>
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v3h3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {t.newChat}
                    </button>
                    <button type="button" role="menuitem" onClick={copyChat}>
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M4 13V5a2 2 0 0 1 2-2h7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
                      {t.copyChat}
                    </button>
                    <a role="menuitem" href={emailHref} onClick={() => setMenu(false)}>
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M3.5 6l6.5 5 6.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" /></svg>
                      {t.emailChat}
                    </a>
                    {whatsappUrl ? (
                      <a role="menuitem" href={whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>
                        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 16l1-3.2A6.5 6.5 0 1 1 7.6 15z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" /></svg>
                        {t.waLabel}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <button type="button" className="anum-x" onClick={toggleMin} aria-label={size === "min" ? t.restore : t.minimize} title={size === "min" ? t.restore : t.minimize}>
                {size === "min"
                  ? <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 14h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
              </button>
              <button type="button" className="anum-x anum-max-btn" onClick={toggleMax} aria-label={size === "max" ? t.unmaximize : t.maximize} title={size === "max" ? t.unmaximize : t.maximize}>
                {size === "max"
                  ? <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4H14.5A1.5 1.5 0 0 1 16 5.5V11.5A1.5 1.5 0 0 1 14.5 13H13" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
                  : <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>}
              </button>
              <button ref={closeRef} type="button" className="anum-x" onClick={closePanel} aria-label={t.close} title={t.close}>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
          {notice ? <p className="anum-notice" role="status">{notice}</p> : null}

          <div ref={logRef} className="anum-log" aria-live="polite" hidden={size === "min"}>
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

          <div className="anum-quick" hidden={size === "min"} role="group" aria-label={arabic ? "أسئلة سريعة" : "Quick questions"}>
            {intents.map((it) => (
              <button key={it.id} type="button" onClick={() => answer(it, it.label)}>{it.label}</button>
            ))}
          </div>

          <form className="anum-form" onSubmit={onSubmit} hidden={size === "min"}>
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
            <span className="anum-avatar sm" aria-hidden="true"><AnumAvatar size={26} /></span>
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
          : <span className="anum-launcher-face" aria-hidden="true"><AnumAvatar size={44} /></span>}
      </button>

      {children}
    </div>
  );
}
