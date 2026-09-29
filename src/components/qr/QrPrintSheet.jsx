/**
 * The sheet the browser prints. Rendered into document.body through a portal
 * so the print rule can hide the whole app with display:none (visibility:hidden
 * keeps the app's height and printed blank pages after the labels). Labels are
 * laid out one A4 page at a time on the SAME grid the PDF uses, with a fixed
 * label height, so a browser print and the PDF match sheet for sheet.
 */
import { createPortal } from 'react-dom'
import { chunkPages, printQrSize } from '../../lib/qrLabelLayout'

export default function QrPrintSheet({ entries = [], grid, showLogo = true, logoUrl = '' }) {
  if (typeof document === 'undefined' || !grid) return null
  const pages = chunkPages(entries, grid.perPage)
  const css = `
    #tp-qr-print { position: fixed; top: 0; left: -99999px; width: 210mm; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { background: #fff !important; }
      body > *:not(#tp-qr-print) { display: none !important; }
      #tp-qr-print { position: static !important; left: 0 !important; width: 210mm !important; display: block !important; }
      #tp-qr-print .qp-page {
        box-sizing: border-box; width: 210mm; height: 297mm; overflow: hidden;
        padding: ${grid.marginY}mm ${grid.marginX}mm;
        display: grid; grid-template-columns: repeat(${grid.cols}, ${grid.w}mm);
        grid-auto-rows: ${grid.h}mm; gap: ${grid.gap}mm; align-content: start;
        break-after: page; page-break-after: always;
      }
      #tp-qr-print .qp-page:last-child { break-after: auto; page-break-after: auto; }
      #tp-qr-print .qp-label {
        box-sizing: border-box; width: ${grid.w}mm; height: ${grid.h}mm; overflow: hidden;
        border: 0.4mm solid #16a34a; border-radius: 2.2mm; background: #fff;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      #tp-qr-print .qp-head {
        box-sizing: border-box; width: calc(100% - 5mm); height: 7mm; flex: none;
        display: flex; align-items: center; justify-content: center; border-bottom: 0.35mm solid #16a34a;
      }
      #tp-qr-print .qp-head img { max-width: 100%; max-height: 5.5mm; object-fit: contain; }
      #tp-qr-print .qp-head span { color: #16a34a; font: bold 6pt Arial, sans-serif; letter-spacing: 0.06em; }
      #tp-qr-print .qp-qr { flex: none; margin-top: 1.5mm; }
      #tp-qr-print .qp-id { margin: 0.8mm 2mm 0; font: bold 7.5pt monospace; color: #000; text-align: center; overflow-wrap: anywhere; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
      #tp-qr-print .qp-sub { margin: 0.3mm 2mm 0; font: 5.5pt Arial, sans-serif; color: #555; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 4mm); }
    }
  `
  return createPortal(
    <div id="tp-qr-print" aria-hidden="true">
      <style>{css}</style>
      {pages.map((page, p) => (
        <div className="qp-page" key={`p${p}`}>
          {page.map((item, i) => {
            const idLines = String(item.val || '').length > Math.floor(grid.w / 2.2) ? 2 : 1
            const qr = printQrSize(grid, { logo: showLogo, lines: (item.lines || []).length, idLines })
            return (
              <div className="qp-label" key={`${item.key}-${p}-${i}`}>
                {showLogo && (
                  <div className="qp-head">
                    {logoUrl ? <img src={logoUrl} alt="" crossOrigin="anonymous" /> : <span>TYRE PULSE</span>}
                  </div>
                )}
                {item.qr && <img className="qp-qr" src={item.qr} alt={`QR code for ${item.val}`} style={{ width: `${qr}mm`, height: `${qr}mm` }} />}
                <p className="qp-id">{item.val}</p>
                {(item.lines || []).map((l) => <p key={l} className="qp-sub">{l}</p>)}
              </div>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )
}
