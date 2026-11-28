// Tyre Pulse email renderer. Pure: same input -> same output; no network, no env.
// The dispatcher passes appStoreUrl only when APP_STORE_URL is configured, so the
// App Store badge never points at a store page that does not exist yet.
import { BRAND } from './brand.ts'
import { appLink, safeLink, settingsLink } from './links.ts'
import { cleanText, escapeHtml, stripCrLf } from './escape.ts'
import { COMMON, DIGEST_SECTIONS, TEMPLATES, severityLabel, stageLabel, type Audience, type FieldDef, type Locale } from './templates.ts'

export type RenderInput = {
  template: string
  locale?: string | null
  data?: Record<string, unknown> | null
  entityType?: string | null
  entityId?: string | null
  audience?: Audience
  appStoreUrl?: string | null
  baseUrl?: string | null
}
export type RenderedEmail = { subject: string; html: string; text: string; locale: Locale; optional: boolean }

export function normaliseLocale(raw: unknown): Locale {
  // ur / hi and anything unknown fall back to English.
  return String(raw || '').toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

function formatValue(field: FieldDef, raw: unknown, locale: Locale): string {
  if (raw === null || raw === undefined || raw === '') return ''
  if (field.format === 'date' || field.format === 'datetime') {
    const d = new Date(String(raw))
    if (Number.isNaN(d.getTime())) return cleanText(raw, 60)
    const opts: Intl.DateTimeFormatOptions = field.format === 'date'
      ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' }
      : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', opts).format(d)
  }
  return cleanText(raw, 1500)
}

function enrich(data: Record<string, unknown>, locale: Locale): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  if (out.stage !== undefined && out.stage_label === undefined) out.stage_label = stageLabel(out.stage, locale)
  if (out.severity !== undefined && out.severity_label === undefined) out.severity_label = severityLabel(out.severity, locale)
  return out
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const tpl = TEMPLATES[input.template]
  if (!tpl) throw new Error(`Unknown email template: ${input.template}`)
  const locale = normaliseLocale(input.locale)
  const audience: Audience = input.audience || 'staff'
  const rtl = locale === 'ar'
  const data = enrich(input.data || {}, locale)
  const base = safeLink(input.baseUrl || BRAND.site)
  const link = appLink(input.entityType || null, input.entityId || null, base)
  const manage = settingsLink(base)
  const appStore = input.appStoreUrl ? safeLink(input.appStoreUrl) : null
  const appStoreOk = !!appStore && appStore !== BRAND.site

  const subject = stripCrLf(tpl.subject[locale](data)).slice(0, 180)
  const heading = cleanText(tpl.heading[locale](data), 200)
  const intro = cleanText(tpl.intro[locale](data), 600)

  const fields = (tpl.fields || [])
    .filter(f => audience !== 'external' || f.external)
    .map(f => ({ label: f.label[locale], value: formatValue(f, data[f.key], locale) }))
    .filter(f => f.value !== '')

  const list = tpl.listKey && Array.isArray(data[tpl.listKey])
    ? (data[tpl.listKey] as unknown[]).map(v => cleanText(v, 200)).filter(Boolean)
    : []
  const listShown = list.slice(0, 15)
  const listMore = list.length - listShown.length

  type Section = { title: string; count: number; items: string[]; more: number }
  const sections: Section[] = tpl.sections && Array.isArray(data.sections)
    ? (data.sections as Array<Record<string, unknown>>)
        .map(sec => {
          const items = Array.isArray(sec.items) ? (sec.items as unknown[]).map(v => cleanText(v, 200)).filter(Boolean) : []
          const count = Number(sec.count ?? items.length) || 0
          const key = String(sec.key || 'other')
          return { title: (DIGEST_SECTIONS[key] || DIGEST_SECTIONS.other)[locale], count, items: items.slice(0, 8), more: Math.max(0, count - Math.min(items.length, 8)) }
        })
        .filter(sec => sec.count > 0)
    : []

  const dir = rtl ? 'rtl' : 'ltr'
  const align = rtl ? 'right' : 'left'
  const font = rtl
    ? "Tahoma,'Segoe UI','Noto Sans Arabic',Arial,sans-serif"
    : "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const more = (n: number) => COMMON.more[locale].replace('{n}', String(n))

  const rowsHtml = fields.map(f => `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;width:38%;vertical-align:top;text-align:${align}">${escapeHtml(f.label)}</td>
                <td style="padding:8px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.ink};font-size:14px;font-weight:600;vertical-align:top;text-align:${align};white-space:pre-line">${escapeHtml(f.value)}</td>
              </tr>`).join('')

  const listHtml = listShown.length ? `
          <p style="margin:20px 0 8px;font-size:13px;font-weight:700;color:${BRAND.ink};text-align:${align}">${escapeHtml(tpl.listTitle?.[locale] || '')}</p>
          <ul style="margin:0;padding-${rtl ? 'right' : 'left'}:20px;color:${BRAND.ink};font-size:14px;line-height:1.6;text-align:${align}">
            ${listShown.map(i => `<li>${escapeHtml(i)}</li>`).join('')}${listMore > 0 ? `<li style="color:${BRAND.muted}">${escapeHtml(more(listMore))}</li>` : ''}
          </ul>` : ''

  const sectionsHtml = sections.map(sec => `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border:1px solid ${BRAND.line};border-radius:8px">
            <tr><td style="padding:12px 16px;background:#fafaf8;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:700;color:${BRAND.ink};text-align:${align}">
              ${escapeHtml(sec.title)} <span style="display:inline-block;margin-${rtl ? 'right' : 'left'}:6px;padding:1px 8px;border-radius:10px;background:${BRAND.yellow};color:${BRAND.ink};font-size:12px">${sec.count}</span>
            </td></tr>
            <tr><td style="padding:10px 16px;text-align:${align}">
              <ul style="margin:0;padding-${rtl ? 'right' : 'left'}:18px;color:${BRAND.ink};font-size:13px;line-height:1.6">
                ${sec.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}${sec.more > 0 ? `<li style="color:${BRAND.muted}">${escapeHtml(more(sec.more))}</li>` : ''}
              </ul>
            </td></tr>
          </table>`).join('')

  const notice = tpl.optional ? COMMON.optional[locale] : COMMON.mandatory[locale]

  const badges = `
                <a href="${escapeHtml(BRAND.playUrl)}" style="color:${BRAND.ink};text-decoration:underline;font-size:12px">${escapeHtml(COMMON.play[locale])}</a>${appStoreOk ? `
                &nbsp;&middot;&nbsp;<a href="${escapeHtml(appStore!)}" style="color:${BRAND.ink};text-decoration:underline;font-size:12px">${escapeHtml(COMMON.appstore[locale])}</a>` : ''}`

  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};" dir="${dir}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:${font}">
      <tr><td style="background:${BRAND.dark};padding:20px 28px;text-align:${align}">
        <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table"><tr>
          <td style="width:10px;height:28px;background:${BRAND.yellow};border-radius:2px"></td>
          <td style="padding-${rtl ? 'right' : 'left'}:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.3px" dir="ltr">Tyre Pulse</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;text-align:${align}">
        <h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:${BRAND.ink};font-weight:800">${escapeHtml(heading)}</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#333333">${escapeHtml(intro)}</p>
        ${rowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">${rowsHtml}
        </table>` : ''}${listHtml}${sectionsHtml}
      </td></tr>
      <tr><td style="padding:24px 28px 8px;text-align:${align}">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND.yellow};color:${BRAND.ink};font-size:15px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:8px">${escapeHtml(tpl.cta[locale])}</a>
      </td></tr>
      <tr><td style="padding:8px 28px 24px;text-align:${align};font-size:12px;line-height:1.5;color:${BRAND.muted}">${escapeHtml(notice)}</td></tr>
      <tr><td style="background:#fafaf8;border-top:1px solid ${BRAND.line};padding:18px 28px;text-align:${align};font-size:12px;line-height:1.7;color:${BRAND.muted}">
        <a href="${escapeHtml(BRAND.site)}" style="color:${BRAND.ink};font-weight:700;text-decoration:none">${BRAND.siteLabel}</a>
        &nbsp;&middot;&nbsp;${badges}
        &nbsp;&middot;&nbsp;<a href="${escapeHtml(manage)}" style="color:${BRAND.ink};text-decoration:underline;font-size:12px">${escapeHtml(COMMON.manage[locale])}</a>
        <br>${escapeHtml(COMMON.footer[locale])}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const textParts = [
    heading, '', intro,
    ...(fields.length ? ['', ...fields.map(f => `${f.label}: ${f.value}`)] : []),
    ...(listShown.length ? ['', tpl.listTitle?.[locale] || '', ...listShown.map(i => `- ${i}`), ...(listMore > 0 ? [`- ${more(listMore)}`] : [])] : []),
    ...sections.flatMap(sec => ['', `${sec.title} (${sec.count})`, ...sec.items.map(i => `- ${i}`), ...(sec.more > 0 ? [`- ${more(sec.more)}`] : [])]),
    '', `${tpl.cta[locale]}: ${link}`, '', notice, '',
    `${BRAND.siteLabel} | ${COMMON.play[locale]}: ${BRAND.playUrl}${appStoreOk ? ` | ${COMMON.appstore[locale]}: ${appStore}` : ''}`,
    `${COMMON.manage[locale]}: ${manage}`,
    COMMON.footer[locale],
  ]
  return { subject, html, text: textParts.join('\n'), locale, optional: tpl.optional }
}

export const TEMPLATE_KEYS = Object.keys(TEMPLATES)
