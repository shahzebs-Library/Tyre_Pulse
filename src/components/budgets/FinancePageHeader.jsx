import PageHeader from '../ui/PageHeader'
import './financeWorkspace.css'

/** Finance-only presentation; actions and access checks stay with each page. */
export default function FinancePageHeader({ toolbar, scope, ...props }) {
  return (
    <header className="finance-heading">
      <PageHeader {...props} className="finance-page-header" />
      {toolbar && <div className="finance-toolbar">{toolbar}</div>}
      {scope && <p className="finance-scope">{scope}</p>}
    </header>
  )
}
