import { useMemo } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'

/**
 * useReportMeta — assembles the branding/context object EnterpriseTable forwards
 * to the export renderers, so PDF/Excel exports carry the tenant logo, company
 * name, accent colour, footer and the active currency without each page
 * re-deriving them. Pass a human report title.
 *
 * @param {string} title  report title shown in the PDF/Excel header
 * @returns {{title:string, company:string, currency:string, branding:object|undefined}}
 */
export function useReportMeta(title) {
  const { activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  return useMemo(
    () => ({
      title: title || 'Report',
      company:
        branding?.legal_name ||
        branding?.display_name ||
        appSettings?.company_name ||
        '',
      currency: activeCurrency || 'SAR',
      branding: branding || undefined,
    }),
    [title, branding, appSettings?.company_name, activeCurrency],
  )
}

export default useReportMeta
