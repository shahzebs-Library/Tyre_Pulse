/**
 * Release state of a capability, shown wherever capabilities are listed.
 *
 *  - available:  in the product today.
 *  - on-request: set up per customer (an integration, an identity provider,
 *                agreed support terms). Real, but not switched on by default.
 *  - in-review:  built and submitted to a store, waiting for the store's review.
 *                Not downloadable yet. Never shown beside a download link.
 *  - planned:    not released. Never shown beside a download or sign-up link.
 *
 * When the state of something is not certain, use "on-request", never "available".
 * The label text carries the meaning; the colour and dot only reinforce it.
 */
export type CapabilityStatus = "available" | "on-request" | "in-review" | "planned";

const LABEL: Record<CapabilityStatus, string> = {
  available: "Available",
  "on-request": "On request",
  "in-review": "Not yet available",
  planned: "Planned",
};

const LABEL_AR: Record<CapabilityStatus, string> = {
  available: "متاح",
  "on-request": "عند الطلب",
  "in-review": "غير متاح بعد",
  planned: "مخطط له",
};

export function StatusBadge({ status, className, locale = "en" }: { status: CapabilityStatus; className?: string; locale?: "en" | "ar" }) {
  return (
    <span className={`tp-badge${className ? ` ${className}` : ""}`} data-status={status}>
      <i aria-hidden="true" />
      {locale === "ar" ? LABEL_AR[status] : LABEL[status]}
    </span>
  );
}

/** The three states with their meaning, for pages that list capabilities. */
export function StatusLegend() {
  return (
    <ul className="tp-legend" aria-label="What the status labels mean">
      <li><StatusBadge status="available" /> In the product today.</li>
      <li><StatusBadge status="on-request" /> Set up for your company when you ask for it.</li>
      <li><StatusBadge status="in-review" /> Submitted to a store and waiting for its review.</li>
      <li><StatusBadge status="planned" /> Not released yet.</li>
    </ul>
  );
}
