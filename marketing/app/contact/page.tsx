"use client";

import { useState } from "react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { buildFallbackLinks, contactSummary, fallbackMessage, shouldOfferFallback } from "@/lib/contactFallback";
import { CONTACT_EMAIL, WHATSAPP_NUMBER, WHATSAPP_URL } from "@/lib/site";
import { track } from "@/lib/track";

const Req = () => <><span className="req" aria-hidden="true"> *</span><span className="sr-only"> (required)</span></>;
const Opt = () => <span className="opt"> (optional)</span>;

/** What to tell the visitor about each field the server refused. */
const FIELD_HELP: Record<string, string> = {
  name: "Enter your full name.",
  email: "Enter a work email address we can reply to.",
  phone: "Use digits, spaces and + only, or leave this empty.",
  company: "Enter your company name.",
  country: "Choose a country.",
  fleetSize: "Choose a fleet size.",
  message: "Shorten the message to 2,000 characters.",
};

export default function ContactPage() {
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "ok" | "error">("");
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  // The request is never lost: when the form cannot deliver, the visitor can send the
  // same details on WhatsApp or by email in one tap.
  const [fallback, setFallback] = useState<{ wa: string | null; mail: string } | null>(null);
  const bad = (f: string) => (invalid.includes(f) ? { "aria-invalid": true as const, "aria-describedby": `${f}-error` } : {});
  const help = (f: string) => invalid.includes(f) && <p className="field-error" id={`${f}-error`}>{FIELD_HELP[f] ?? "Check this field."}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const formElement = e.currentTarget;
    setSending(true);
    setTone("");
    setStatus("");
    setInvalid([]);
    setFallback(null);
    const payload = Object.fromEntries(new FormData(formElement).entries());
    const offerFallback = (code: number | null) => {
      setTone("error");
      setStatus(fallbackMessage(code));
      setFallback(buildFallbackLinks(contactSummary(payload), { whatsappNumber: WHATSAPP_NUMBER, email: CONTACT_EMAIL }));
    };
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus(data.message || "Request received.");
        setTone("ok");
        formElement.reset();
        track("demo_request", { source: "contact_form" });
      } else if (shouldOfferFallback(res.status)) {
        offerFallback(res.status);
      } else {
        const fields: string[] = Array.isArray(data.fields) ? data.fields.map(String) : [];
        setInvalid(fields);
        setTone("error");
        setStatus(fields.length ? "Some details need checking. The fields are marked above." : (data.message || "Unable to send the request."));
        if (fields[0]) (formElement.elements.namedItem(fields[0]) as HTMLElement | null)?.focus();
      }
    } catch {
      offerFallback(null);
    } finally {
      setSending(false);
    }
  }

  return <PageFrame>
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]} title="Book a demo on your own fleet." lead="Tell us how many assets, countries, sites and users you manage. The walkthrough covers the workflows and controls that matter to you." cta={false} />
    <section className="section-pad tight"><div className="site-shell contact-layout"><div className="card form-card">
      <form onSubmit={submit} onInput={(e) => { const n = (e.target as HTMLInputElement).name; if (invalid.includes(n)) setInvalid(invalid.filter((f) => f !== n)); }} className="form-grid">
        <p className="form-key">Fields marked <span className="req" aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are required.</p>
        <div className="field"><label htmlFor="name">Full name<Req /></label><input id="name" name="name" required minLength={2} maxLength={100} autoComplete="name" {...bad("name")} />{help("name")}</div>
        <div className="field"><label htmlFor="email">Work email<Req /></label><input id="email" name="email" type="email" required maxLength={200} autoComplete="email" {...bad("email")} />{help("email")}</div>
        <div className="field"><label htmlFor="phone">Phone or WhatsApp<Opt /></label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="+966 5x xxx xxxx" {...bad("phone")} />{help("phone")}</div>
        <div className="field"><label htmlFor="company">Company<Req /></label><input id="company" name="company" required minLength={2} maxLength={160} autoComplete="organization" {...bad("company")} />{help("company")}</div>
        <div className="field"><label htmlFor="country">Country<Req /></label><select id="country" name="country" required defaultValue="" {...bad("country")}><option value="" disabled>Select country</option><option>Saudi Arabia</option><option>United Arab Emirates</option><option>Egypt</option><option>Other</option></select>{help("country")}</div>
        <div className="field"><label htmlFor="fleetSize">Fleet size<Req /></label><select id="fleetSize" name="fleetSize" required defaultValue="" {...bad("fleetSize")}><option value="" disabled>Select range</option><option>1 to 25 assets</option><option>26 to 100 assets</option><option>101 to 500 assets</option><option>501 to 2,000 assets</option><option>2,000+ assets</option></select>{help("fleetSize")}</div>
        <div className="field"><label htmlFor="industry">Industry<Opt /></label><select id="industry" name="industry" defaultValue=""><option value="">Select industry</option><option>Construction</option><option>Transport & Logistics</option><option>Ready-Mix Concrete</option><option>Heavy Equipment Rental</option><option>Workshop / Service Centre</option><option>Other</option></select></div>
        <div className="field full"><label htmlFor="message">Which machines, and what problem?<Opt /></label><textarea id="message" name="message" maxLength={2000} {...bad("message")} placeholder="For example: 120 mixers, tyre cost per km rising, inspections still on paper" />{help("message")}</div>
        <div className="field full" aria-hidden="true" style={{ position: "absolute", left: -10000 }}><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <div className="field full"><button className="btn btn-primary" type="submit" disabled={sending} aria-busy={sending}>{sending ? "Sending" : "Request a demo"}{sending && <span className="btn-spin" aria-hidden="true" />}</button><p className="form-note">Your information is used only to respond to this request.</p><p id="form-status" className={`form-status${tone ? ` is-${tone}` : ""}`} role="status" aria-live="polite">{status}</p>{fallback && <div className="form-fallback">{fallback.wa && <a className="btn btn-dark" href={fallback.wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact_fallback" })}>Send on WhatsApp</a>}<a className="btn btn-secondary" href={fallback.mail}>Send by email</a></div>}</div>
      </form>
    </div>
    <aside className="contact-aside" aria-labelledby="next-h">
      <h2 id="next-h">What happens next</h2>
      <ol className="next-steps">
        <li><b>We confirm a time.</b><span>A reply to your work email with a slot that suits your sites.</span></li>
        <li><b>You send a sample, if you like.</b><span>One month of job cards and tyre records is enough. It stays private to the demo.</span></li>
        <li><b>We walk through your own data.</b><span>Cost per km, open jobs and inspections, on your machines.</span></li>
      </ol>
      <div className="contact-direct">
        {WHATSAPP_URL && <a className="btn btn-dark" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact_aside" })}>Message us on WhatsApp</a>}
        <a className="btn-text" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </div>
      <div className="contact-support">
        <h2>Already using Tyre Pulse?</h2>
        <p>For account access, sign-in, or app support, email our team. You can reach us here without signing in.</p>
        <a className="btn-text" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Tyre Pulse customer support")}`}>Contact customer support</a>
      </div>
    </aside>
    </div></section>
  </PageFrame>;
}
