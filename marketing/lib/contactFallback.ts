/**
 * What the contact form offers when it cannot deliver a request.
 *
 * Kept free of React and of lib/site.ts so the tests can load it on its own.
 * The form never loses a request: when delivery is down (5xx), when the visitor
 * has been rate limited (429) or when the network fails, the same details are
 * offered as a prefilled WhatsApp message and a prefilled email.
 */
export type ContactFields = Record<string, unknown>;

const text = (v: unknown) => String(v ?? "").trim();

/** The request as plain lines, in the order the sales inbox reads them. */
export function contactSummary(f: ContactFields): string {
  return [
    "Demo request",
    `Name: ${text(f.name)}`,
    `Email: ${text(f.email)}`,
    ...(text(f.phone) ? [`Phone: ${text(f.phone)}`] : []),
    `Company: ${text(f.company)}`,
    `Country: ${text(f.country)}`,
    `Fleet size: ${text(f.fleetSize)}`,
    ...(text(f.industry) ? [`Industry: ${text(f.industry)}`] : []),
    ...(text(f.message) ? [text(f.message)] : []),
  ].join("\n");
}

/** True for every outcome where the visitor should be handed another way to send the request. */
export function shouldOfferFallback(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/** The message shown above the fallback buttons, by outcome. */
export function fallbackMessage(status: number | null): string {
  if (status === 429) return "You have sent several requests in a short time, so the form is paused for a few minutes. Send the same details in one tap instead:";
  if (status === null) return "The form could not reach our server. Send the same details in one tap instead:";
  return "Our form could not deliver your request just now. Send the same details in one tap instead:";
}

/**
 * Prefilled WhatsApp and email links. The WhatsApp link is built from the bare
 * number: one "?text=" and nothing appended to an existing query string.
 */
export function buildFallbackLinks(summary: string, opts: { whatsappNumber: string | null; email: string }): { wa: string | null; mail: string } {
  const number = (opts.whatsappNumber ?? "").replace(/\D/g, "");
  return {
    wa: number ? `https://wa.me/${number}?text=${encodeURIComponent(summary)}` : null,
    mail: `mailto:${opts.email}?subject=${encodeURIComponent("Tyre Pulse demo request")}&body=${encodeURIComponent(summary)}`,
  };
}
