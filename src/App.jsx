import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import ProtectedRoute, { RoleRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import LoadingSpinner from './components/LoadingSpinner'
import TyreRecords from './pages/TyreRecords'
import StockManagement from './pages/StockManagement'
import Budgets from './pages/Budgets'
import CorrectiveActions from './pages/CorrectiveActions'
import RcaRecords from './pages/RcaRecords'
import DataCleaning from './pages/DataCleaning'
import UploadData from './pages/UploadData'
import Settings from './pages/Settings'
import Analytics from './pages/Analytics'
import BrandPerformance from './pages/BrandPerformance'
import SiteComparison from './pages/SiteComparison'
import FleetAnalytics from './pages/FleetAnalytics'
import KpiScorecard from './pages/KpiScorecard'
import Inspections from './pages/Inspections'
import Alerts from './pages/Alerts'
import Anomalies from './pages/Anomalies'
import CountryComparison from './pages/CountryComparison'
import VehicleHistory from './pages/VehicleHistory'
import UserManagement from './pages/UserManagement'
import AiAnalytics from './pages/AiAnalytics'
import FleetMaster from './pages/FleetMaster'
import AuditTrail from './pages/AuditTrail'
import ResetPassword from './pages/ResetPassword'
import Accidents from './pages/Accidents'
import Reports from './pages/Reports'
import GatePass from './pages/GatePass'
import SerialTracker from './pages/SerialTracker'
import Comparison from './pages/Comparison'
import EngineeringKpi from './pages/EngineeringKpi'
import PositionIntelligence from './pages/PositionIntelligence'
import InspectionIntelligence from './pages/InspectionIntelligence'
import RootCauseEngine from './pages/RootCauseEngine'
import PredictiveMaintenance from './pages/PredictiveMaintenance'
import VendorIntelligence from './pages/VendorIntelligence'
import FleetIntelligence from './pages/FleetIntelligence'
import AdvancedAnalytics from './pages/AdvancedAnalytics'
import AiCommandCenter from './pages/AiCommandCenter'
import ExecutiveReport from './pages/ExecutiveReport'
import ForecastingEngine from './pages/ForecastingEngine'
import ContinuousImprovement from './pages/ContinuousImprovement'
import ErpSync from './pages/ErpSync'
import WorkOrders from './pages/WorkOrders'
import MaintenanceCalendar from './pages/MaintenanceCalendar'
import DriverManagement from './pages/DriverManagement'
import SafetyCompliance from './pages/SafetyCompliance'
import CostCenter from './pages/CostCenter'
import PerformanceBenchmark from './pages/PerformanceBenchmark'
import Procurement from './pages/Procurement'
import TyreSizeAnalysis from './pages/TyreSizeAnalysis'
import DowntimeTracker from './pages/DowntimeTracker'
import BudgetPlanner from './pages/BudgetPlanner'
import FleetHealthBoard from './pages/FleetHealthBoard'
import TyreLifecycle from './pages/TyreLifecycle'
import WorkshopManagement from './pages/WorkshopManagement'
import PressureIntelligence from './pages/PressureIntelligence'
import SupplierManagement from './pages/SupplierManagement'
import FuelEfficiency from './pages/FuelEfficiency'
import DailyOps from './pages/DailyOps'
import RotationSchedule from './pages/RotationSchedule'
import KpiCommandCenter from './pages/KpiCommandCenter'
import RecallTracker from './pages/RecallTracker'
import WarrantyTracker from './pages/WarrantyTracker'
import TyreExchange from './pages/TyreExchange'
import TyreSpecifications from './pages/TyreSpecifications'
import AssetManagement from './pages/AssetManagement'
import InspectionPlanner from './pages/InspectionPlanner'
import RetreadManagement from './pages/RetreadManagement'
import LiveFleetStatus from './pages/LiveFleetStatus'
import ComplianceDashboard from './pages/ComplianceDashboard'
import TyreScrapManagement from './pages/TyreScrapManagement'
import StockReplenishment from './pages/StockReplenishment'
import TyreScan from './pages/TyreScan'
import QrLabels from './pages/QrLabels'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import ErrorBoundary from './components/ErrorBoundary'

// Wrap any element in a per-page error boundary so crashes don't take down the whole app
function Safe({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>
}

function HomeRoute() {
  const { profile, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (profile?.role === 'Tyre Man') return <Navigate to="/inspections" replace />
  return <Dashboard />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
        <PwaUpdatePrompt />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/"            element={<Safe><HomeRoute /></Safe>} />
                    <Route path="/tyres"       element={<Safe><TyreRecords /></Safe>} />
                    {/* ── Analytics (Admin + Manager + Director) ── */}
                    <Route path="/analytics"    element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><Analytics /></RoleRoute></Safe>} />
                    <Route path="/brand-perf"   element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><BrandPerformance /></RoleRoute></Safe>} />
                    <Route path="/site-comp"    element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><SiteComparison /></RoleRoute></Safe>} />
                    <Route path="/fleet"        element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><FleetAnalytics /></RoleRoute></Safe>} />
                    <Route path="/kpi"          element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><KpiScorecard /></RoleRoute></Safe>} />
                    <Route path="/country-comp" element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><CountryComparison /></RoleRoute></Safe>} />
                    <Route path="/comparison"   element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><Comparison /></RoleRoute></Safe>} />

                    {/* ── Operations (all authenticated roles) ── */}
                    <Route path="/stock"       element={<Safe><StockManagement /></Safe>} />
                    <Route path="/budgets"     element={<Safe><Budgets /></Safe>} />
                    <Route path="/actions"     element={<Safe><CorrectiveActions /></Safe>} />
                    <Route path="/accidents"   element={<Safe><Accidents /></Safe>} />
                    <Route path="/rca"         element={<Safe><RcaRecords /></Safe>} />
                    <Route path="/inspections" element={<Safe><Inspections /></Safe>} />
                    <Route path="/alerts"      element={<Safe><Alerts /></Safe>} />
                    <Route path="/fleet-master"        element={<Safe><FleetMaster /></Safe>} />
                    <Route path="/reports"             element={<Safe><Reports /></Safe>} />
                    <Route path="/gate-pass"           element={<Safe><GatePass /></Safe>} />
                    <Route path="/serial-tracker"      element={<Safe><SerialTracker /></Safe>} />
                    <Route path="/work-orders"         element={<Safe><WorkOrders /></Safe>} />
                    <Route path="/maintenance-calendar" element={<Safe><MaintenanceCalendar /></Safe>} />
                    <Route path="/safety-compliance"   element={<Safe><SafetyCompliance /></Safe>} />
                    <Route path="/assets"              element={<Safe><AssetManagement /></Safe>} />
                    <Route path="/inspection-planner"  element={<Safe><InspectionPlanner /></Safe>} />
                    <Route path="/warranty"            element={<Safe><WarrantyTracker /></Safe>} />
                    <Route path="/tyre-exchange"       element={<Safe><TyreExchange /></Safe>} />
                    <Route path="/scrap"               element={<Safe><TyreScrapManagement /></Safe>} />
                    <Route path="/stock-replenishment" element={<Safe><StockReplenishment /></Safe>} />
                    <Route path="/live-fleet"          element={<Safe><LiveFleetStatus /></Safe>} />
                    <Route path="/compliance"          element={<Safe><ComplianceDashboard /></Safe>} />
                    <Route path="/retread"             element={<Safe><RetreadManagement /></Safe>} />
                    <Route path="/recall-tracker"      element={<Safe><RecallTracker /></Safe>} />
                    <Route path="/tyre-specs"          element={<Safe><TyreSpecifications /></Safe>} />
                    <Route path="/rotation"            element={<Safe><RotationSchedule /></Safe>} />
                    <Route path="/daily-ops"           element={<Safe><DailyOps /></Safe>} />

                    {/* ── Intelligence (Admin only) ── */}
                    <Route path="/kpi-engine"              element={<Safe><RoleRoute allowed={['Admin']}><EngineeringKpi /></RoleRoute></Safe>} />
                    <Route path="/kpi-command"             element={<Safe><RoleRoute allowed={['Admin']}><KpiCommandCenter /></RoleRoute></Safe>} />
                    <Route path="/position-intelligence"   element={<Safe><RoleRoute allowed={['Admin']}><PositionIntelligence /></RoleRoute></Safe>} />
                    <Route path="/pressure-intel"          element={<Safe><RoleRoute allowed={['Admin']}><PressureIntelligence /></RoleRoute></Safe>} />
                    <Route path="/inspection-intelligence" element={<Safe><RoleRoute allowed={['Admin']}><InspectionIntelligence /></RoleRoute></Safe>} />
                    <Route path="/root-cause"              element={<Safe><RoleRoute allowed={['Admin']}><RootCauseEngine /></RoleRoute></Safe>} />
                    <Route path="/predictive-maintenance"  element={<Safe><RoleRoute allowed={['Admin']}><PredictiveMaintenance /></RoleRoute></Safe>} />
                    <Route path="/vendor-intelligence"     element={<Safe><RoleRoute allowed={['Admin']}><VendorIntelligence /></RoleRoute></Safe>} />
                    <Route path="/driver-management"       element={<Safe><RoleRoute allowed={['Admin']}><DriverManagement /></RoleRoute></Safe>} />
                    <Route path="/fleet-intelligence"      element={<Safe><RoleRoute allowed={['Admin']}><FleetIntelligence /></RoleRoute></Safe>} />
                    <Route path="/fleet-health"            element={<Safe><RoleRoute allowed={['Admin']}><FleetHealthBoard /></RoleRoute></Safe>} />
                    <Route path="/advanced-analytics"      element={<Safe><RoleRoute allowed={['Admin']}><AdvancedAnalytics /></RoleRoute></Safe>} />
                    <Route path="/ai-command-center"       element={<Safe><RoleRoute allowed={['Admin']}><AiCommandCenter /></RoleRoute></Safe>} />
                    <Route path="/executive-report"        element={<Safe><RoleRoute allowed={['Admin']}><ExecutiveReport /></RoleRoute></Safe>} />
                    <Route path="/forecasting"             element={<Safe><RoleRoute allowed={['Admin']}><ForecastingEngine /></RoleRoute></Safe>} />
                    <Route path="/cost-center"             element={<Safe><RoleRoute allowed={['Admin']}><CostCenter /></RoleRoute></Safe>} />
                    <Route path="/benchmark"               element={<Safe><RoleRoute allowed={['Admin']}><PerformanceBenchmark /></RoleRoute></Safe>} />
                    <Route path="/procurement"             element={<Safe><RoleRoute allowed={['Admin']}><Procurement /></RoleRoute></Safe>} />
                    <Route path="/suppliers"               element={<Safe><RoleRoute allowed={['Admin']}><SupplierManagement /></RoleRoute></Safe>} />
                    <Route path="/tyre-size"               element={<Safe><RoleRoute allowed={['Admin']}><TyreSizeAnalysis /></RoleRoute></Safe>} />
                    <Route path="/tyre-lifecycle"          element={<Safe><RoleRoute allowed={['Admin']}><TyreLifecycle /></RoleRoute></Safe>} />
                    <Route path="/downtime"                element={<Safe><RoleRoute allowed={['Admin']}><DowntimeTracker /></RoleRoute></Safe>} />
                    <Route path="/budget-planner"          element={<Safe><RoleRoute allowed={['Admin']}><BudgetPlanner /></RoleRoute></Safe>} />
                    <Route path="/workshop"                element={<Safe><RoleRoute allowed={['Admin']}><WorkshopManagement /></RoleRoute></Safe>} />
                    <Route path="/fuel-efficiency"         element={<Safe><RoleRoute allowed={['Admin']}><FuelEfficiency /></RoleRoute></Safe>} />
                    <Route path="/continuous-improvement"  element={<Safe><RoleRoute allowed={['Admin']}><ContinuousImprovement /></RoleRoute></Safe>} />
                    <Route path="/erp-sync"                element={<Safe><RoleRoute allowed={['Admin']}><ErpSync /></RoleRoute></Safe>} />
                    <Route path="/anomalies"               element={<Safe><RoleRoute allowed={['Admin']}><Anomalies /></RoleRoute></Safe>} />
                    <Route path="/vehicle-history"         element={<Safe><RoleRoute allowed={['Admin']}><VehicleHistory /></RoleRoute></Safe>} />
                    <Route path="/ai"                      element={<Safe><RoleRoute allowed={['Admin']}><AiAnalytics /></RoleRoute></Safe>} />

                    {/* ── Data (Admin only) ── */}
                    <Route path="/cleaning"    element={<Safe><RoleRoute allowed={['Admin']}><DataCleaning /></RoleRoute></Safe>} />
                    <Route path="/audit"       element={<Safe><RoleRoute allowed={['Admin']}><AuditTrail /></RoleRoute></Safe>} />
                    <Route path="/users"       element={<Safe><RoleRoute allowed={['Admin']}><UserManagement /></RoleRoute></Safe>} />

                    {/* ── Universal ── */}
                    <Route path="/upload"      element={<Safe><UploadData /></Safe>} />
                    <Route path="/settings"    element={<Safe><Settings /></Safe>} />
                    <Route path="/scan"        element={<Safe><TyreScan /></Safe>} />
                    <Route path="/qr-labels"   element={<Safe><QrLabels /></Safe>} />
                    <Route path="*"              element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
