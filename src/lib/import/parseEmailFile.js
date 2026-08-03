/**
 * parseEmailFile - turn an uploaded email/document into plain body text for the
 * insurer-email analyzer, so the user can drop the email straight in instead of
 * printing it to PDF first.
 *
 * Supported (Outlook "Save As" / drag-out formats):
 *   .eml / .mht / .mht   MIME message (multipart, base64 / quoted-printable, text
 *                        or HTML) - parsed here.
 *   .html / .htm         HTML body - tags stripped to text.
 *   .txt                 plain text - used as-is.
 *   .pdf                 delegated to parsePdf.extractPdfLines.
 * Outlook binary .msg is NOT supported (OLE compound format) - the caller shows a
 * friendly message telling the user to Save As .txt/.html or forward as PDF.
 *
 * The MIME/HTML helpers are pure (string -> string) so they are unit-testable
 * without a browser. ASCII-safe output; nothing is fabricated - an empty body
 * returns '' and the analyzer reports "no readable text".
 */

// ── low-level decoders ────────────────────────────────────────────────────────
function decodeBase64ToText(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '')
  if (!clean) return ''
  let bytes
  try {
    if (typeof atob === 'function') {
      const bin = atob(clean)
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } else {
      // node/test fallback
      // eslint-disable-next-line no-undef
      bytes = Uint8Array.from(Buffer.from(clean, 'base64'))
    }
  } catch {
    return ''
  }
  try { return new TextDecoder('utf-8').decode(bytes) } catch { return '' }
}

/** Byte-accurate quoted-printable decode (UTF-8 aware). */
export function decodeQuotedPrintable(str) {
  const s = String(str || '').replace(/=\r?\n/g, '')
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(s.charCodeAt(i) & 0xff)
    }
  }
  try { return new TextDecoder('utf-8').decode(Uint8Array.from(bytes)) } catch { return s }
}

/** Strip HTML to readable plain text (block tags -> newlines, entities decoded). */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── MIME parsing ──────────────────────────────────────────────────────────────
function parseHeaders(block) {
  const headers = {}
  const unfolded = String(block || '').replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
  }
  return headers
}

function boundaryOf(contentType) {
  const m = /boundary\s*=\s*("([^"]+)"|([^;]+))/i.exec(contentType || '')
  return m ? (m[2] || m[3] || '').trim() : ''
}

function decodePart(headers, body) {
  const cte = (headers['content-transfer-encoding'] || '').toLowerCase()
  let text = body
  if (cte === 'base64') text = decodeBase64ToText(body)
  else if (cte === 'quoted-printable') text = decodeQuotedPrintable(body)
  const ct = headers['content-type'] || 'text/plain'
  if (/text\/html/i.test(ct)) return { type: 'html', text: stripHtml(text) }
  return { type: 'text', text: String(text).trim() }
}

/**
 * Parse a raw MIME message (or MIME part) and return the best plain-text body.
 * Prefers a non-empty text/plain part, else a stripped text/html part.
 */
export function parseMime(raw) {
  const src = String(raw || '')
  const split = src.match(/\r?\n\r?\n/)
  const headerBlock = split ? src.slice(0, split.index) : ''
  const body = split ? src.slice(split.index + split[0].length) : src
  const headers = parseHeaders(headerBlock)
  const ct = headers['content-type'] || 'text/plain'

  if (/multipart\//i.test(ct)) {
    const boundary = boundaryOf(ct)
    if (boundary) {
      const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?\\r?\\n?`))
      const results = []
      for (const part of parts) {
        if (!part || !part.trim()) continue
        // Only recurse into things that look like a MIME part (have a header block).
        if (!/\r?\n\r?\n/.test(part) && !/^content-/im.test(part)) continue
        results.push(parseMime(part))
      }
      const plain = results.find((r) => r.type === 'text' && r.text)
      if (plain) return plain
      const html = results.find((r) => r.type === 'html' && r.text)
      if (html) return html
      const any = results.find((r) => r.text)
      if (any) return any
      return { type: 'text', text: '' }
    }
  }
  return decodePart(headers, body)
}

/** True when raw text looks like an email/MIME message (has header lines). */
export function looksLikeMime(raw) {
  const head = String(raw || '').slice(0, 4000)
  if (!/\r?\n\r?\n/.test(head) && !/^content-type:/im.test(head)) return false
  return /^(mime-version|content-type|from|to|subject|date|received)\s*:/im.test(head)
}

/** Route raw text (already read from an .eml/.mht/.html/.txt file) to plain text. */
export function emailTextFromRaw(raw, ext = '') {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  if (e === 'eml' || e === 'mht' || e === 'mht') return parseMime(raw).text
  if (e === 'html' || e === 'htm') return stripHtml(raw)
  if (e === 'txt') return String(raw || '').trim()
  // unknown extension: sniff the content
  if (looksLikeMime(raw)) return parseMime(raw).text
  if (/<html|<body|<div|<p[ >]/i.test(String(raw).slice(0, 2000))) return stripHtml(raw)
  return String(raw || '').trim()
}

function extOf(name) {
  const m = /\.([a-z0-9]+)\s*$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

export const EMAIL_UPLOAD_ACCEPT = '.pdf,.eml,.mht,.mht,.html,.htm,.txt,application/pdf,message/rfc822,text/html,text/plain'

/**
 * Extract analyzable body text from an uploaded email/document File.
 * Throws a friendly Error for unsupported Outlook .msg binaries.
 * @returns {Promise<string>} plain text (trimmed; '' when nothing readable)
 */
export async function extractEmailText(file) {
  if (!file) return ''
  const ext = extOf(file.name)
  const type = String(file.type || '').toLowerCase()

  if (ext === 'msg') {
    throw new Error('Outlook .msg files cannot be read directly. In Outlook use File > Save As and choose "Text Only (*.txt)" or "HTML", or print the email to PDF, then upload that.')
  }

  if (ext === 'pdf' || type === 'application/pdf') {
    const { extractPdfLines } = await import('./parsePdf')
    const lines = await extractPdfLines(file)
    return (Array.isArray(lines) ? lines : []).join('\n').trim()
  }

  const raw = await file.text()
  return emailTextFromRaw(raw, ext).trim()
}
