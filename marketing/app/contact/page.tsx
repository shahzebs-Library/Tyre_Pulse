import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { ContactForm } from "@/components/ContactForm";
import { CONTACT_EMAIL, WHATSAPP_URL } from "@/lib/site";

/* The form itself (validation, delivery, fallback to WhatsApp or email) is components/ContactForm. */
export default function ContactPage() {
  return <PageFrame>
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]} title="Book a demo on your own fleet." lead="Tell us how many assets, countries, sites and users you manage. The walkthrough covers the workflows and controls that matter to you." cta={false} />
    <section className="section-pad tight"><div className="site-shell contact-layout"><div className="card form-card">
      <ContactForm />
    </div>
    <aside className="contact-aside" aria-labelledby="next-h">
      <h2 id="next-h">What happens next</h2>
      <ol className="next-steps">
        <li><b>We confirm a time.</b><span>A reply to your work email with a slot that suits your sites.</span></li>
        <li><b>You send a sample, if you like.</b><span>One month of job cards and tyre records is enough. It stays private to the demo.</span></li>
        <li><b>We walk through your own data.</b><span>Cost per km, open jobs and inspections, on your machines.</span></li>
      </ol>
      <div className="contact-direct">
        {WHATSAPP_URL && <a className="btn btn-dark" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" data-source="contact_aside">Message us on WhatsApp</a>}
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
