import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildInsurancePortfolio } from '../lib/insurancePortfolio'
import PortfolioSection from '../components/insurance/PortfolioSection'
import CoverageGapsSection from '../components/insurance/CoverageGapsSection'
import ClaimRegisterSection from '../components/insurance/ClaimRegisterSection'
import LossExperienceSection from '../components/insurance/LossExperienceSection'
import PropertyRisksSection from '../components/insurance/PropertyRisksSection'

const fleet = [
  { id: 'f1', asset_no: 'TM001', country: 'KSA', site: 'JED', vehicle_type: 'TR-MIXER', registration_no: '1234 ABC', chassis_no: 'CHS0000001', status: 'Active' },
  { id: 'f2', asset_no: 'TM002', country: 'KSA', site: 'JED', vehicle_type: 'TR-MIXER', registration_no: '5678 XYZ', chassis_no: 'CHS0000002', status: 'Active' },
]
const schedule = [
  { id: 's1', asset_no: 'TM001', plate_no: '1234 ABC', chassis_no: 'CHS0000001', policy_no: 'P-1', cover_type: 'Motor', sum_insured: 100000, premium: 2500, currency: 'SAR', cover_to: '2027-01-01', country: 'KSA', site: 'JED', description: 'Mixer' },
  { id: 's2', asset_no: 'ZZ999', plate_no: '0000 QQQ', chassis_no: 'CHS9999999', policy_no: 'P-1', cover_type: 'Motor', sum_insured: 50000, premium: 900, currency: 'SAR', cover_to: '2027-01-01', country: 'KSA' },
]
const claims = [
  { id: 'c1', claim_no: 'CL-1', asset_no: 'TM001', plate_no: '1234 ABC', accident_date: '2026-05-01', cause_of_loss: 'Collision', estimate_payment: 4000, paid_amount: 3000, currency: 'SAR', claim_city: 'Jeddah', claim_type: 'OD', survey_no: 'NJ-1', country: 'KSA' },
]
const lossRuns = [
  { id: 'l1', policy_no: 'P-1', cover_type: 'Motor', policy_year: '2026', month_label: 'Jan', paid_amount: 3000, outstanding_amount: 1000, premium: 20000, currency: 'SAR', is_total: false },
]
const risks = [
  { id: 'r1', location_name: 'JED YARD', site: 'JED', city: 'Jeddah', item_description: 'Batching plant', total_value: 500000, premium: 4000, currency: 'SAR', gps_lat: 21.5, gps_lng: 39.2, period_to: '2027-01-01' },
]

const portfolio = buildInsurancePortfolio({ fleet, schedule, claims, lossRuns, propertyRisks: risks, accidents: [], country: 'KSA' })
const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('insurance surfaces render', () => {
  it('portfolio', () => {
    wrap(<PortfolioSection portfolio={portfolio} schedule={schedule} policies={[]} country="KSA" />)
    expect(screen.getByText(/Sum insured by cover type/i)).toBeTruthy()
    expect(screen.getByText(/Renewal countdown/i)).toBeTruthy()
  })
  it('gaps flags the orphan and the uninsured', () => {
    wrap(<CoverageGapsSection coverage={portfolio.coverage} country="KSA" />)
    expect(screen.getByText(/Potentially uninsured/i)).toBeTruthy()
    expect(portfolio.coverage.uninsured.length).toBe(1)
    expect(portfolio.coverage.orphanSchedule.length).toBe(1)
  })
  it('claims', () => {
    wrap(<ClaimRegisterSection claims={claims} stats={portfolio.claims} gap={portfolio.gap} repeat={portfolio.repeat} country="KSA" />)
    expect(screen.getByText('CL-1')).toBeTruthy()
  })
  it('loss', () => {
    wrap(<LossExperienceSection loss={portfolio.loss} lossRuns={lossRuns} country="KSA" />)
    expect(screen.getByText(/Loss ratio by policy year/i)).toBeTruthy()
  })
  it('property', () => {
    wrap(<PropertyRisksSection risks={risks} property={portfolio.property} siteNames={['RIYADH']} country="KSA" />)
    expect(screen.getByText(/Insured value by location/i)).toBeTruthy()
    expect(screen.getByText(/Not in the site register/i)).toBeTruthy()
  })
  it('empty states are honest', () => {
    wrap(<CoverageGapsSection coverage={null} />)
    expect(screen.getByText(/could not be produced/i)).toBeTruthy()
  })
})
