/**
 * SitesIntake (route /sites-intake) - upload / manage the site -> region map.
 *
 * One company -> countries -> sites; each KSA site belongs to a Region
 * (Central / Western). Region drives the Cost per M3 split. Fill the Sites template
 * (Country, Site Name, Site Code, Region, City, Site Type, Active) and import it;
 * existing sites are updated (region set), new ones inserted.
 */
import LedgerPage from '../components/costm3/LedgerPage'
import { listSites, createSite, importSites, deleteSite } from '../lib/api/costPerM3'

export default function SitesIntake() {
  return (
    <LedgerPage
      title="Sites & Regions"
      subtitle="Assign each site a Region (KSA: Central / Western). Import the Sites template or add sites."
      kind="sites"
      hideTotal
      hidePeriod
      service={{ list: listSites, create: createSite, import: importSites, remove: deleteSite }}
      columns={[
        { key: 'country', header: 'Country' },
        { key: 'name', header: 'Site' },
        { key: 'site_code', header: 'Code' },
        { key: 'region', header: 'Region' },
        { key: 'city', header: 'City' },
        { key: 'site_type', header: 'Type' },
        { key: 'active', header: 'Active', render: (r) => (r.active === false ? 'No' : 'Yes') },
      ]}
      formFields={[
        { key: 'country', label: 'Country', type: 'select', options: ['KSA', 'UAE', 'Egypt'], required: true },
        { key: 'name', label: 'Site Name', type: 'text', required: true },
        { key: 'site_code', label: 'Site Code', type: 'text' },
        { key: 'region', label: 'Region', type: 'select', options: ['Central', 'Western', 'Eastern'] },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'site_type', label: 'Site Type', type: 'text' },
      ]}
    />
  )
}
