import { useNavigate } from 'react-router-dom'
import StateScreen from '../components/StateScreen'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * NotFound — full-page 404 state shown for any unmatched authenticated route.
 * Renders the branded 404 illustration and routes the user back to the
 * dashboard. Theme-aware via StateScreen / the illustration system.
 */
export default function NotFound() {
  const navigate = useNavigate()
  const { t } = useLanguage()

  return (
    <StateScreen
      illustration="error/404"
      title={t('console_nz.pageNotFound')}
      description={t('console_nz.pageNotFoundDescription')}
      action={{ label: t('console_nz.goToDashboard'), onClick: () => navigate('/') }}
    />
  )
}
