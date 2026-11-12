"use client";

import { useState } from "react";
import { CheckCircle2, PenLine } from "lucide-react";
import "./product.css";

/** Supervisor sign-off: press Sign and the signature is drawn on the record. */
export function SignOff() {
  const [signed, setSigned] = useState(false);
  return (
    <figure className="pd-card pd-sign" aria-label="Sample inspection sign-off">
      <figcaption className="pd-head">
        <span><b>Sign-off</b><small>INS-3F9A21C0 · MX-214</small></span>
        <span className="sample-tag">Sample data</span>
      </figcaption>
      <div className={`pd-sign-pad${signed ? " is-signed" : ""}`}>
        <svg viewBox="0 0 260 80" aria-hidden="true">
          <path pathLength="1" d="M12 56c14-30 24-38 30-22 5 14-12 30-8 12 6-26 26-30 30-10 3 14 10 6 18-6 8-12 16-10 16 4s10 8 20-4c8-10 18-8 20 2 2 9 12 6 22-2 12-10 30-12 48-8 14 3 28 2 40-4" />
        </svg>
        <span className="pd-sign-line" aria-hidden="true" />
      </div>
      <p className="pd-sign-status" role="status">
        {signed ? <><CheckCircle2 size={16} aria-hidden="true" /> Signed by S. Omar, supervisor, 09:18. The record is locked.</> : "Waiting for the supervisor's signature."}
      </p>
      <div className="pd-actions">
        <button type="button" className="pd-btn is-primary" disabled={signed} onClick={() => setSigned(true)}><PenLine size={15} aria-hidden="true" /> Sign and approve</button>
        <button type="button" className="pd-btn" disabled={!signed} onClick={() => setSigned(false)}>Clear</button>
      </div>
    </figure>
  );
}
