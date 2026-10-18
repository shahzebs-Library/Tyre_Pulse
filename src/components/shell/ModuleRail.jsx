import { LayoutGrid, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandIcon from '../ui/BrandIcon'
import { useLanguage } from '../../contexts/LanguageContext'

function tx(t, key, fallback) { const value = t(key); return !value || value === key ? fallback : value }

export default function ModuleRail({ groups, selected, onSelect, appIcon, hasCustomIcon }) {
  const { t } = useLanguage()
  return <div className="tp-module-rail">
    <div className="tp-rail-brand"><BrandIcon src={appIcon} custom={hasCustomIcon} size={27} /></div>
    <nav aria-label={tx(t, 'shell.workspaces', 'Workspaces')}>
      {groups.map(({ id, label, shortLabel, icon: Icon }) => <button key={id} type="button" title={label}
        aria-label={label} aria-pressed={selected === id} onClick={() => onSelect(id)}>
        <Icon size={21} strokeWidth={1.7} aria-hidden="true" /><span>{shortLabel}</span>
      </button>)}
    </nav>
    <div className="tp-rail-footer">
      <button type="button" aria-label={tx(t, 'shell.allModules', 'All modules')} title={tx(t, 'shell.allModules', 'All modules')} aria-pressed={!selected} onClick={() => onSelect(null)}><LayoutGrid size={21} /><span>{tx(t, 'shell.allModules', 'All modules')}</span></button>
      <Link to="/help" title={tx(t, 'common.help', 'Help')} aria-label={tx(t, 'common.help', 'Help')}><HelpCircle size={20} /></Link>
    </div>
  </div>
}
