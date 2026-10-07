"use client";

import { useState } from "react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CONTACT_EMAIL, WHATSAPP_URL } from "@/lib/site";
import { track } from "@/lib/track";

export default function ContactPage() {
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "ok" | "error">("");
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  // When delivery is down, the request is never lost: the visitor can send the same
  // details on WhatsApp or by email in one tap.
  const [fallback, setFallback] = useState<{ wa: string | null; mail: string } | null>(null);
  const bad = (f: string) => (invalid.includes(f) ? { "aria-invalid": true as const, "aria-describedby": "form-status" } : {});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const formElement = e.currentTarget;
    setSending(true);
    setTone("");
    setStatus("");
    setInvalid([]);
    setFallback(null);
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const summary = ["Demo request", `Name: ${payload.name ?? ""}`, `Email: ${payload.email ?? ""}`, ...(String(payload.phone ?? "").trim() ? [`Phone: ${String(payload.phone).trim()}`] : []), `Company: ${payload.company ?? ""}`, `Country: ${payload.country ?? ""}`, `Fleet size: ${payload.fleetSize ?? ""}`, `Industry: ${payload.industry ?? ""}`, String(payload.message ?? "")].join("\n");
    const offerFallback = () => setFallback({
      wa: WHATSAPP_URL ? `${WHATSAPP_URL}?text=${encodeURIComponent(summary)}` : null,
      mail: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Tyre Pulse demo request")}&body=${encodeURIComponent(summary)}`,
    });
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      setStatus(data.message || (res.ok ? "Request received." : "Unable to send the request."));
      setTone(res.ok ? "ok" : "error");
      const fields: string[] = Array.isArray(data.fields) ? data.fields.map(String) : [];
      setInvalid(fields);
      if (fields[0]) (formElement.elements.namedItem(fields[0]) as HTMLElement | null)?.focus();
      if (res.ok) { formElement.reset(); track("demo_request", { source: "contact_form" }); }
      else if (res.status >= 500) {
        setStatus("Our form could not deliver your request just now. Send the same details in one tap instead:");
        offerFallback();
      }
    } catch {
      setStatus("Unable to send the request. Send the same details in one tap instead:");
      setTone("error");
      offerFallback();
    } finally {
      setSending(false);
    }
  }

  return <PageFrame>
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]} title="Book a demo around your real operation." lead="Tell us how many assets, countries, sites and users you manage. The walkthrough focuses on the workflows and controls that matter to you." cta={false} />
    <section className="section-pad tight"><div className="site-shell contact-layout"><div className="card form-card">
      <form onSubmit={submit} onInput={(e) => { const n = (e.target as HTMLInputElement).name; if (invalid.includes(n)) setInvalid(invalid.filter((f) => f !== n)); }} className="form-grid">
        <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required minLength={2} maxLength={100} autoComplete="name" {...bad("name")} /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required maxLength={200} autoComplete="email" {...bad("email")} /></div>
        <div className="field"><label htmlFor="phone">Phone or WhatsApp <span style={{ fontWeight: 400 }}>(optional)</span></label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="+966 5x xxx xxxx" {...bad("phone")} /></div>
        <div className="field"><label htmlFor="company">Company</label><input id="company" name="company" required minLength={2} maxLength={160} autoComplete="organization" {...bad("company")} /></div>
        <div className="field"><label htmlFor="country">Country</label><select id="country" name="country" required defaultValue="" {...bad("country")}><option value="" disabled>Select country</option><option>Saudi Arabia</option><option>United Arab Emirates</option><option>Egypt</option><option>Other</option></select></div>
        <div className="field"><label htmlFor="fleetSize">Fleet size</label><select id="fleetSize" name="fleetSize" required defaultValue="" {...bad("fleetSize")}><option value="" disabled>Select range</option><option>1 to 25 assets</option><option>26 to 100 assets</option><option>101 to 500 assets</option><option>501 to 2,000 assets</option><option>2,000+ assets</option></select></div>
        <div className="field"><label htmlFor="industry">Industry</label><select id="industry" name="industry" defaultValue=""><option value="" disabled>Select industry</option><option>Construction</option><option>Transport & Logistics</option><option>Ready-Mix Concrete</option><option>Heavy Equipment Rental</option><option>Workshop / Service Centre</option><option>Other</option></select></div>
        <div className="field full"><label htmlFor="message">Which machines, and what problem?</label><textarea id="message" name="message" maxLength={2000} {...bad("message")} placeholder="For example: 120 mixers, tyre cost per km rising, inspections still on paper" /></div>
        <div className="field full" aria-hidden="true" style={{ position: "absolute", left: -10000 }}><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <div className="field full"><button className="btn btn-primary" type="submit" disabled={sending} aria-busy={sending}>{sending ? "Sending" : "Request a demo"}{sending && <span className="btn-spin" aria-hidden="true" />}</button><p className="form-note">Your information is used only to respond to this request.</p><p id="form-status" className={`form-status${tone ? ` is-${tone}` : ""}`} role="status" aria-live="polite">{status}</p>{fallback && <div className="form-fallback">{fallback.wa && <a className="btn btn-dark" href={fallback.wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact_fallback" })}>Send on WhatsApp</a>}<a className="btn btn-secondary" href={fallback.mail}>Send by email</a></div>}</div>
      </form>
    </div>
    <aside className="contact-aside" aria-labelledby="next-h">
      <h2 id="next-h">What happens next</h2>
      <ol className="next-steps">
        <li><b>We confirm a time.</b><span>A reply to your work email with a slot that suits your sites.</span></li>
        <li><b>You send a sample, if you like.</b><span>One month of job cards and tyre records is enough. It stays private to the demo.</span></li>
        <li><b>We walk through your own data.</b><span>Cost per km, open jobs and inspections, on your machines rather than a generic tour.</span></li>
      </ol>
      <div className="contact-direct">
        {WHATSAPP_URL && <a className="btn btn-dark" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact_aside" })}>Message us on WhatsApp</a>}
        <a className="btn-text" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </div>
    </aside>
    </div></section>
  </PageFrame>;
}
