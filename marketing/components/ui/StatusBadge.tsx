/**
 * Release state of a capability, shown wherever capabilities are listed.
 *
 *  - available:  in the product today.
 *  - on-request: set up per customer (an integration, an identity provider,
 *                agreed support terms). Real, but not switched on by default.
 *  - planned:    not released. Never shown beside a download or sign-up link.
 *
 * When the state of something is not certain, use "on-request", never "available".
 * The label text carries the meaning; the colour and dot only reinforce it.
 */
export type CapabilityStatus = "available" | "on-request" | "planned";

const LABEL: Record<CapabilityStatus, string> = {
  available: "Available",
  "on-request": "On request",
  planned: "Planned",
};

export function StatusBadge({ status, className }: { status: CapabilityStatus; className?: string }) {
  return (
    <span className={`tp-badge${className ? ` ${className}` : ""}`} data-status={status}>
      <i aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}

/** The three states with their meaning, for pages that list capabilities. */
export function StatusLegend() {
  return (
    <ul className="tp-legend" aria-label="What the status labels mean">
      <li><StatusBadge status="available" /> In the product today.</li>
      <li><StatusBadge status="on-request" /> Set up for your company when you ask for it.</li>
      <li><StatusBadge status="planned" /> Not released yet.</li>
    </ul>
  );
}
