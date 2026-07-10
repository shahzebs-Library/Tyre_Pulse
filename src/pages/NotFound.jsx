import { useNavigate } from 'react-router-dom'
import StateScreen from '../components/StateScreen'

/**
 * NotFound — full-page 404 state shown for any unmatched authenticated route.
 * Renders the branded 404 illustration and routes the user back to the
 * dashboard. Theme-aware via StateScreen / the illustration system.
 */
export default function NotFound() {
  const navigate = useNavigate()

  return (
    <StateScreen
      illustration="error/404"
      title="Page not found"
      description="The page you're looking for doesn't exist, was moved, or you don't have access to it."
      action={{ label: 'Go to dashboard', onClick: () => navigate('/') }}
    />
  )
}
