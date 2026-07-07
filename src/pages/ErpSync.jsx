import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Database, Link2Off, ArrowRight, Shield, Upload, Info,
  PlugZap, CheckCircle2, FileSpreadsheet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useLanguage } from '../contexts/LanguageContext'
import ErpConnectionPanel from '../components/erp/ErpConnectionPanel'
import WebhooksPanel from '../components/integrations/WebhooksPanel'

// ── Honest state ──────────────────────────────────────────────────────────────
// No ERP connector is provisioned for this project yet. Rather than fabricate
// connection status, sync history or validation counts (which would misrepresent
// the system), this screen states the real status and routes the user to the
// live, supported ingestion path: the Data Intake Center. The ERP systems below
// are integration TARGETS the connector is designed for - clearly labelled as
// "available to configure", never as connected.

const INTEGRATION_TARGETS = [
  { id: 'sap',      name: 'SAP S/4HANA',            api: 'OData v4',            color: '#0078d4', logo: 'SAP' },
  { id: 'oracle',   name: 'Oracle Fusion ERP',      api: 'REST v11.13',        color: '#f80000', logo: 'ORC' },
  { id: 'dynamics', name: 'Microsoft Dynamics 365', api: 'OData v4 (Dynamics)', color: '#00a4ef', logo: 'D365' },
  { id: 'custom',   name: 'Custom REST / CSV feed', api: 'REST or scheduled file', color: '#8b5cf6', logo: 'API' },
]

const SETUP_STEPS = [
  { n: 1, title: 'Provision a connector', body: 'An administrator configures ERP endpoint, credentials (stored server-side) and the sync schedule. Requires API access - not available in read-only mode.' },
  { n: 2, title: 'Map fields once',       body: 'Reuse a saved mapping profile from the Data Intake Center so ERP fields land in the correct TyrePulse columns with validation and currency normalisation.' },
  { n: 3, title: 'Scheduled read-only sync', body: 'The connector pulls on a schedule, stages every row for review, and commits only validated records - the same controlled pipeline as manual imports.' },
]

function TargetCard({ t }) {
  const { t: translate } = useLanguage()
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: 'var(--panel-overlay)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0"
        style={{ background: `${t.color}20`, border: `1px solid ${t.color}40`, color: t.color }}
      >
        {t.logo}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-200 leading-tight truncate">{t.name}</p>
        <p className="text-[11px] text-gray-600">{t.api}</p>
      </div>
      <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-400 border border-gray-700/40 flex-shrink-0">
        {translate('erpsync.notConfigured')}
      </span>
    </div>
  )
}

export default function ErpSync() {
  const { t } = useLanguage()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6"
    >
      <PageHeader
        title={t('erpsync.pageHeader.title')}
        subtitle={t('erpsync.pageHeader.subtitle')}
        icon={Database}
        badge={t('erpsync.pageHeader.badge')}
      />

      {/* Honest not-connected banner */}
      <div
        className="rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-4"
        style={{ background: 'var(--panel-overlay)', border: '1px solid rgba(245,158,11,0.25)' }}
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <Link2Off size={22} className="text-amber-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-gray-100">{t('erpsync.banner.heading')}</h2>
          <p className="text-sm text-gray-400 mt-1 leading-relaxed max-w-2xl">
            {t('erpsync.banner.bodyPre')}
            <span className="text-gray-200 font-medium"> {t('erpsync.banner.bodyHighlight')}</span> {t('erpsync.banner.bodySuffix')}
          </p>
        </div>
        <Link
          to="/data-intake"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.35),rgba(22,163,74,0.18))', border: '1px solid rgba(22,163,74,0.35)' }}
        >
          <Upload size={15} /> {t('erpsync.banner.cta')} <ArrowRight size={14} />
        </Link>
      </div>

      {/* ERP connection config */}
      <ErpConnectionPanel />

      {/* Outbound webhooks (event-driven integrations) */}
      <WebhooksPanel />

      {/* Integration targets */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <PlugZap size={14} className="text-green-400" /> {t('erpsync.targets.sectionTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {INTEGRATION_TARGETS.map(t => <TargetCard key={t.id} t={t} />)}
        </div>
        <p className="text-[11px] text-gray-600 mt-2 flex items-center gap-1.5">
          <Info size={11} /> {t('erpsync.targets.footerNote')}
        </p>
      </section>

      {/* How setup works */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Shield size={14} className="text-green-400" /> {t('erpsync.setup.sectionTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SETUP_STEPS.map(s => (
            <div key={s.n} className="rounded-xl p-4" style={{ background: 'var(--panel-overlay)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-green-900/40 border border-green-700/40 text-green-300 text-xs font-bold flex items-center justify-center">
                  {s.n}
                </div>
                <p className="text-sm font-semibold text-gray-200">{t(`erpsync.setupSteps.${s.n}.title`)}</p>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t(`erpsync.setupSteps.${s.n}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Current supported path */}
      <section
        className="rounded-2xl p-6"
        style={{ background: 'var(--panel-overlay)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 size={16} className="text-green-400" />
          <h2 className="text-sm font-semibold text-gray-200">{t('erpsync.today.sectionTitle')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link to="/data-intake" className="flex items-center gap-3 rounded-xl p-4 hover:bg-white/[0.03] transition-colors" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <FileSpreadsheet size={20} className="text-green-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-200">{t('erpsync.today.importCard.title')}</p>
              <p className="text-xs text-gray-500">{t('erpsync.today.importCard.description')}</p>
            </div>
            <ArrowRight size={15} className="text-gray-600 ml-auto flex-shrink-0" />
          </Link>
          <Link to="/data-intake/history" className="flex items-center gap-3 rounded-xl p-4 hover:bg-white/[0.03] transition-colors" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <Database size={20} className="text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-200">{t('erpsync.today.historyCard.title')}</p>
              <p className="text-xs text-gray-500">{t('erpsync.today.historyCard.description')}</p>
            </div>
            <ArrowRight size={15} className="text-gray-600 ml-auto flex-shrink-0" />
          </Link>
        </div>
      </section>
    </motion.div>
  )
}
