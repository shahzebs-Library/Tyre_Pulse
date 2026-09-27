/**
 * The HTML body of the "inspection approval required" e-mail.
 *
 * Moved out of src/pages/Inspections.jsx unchanged in layout. One behaviour
 * change, on purpose: every interpolated value is HTML-escaped. The notes and
 * site are free text typed on the checklist, and they went into the e-mail raw,
 * so a note containing markup rendered as markup in the approver's inbox. The
 * signature is accepted only as an image data URL for the same reason.
 */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildApprovalEmailHtml({ assetNo, inspector, date, site, odometer, hourMeter, notes, approvalLink, signature }) {
  const safeSig = typeof signature === 'string' && /^data:image\/(png|jpe?g|svg\+xml);/i.test(signature) ? signature : null
  const link = esc(approvalLink)
  const sigBlock = safeSig
    ? `<img src="${esc(safeSig)}" alt="Inspector Signature" style="max-width:220px;border:1px solid #e5e7eb;border-radius:8px;margin-top:8px;" />`
    : '<p style="color:#9ca3af;font-style:italic;">No digital signature captured</p>'

  const rows = [
    ['Asset / Vehicle', assetNo || '-'],
    ['Inspection Date', date || '-'],
    ['Site', site || '-'],
    ['Inspector', inspector || '-'],
    odometer ? ['Odometer (km)', odometer] : null,
    hourMeter ? ['Hour Meter (hrs)', hourMeter] : null,
  ].filter(Boolean)

  const tableRows = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 12px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">${esc(k)}</td>
      <td style="padding:8px 12px;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #f3f4f6;">${esc(v)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:20px;">🔍</span>
        </div>
        <div>
          <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">Tyre Pulse</h1>
          <p style="margin:0;color:#bbf7d0;font-size:13px;">Inspection Approval Request</p>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">Your approval is required</p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
        An inspection checklist has been submitted and requires your review and digital signature before it can be finalised.
      </p>

      <!-- Details table -->
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f9fafb;padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspection Details</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
      </div>

      ${notes ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#166534;">Inspector Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;">${esc(notes)}</p>
      </div>` : ''}

      <!-- Inspector Signature -->
      <div style="margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspector Signature</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          ${sigBlock}
        </div>
      </div>

      <!-- CTA -->
      <a href="${link}"
        style="display:block;text-align:center;background:#15803d;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:16px;">
        Review &amp; Sign Inspection →
      </a>

      <p style="margin:0;text-align:center;color:#9ca3af;font-size:12px;">
        This link requires you to be logged in to Tyre Pulse.<br>
        If the button doesn't work, copy this URL: <span style="color:#15803d;word-break:break-all;">${link}</span>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Tyre Pulse Fleet Intelligence · This is an automated message</p>
    </div>
  </div>
</body>
</html>`
}
