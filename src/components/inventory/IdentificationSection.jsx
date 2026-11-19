/**
 * Identification: what does this code identify? Accepts a bin label
 * (`TP:LOC:<id>`), an item code, a barcode or an approved alias (OEM,
 * superseded, ERP legacy). Cross-references come only from approved alias and
 * OEM tables; nothing is matched by description.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ScanLine, QrCode, ExternalLink } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { lookupCode, compatibilityCounts } from '../../lib/api/inventory'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill } from './InvUi'
import { KitTable } from '../commandCenter/kit'

export default function IdentificationSection({ onNavigate }) {
  const { t } = useLanguage()
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const compat = useInvQuery(() => compatibilityCounts(), [])

  const find = async (e) => {
    e?.preventDefault()
    if (!code.trim()) return
    setBusy(true); setErr(''); setResult(null)
    try { setResult(await lookupCode(code)) } catch (x) { setErr(toUserMessage(x)) } finally { setBusy(false) }
  }

  const c = compat.data || {}
  const validated = (c.oemReferences || 0) + (c.fitments || 0)

  return (
    <div className="inv-hub">
      <SectionCard title={t('inventory.ident.lookupTitle')} sub={t('inventory.ident.lookupSub')}>
        <form className="cc-filters" onSubmit={find}>
          <div className="cc-search">
            <ScanLine size={15} aria-hidden="true" />
            <input type="search" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('inventory.ident.placeholder')}
              aria-label={t('inventory.ident.placeholder')} autoComplete="off" />
          </div>
          <button type="submit" className="cc-btn-primary" disabled={busy || !code.trim()}>{busy ? t('inventory.actions.searching') : t('inventory.ident.find')}</button>
        </form>
        {err && <ErrorNote error={err} />}
        {result && (
          <div className="inv-hub" style={{ gap: 10, marginTop: 12 }}>
            {result.status === 'not_provisioned' && <Note tone="warn">{t('inventory.ident.partial')}</Note>}
            {result.location && (
              <Note tone="good" title={t('inventory.ident.isLocation')}>
                {result.location.code} {result.location.name} ({result.location.site})
                <button type="button" className="cc-btn-ghost" style={{ marginInlineStart: 8 }} onClick={() => onNavigate('locations')}>{t('inventory.ident.openLocations')}</button>
              </Note>
            )}
            {result.items.length > 0 && (
              <KitTable compact rows={result.items} columns={[
                { key: 'item_code', header: t('inventory.common.item') },
                { key: 'item_name', header: t('inventory.common.description') },
                { key: 'category', header: t('inventory.ident.category') },
                { key: 'country', header: t('inventory.scope.country') },
              ]} />
            )}
            {result.aliases.length > 0 && (
              <KitTable compact rows={result.aliases} columns={[
                { key: 'alias_type', header: t('inventory.ident.aliasType'), cell: (r) => <StatusPill value={r.alias_type} tone="info" /> },
                { key: 'value', header: t('inventory.ident.value') },
                { key: 'source', header: t('inventory.opening.source') },
              ]} />
            )}
            {!result.location && !result.items.length && !result.aliases.length && (
              <div className="cc-empty">{t('inventory.ident.nothing')}</div>
            )}
          </div>
        )}
      </SectionCard>

      <div className="inv-cols-2">
        <SectionCard title={t('inventory.ident.labelsTitle')} sub={t('inventory.ident.labelsSub')}>
          <div className="inv-links">
            <button type="button" className="inv-linkcard" onClick={() => onNavigate('locations')} style={{ textAlign: 'start', cursor: 'pointer' }}>
              <QrCode size={18} aria-hidden="true" style={{ color: 'var(--cc-green)' }} />
              <span>{t('inventory.ident.binLabels')}<small>{t('inventory.ident.binLabelsSub')}</small></span>
            </button>
            <Link to="/qr-labels" className="inv-linkcard">
              <QrCode size={18} aria-hidden="true" style={{ color: 'var(--cc-green)' }} />
              <span style={{ flex: 1 }}>{t('inventory.ident.assetLabels')}<small>{t('inventory.ident.assetLabelsSub')}</small></span>
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          </div>
        </SectionCard>
        <SectionCard title={t('inventory.ident.compatTitle')} sub={t('inventory.ident.compatSub')}>
          {compat.error ? <ErrorNote error={compat.error} onRetry={compat.retry} /> : compat.loading && !compat.data ? <div className="cc-skel" style={{ height: 60 }} /> : (
            validated === 0
              ? <Note tone="warn" title={t('inventory.ident.noCompat')}>{c.oemReferences === null && c.fitments === null ? t('inventory.ident.compatNotSetUp') : t('inventory.ident.noCompatBody')}</Note>
              : (
                <dl className="inv-dl">
                  <dt>{t('inventory.ident.oemRefs')}</dt><dd className="inv-num">{c.oemReferences ?? 'N/A'}</dd>
                  <dt>{t('inventory.ident.fitments')}</dt><dd className="inv-num">{c.fitments ?? 'N/A'}</dd>
                </dl>
              )
          )}
        </SectionCard>
      </div>
    </div>
  )
}
