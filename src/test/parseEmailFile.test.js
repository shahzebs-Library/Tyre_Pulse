import { describe, it, expect } from 'vitest'
import {
  decodeQuotedPrintable, stripHtml, parseMime, looksLikeMime, emailTextFromRaw,
} from '../lib/import/parseEmailFile'

describe('decodeQuotedPrintable', () => {
  it('joins soft breaks and decodes hex bytes', () => {
    expect(decodeQuotedPrintable('claim =\r\nrejected')).toBe('claim rejected')
    expect(decodeQuotedPrintable('fee =3D 5%')).toBe('fee = 5%')
  })
})

describe('stripHtml', () => {
  it('turns block tags into newlines and decodes entities', () => {
    const out = stripHtml('<p>Claim <b>rejected</b></p><div>Reason&nbsp;&amp; clause</div><script>x()</script>')
    expect(out).toContain('Claim rejected')
    expect(out).toContain('Reason & clause')
    expect(out).not.toContain('x()')
  })
})

describe('parseMime', () => {
  it('reads a simple text/plain message body', () => {
    const eml = [
      'From: insurer@example.com',
      'Subject: Claim decision',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'We regret the claim is rejected as the repair began before approval.',
    ].join('\r\n')
    expect(parseMime(eml).text).toContain('rejected as the repair began before approval')
  })

  it('prefers the text/plain part of a multipart message', () => {
    const b = 'BOUND123'
    const eml = [
      'Content-Type: multipart/alternative; boundary="' + b + '"',
      '',
      '--' + b,
      'Content-Type: text/plain',
      '',
      'PLAIN: claim delayed pending NAJM report.',
      '--' + b,
      'Content-Type: text/html',
      '',
      '<p>HTML: claim delayed</p>',
      '--' + b + '--',
      '',
    ].join('\r\n')
    const out = parseMime(eml).text
    expect(out).toContain('PLAIN: claim delayed pending NAJM report.')
  })

  it('decodes a base64 text part', () => {
    const body = Buffer.from('Approved under own-damage cover.', 'utf-8').toString('base64')
    const eml = [
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      body,
    ].join('\r\n')
    expect(parseMime(eml).text).toContain('Approved under own-damage cover.')
  })

  it('falls back to the html part when there is no plain part', () => {
    const b = 'B2'
    const eml = [
      'Content-Type: multipart/mixed; boundary="' + b + '"',
      '',
      '--' + b,
      'Content-Type: text/html',
      '',
      '<div>Only HTML body here</div>',
      '--' + b + '--',
    ].join('\r\n')
    expect(parseMime(eml).text).toContain('Only HTML body here')
  })
})

describe('looksLikeMime', () => {
  it('detects an email header block and rejects plain prose', () => {
    expect(looksLikeMime('Subject: hi\r\nFrom: a@b\r\n\r\nbody')).toBe(true)
    expect(looksLikeMime('just some pasted text with no headers')).toBe(false)
  })
})

describe('emailTextFromRaw', () => {
  it('routes by extension', () => {
    expect(emailTextFromRaw('<p>hello world</p>', 'html')).toBe('hello world')
    expect(emailTextFromRaw('plain note', 'txt')).toBe('plain note')
    const eml = 'Content-Type: text/plain\r\n\r\nrejected body'
    expect(emailTextFromRaw(eml, 'eml')).toContain('rejected body')
  })

  it('sniffs content for an unknown extension', () => {
    expect(emailTextFromRaw('<html><body>sniffed html</body></html>', '')).toContain('sniffed html')
  })
})
