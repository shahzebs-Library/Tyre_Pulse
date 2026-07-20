"use client";

import { useState } from "react";
import { PageFrame } from "@/components/PageFrame";

export default function ContactPage() {
  const [status, setStatus] = useState<string>("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("Sending…");
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    setStatus(data.message || (res.ok ? "Request received." : "Unable to send the request."));
    if (res.ok) e.currentTarget.reset();
  }

  return <PageFrame>
    <section className="page-hero"><div className="site-shell"><span className="eyebrow">Talk to Tyre Pulse</span><h1 className="display">Book a demo around your real operation.</h1><p className="lead">Tell us how many assets, countries, sites and users you manage. The walkthrough will focus on the workflows and controls that matter to you.</p></div></section>
    <section className="page-content"><div className="site-shell"><div className="card" style={{ maxWidth: 860, margin: "0 auto", padding: 30 }}>
      <form onSubmit={submit} className="form-grid">
        <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required autoComplete="name" /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
        <div className="field"><label htmlFor="company">Company</label><input id="company" name="company" required autoComplete="organization" /></div>
        <div className="field"><label htmlFor="country">Country</label><select id="country" name="country" required defaultValue=""><option value="" disabled>Select country</option><option>Saudi Arabia</option><option>United Arab Emirates</option><option>Egypt</option><option>Other</option></select></div>
        <div className="field"><label htmlFor="fleetSize">Fleet size</label><select id="fleetSize" name="fleetSize" defaultValue=""><option value="" disabled>Select range</option><option>1–25 assets</option><option>26–100 assets</option><option>101–500 assets</option><option>501–2,000 assets</option><option>2,000+ assets</option></select></div>
        <div className="field"><label htmlFor="industry">Industry</label><select id="industry" name="industry" defaultValue=""><option value="" disabled>Select industry</option><option>Construction</option><option>Transport & Logistics</option><option>Ready-Mix Concrete</option><option>Heavy Equipment Rental</option><option>Workshop / Service Centre</option><option>Other</option></select></div>
        <div className="field full"><label htmlFor="message">What do you want to improve?</label><textarea id="message" name="message" placeholder="Tyre cost, inspections, workshops, approvals, reports, multi-country control…" /></div>
        <div className="field full" aria-hidden="true" style={{ position: "absolute", left: -10000 }}><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <div className="field full"><button className="btn btn-primary" type="submit">Request a tailored demo</button><p className="form-note">Your information is used only to respond to this request.</p><p aria-live="polite">{status}</p></div>
      </form>
    </div></div></section>
  </PageFrame>;
}
