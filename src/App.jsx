import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import ProtectedRoute, { RoleRoute, ModuleRoute } from './components/ProtectedRoute'
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
import CustomData from './pages/CustomData'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import ErrorBoundary from './components/ErrorBoundary'
// Console (completely isolated auth context)
import { ConsoleAuthProvider, useConsoleAuth } from './console/ConsoleAuthContext'
import ConsoleLayout from './console/components/ConsoleLayout'
import ConsoleLogin from './console/pages/ConsoleLogin'
import ConsoleDashboard from './console/pages/ConsoleDashboard'
import ConsoleOrganisations from './console/pages/ConsoleOrganisations'
import ConsoleUsers from './console/pages/ConsoleUsers'
import ConsolePermissions from './console/pages/ConsolePermissions'
import ConsoleAIUsage from './console/pages/ConsoleAIUsage'
import ConsoleAuditLog from './console/pages/ConsoleAuditLog'
import ConsoleAnnouncements from './console/pages/ConsoleAnnouncements'
import ConsoleSystemConfig from './console/pages/ConsoleSystemConfig'

// ── Per-page error boundary ───────────────────────────────────────────────
function Safe({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>
}

// ── Main app home redirect based on role ─────────────────────────────────
function HomeRoute() {
  const { profile, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (profile?.role === 'Tyre Man') return <Navigate to="/inspections" replace />
  return <Dashboard />
}

// ── Console auth guard (must sit inside ConsoleAuthProvider) ──────────────
function ConsoleGuard({ children }) {
  const { admin, loading } = useConsoleAuth()
  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!admin) return <Navigate to="/console/login" replace />
  return children
}

// ── Main app wrapped in its own providers (keeps console completely isolated)
function MainApp() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <PwaUpdatePrompt />
        <Routes>
          <Route path="/login"          element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/"            element={<Safe><HomeRoute /></Safe>} />
                    <Route path="/tyres"       element={<Safe><TyreRecords /></Safe>} />
                    {/* ── Analytics ── */}
                    <Route path="/analytics"    element={<Safe><ModuleRoute moduleKey="analytics"><Analytics /></ModuleRoute></Safe>} />
                    <Route path="/brand-perf"   element={<Safe><ModuleRoute moduleKey="brand_performance"><BrandPerformance /></ModuleRoute></Safe>} />
                    <Route path="/site-comp"    element={<Safe><ModuleRoute moduleKey="site_comparison"><SiteComparison /></ModuleRoute></Safe>} />
                    <Route path="/fleet"        element={<Safe><ModuleRoute moduleKey="fleet_analytics"><FleetAnalytics /></ModuleRoute></Safe>} />
                    <Route path="/kpi"          element={<Safe><ModuleRoute moduleKey="kpi_scorecard"><KpiScorecard /></ModuleRoute></Safe>} />
                    <Route path="/country-comp" element={<Safe><ModuleRoute moduleKey="country_comparison"><CountryComparison /></ModuleRoute></Safe>} />
                    <Route path="/comparison"   element={<Safe><ModuleRoute moduleKey="analytics"><Comparison /></ModuleRoute></Safe>} />
                    {/* ── Operations ── */}
                    <Route path="/stock"       element={<Safe><StockManagement /></Safe>} />
                    <Route path="/budgets"     element={<Safe><Budgets /></Safe>} />
                    <Route path="/actions"     element={<Safe><CorrectiveActions /></Safe>} />
                    <Route path="/accidents"   element={<Safe><Accidents /></Safe>} />
                    <Route path="/rca"         element={<Safe><RcaRecords /></Safe>} />
                    <Route path="/inspections" element={<Safe><Inspections /></Safe>} />
                    <Route path="/alerts"      element={<Safe><Alerts /></Safe>} />
                    <Route path="/fleet-master"         element={<Safe><FleetMaster /></Safe>} />
                    <Route path="/reports"              element={<Safe><Reports /></Safe>} />
                    <Route path="/gate-pass"            element={<Safe><GatePass /></Safe>} />
                    <Route path="/serial-tracker"       element={<Safe><SerialTracker /></Safe>} />
                    <Route path="/work-orders"          element={<Safe><WorkOrders /></Safe>} />
                    <Route path="/maintenance-calendar" element={<Safe><MaintenanceCalendar /></Safe>} />
                    <Route path="/safety-compliance"    element={<Safe><SafetyCompliance /></Safe>} />
                    <Route path="/assets"               element={<Safe><AssetManagement /></Safe>} />
                    <Route path="/inspection-planner"   element={<Safe><InspectionPlanner /></Safe>} />
                    <Route path="/warranty"             element={<Safe><WarrantyTracker /></Safe>} />
                    <Route path="/tyre-exchange"        element={<Safe><TyreExchange /></Safe>} />
                    <Route path="/scrap"                element={<Safe><TyreScrapManagement /></Safe>} />
                    <Route path="/stock-replenishment"  element={<Safe><StockReplenishment /></Safe>} />
                    <Route path="/live-fleet"           element={<Safe><LiveFleetStatus /></Safe>} />
                    <Route path="/compliance"           element={<Safe><ComplianceDashboard /></Safe>} />
                    <Route path="/retread"              element={<Safe><RetreadManagement /></Safe>} />
                    <Route path="/recall-tracker"       element={<Safe><RecallTracker /></Safe>} />
                    <Route path="/tyre-specs"           element={<Safe><TyreSpecifications /></Safe>} />
                    <Route path="/rotation"             element={<Safe><RotationSchedule /></Safe>} />
                    <Route path="/daily-ops"            element={<Safe><DailyOps /></Safe>} />
                    {/* ── Intelligence ── */}
                    <Route path="/kpi-engine"              element={<Safe><ModuleRoute moduleKey="kpi_scorecard"><EngineeringKpi /></ModuleRoute></Safe>} />
                    <Route path="/kpi-command"             element={<Safe><ModuleRoute moduleKey="kpi_scorecard"><KpiCommandCenter /></ModuleRoute></Safe>} />
                    <Route path="/position-intelligence"   element={<Safe><ModuleRoute moduleKey="position_intelligence"><PositionIntelligence /></ModuleRoute></Safe>} />
                    <Route path="/pressure-intel"          element={<Safe><ModuleRoute moduleKey="pressure_intelligence"><PressureIntelligence /></ModuleRoute></Safe>} />
                    <Route path="/inspection-intelligence" element={<Safe><ModuleRoute moduleKey="inspections"><InspectionIntelligence /></ModuleRoute></Safe>} />
                    <Route path="/root-cause"              element={<Safe><ModuleRoute moduleKey="root_cause_engine"><RootCauseEngine /></ModuleRoute></Safe>} />
                    <Route path="/predictive-maintenance"  element={<Safe><ModuleRoute moduleKey="predictive_maintenance"><PredictiveMaintenance /></ModuleRoute></Safe>} />
                    <Route path="/vendor-intelligence"     element={<Safe><ModuleRoute moduleKey="vendor_intelligence"><VendorIntelligence /></ModuleRoute></Safe>} />
                    <Route path="/driver-management"       element={<Safe><ModuleRoute moduleKey="fleet_master"><DriverManagement /></ModuleRoute></Safe>} />
                    <Route path="/fleet-intelligence"      element={<Safe><ModuleRoute moduleKey="fleet_intelligence"><FleetIntelligence /></ModuleRoute></Safe>} />
                    <Route path="/fleet-health"            element={<Safe><ModuleRoute moduleKey="fleet_intelligence"><FleetHealthBoard /></ModuleRoute></Safe>} />
                    <Route path="/advanced-analytics"      element={<Safe><ModuleRoute moduleKey="analytics"><AdvancedAnalytics /></ModuleRoute></Safe>} />
                    <Route path="/ai-command-center"       element={<Safe><ModuleRoute moduleKey="ai_command_center"><AiCommandCenter /></ModuleRoute></Safe>} />
                    <Route path="/executive-report"        element={<Safe><ModuleRoute moduleKey="executive_report"><ExecutiveReport /></ModuleRoute></Safe>} />
                    <Route path="/forecasting"             element={<Safe><ModuleRoute moduleKey="forecasting"><ForecastingEngine /></ModuleRoute></Safe>} />
                    <Route path="/cost-center"             element={<Safe><ModuleRoute moduleKey="budgets"><CostCenter /></ModuleRoute></Safe>} />
                    <Route path="/benchmark"               element={<Safe><ModuleRoute moduleKey="analytics"><PerformanceBenchmark /></ModuleRoute></Safe>} />
                    <Route path="/procurement"             element={<Safe><ModuleRoute moduleKey="stock"><Procurement /></ModuleRoute></Safe>} />
                    <Route path="/suppliers"               element={<Safe><ModuleRoute moduleKey="stock"><SupplierManagement /></ModuleRoute></Safe>} />
                    <Route path="/tyre-size"               element={<Safe><ModuleRoute moduleKey="tyre_records"><TyreSizeAnalysis /></ModuleRoute></Safe>} />
                    <Route path="/tyre-lifecycle"          element={<Safe><ModuleRoute moduleKey="tyre_records"><TyreLifecycle /></ModuleRoute></Safe>} />
                    <Route path="/downtime"                element={<Safe><ModuleRoute moduleKey="fleet_analytics"><DowntimeTracker /></ModuleRoute></Safe>} />
                    <Route path="/budget-planner"          element={<Safe><ModuleRoute moduleKey="budgets"><BudgetPlanner /></ModuleRoute></Safe>} />
                    <Route path="/workshop"                element={<Safe><ModuleRoute moduleKey="work_orders"><WorkshopManagement /></ModuleRoute></Safe>} />
                    <Route path="/fuel-efficiency"         element={<Safe><ModuleRoute moduleKey="fleet_analytics"><FuelEfficiency /></ModuleRoute></Safe>} />
                    <Route path="/continuous-improvement"  element={<Safe><ModuleRoute moduleKey="analytics"><ContinuousImprovement /></ModuleRoute></Safe>} />
                    <Route path="/erp-sync"                element={<Safe><ModuleRoute moduleKey="erp_sync"><ErpSync /></ModuleRoute></Safe>} />
                    <Route path="/anomalies"               element={<Safe><ModuleRoute moduleKey="tyre_records"><Anomalies /></ModuleRoute></Safe>} />
                    <Route path="/vehicle-history"         element={<Safe><ModuleRoute moduleKey="fleet_master"><VehicleHistory /></ModuleRoute></Safe>} />
                    <Route path="/ai"                      element={<Safe><ModuleRoute moduleKey="ai_analytics"><AiAnalytics /></ModuleRoute></Safe>} />
                    {/* ── Data ── */}
                    <Route path="/cleaning"    element={<Safe><ModuleRoute moduleKey="data_cleaning"><DataCleaning /></ModuleRoute></Safe>} />
                    <Route path="/audit"       element={<Safe><ModuleRoute moduleKey="audit_trail"><AuditTrail /></ModuleRoute></Safe>} />
                    <Route path="/users"       element={<Safe><ModuleRoute moduleKey="user_management"><UserManagement /></ModuleRoute></Safe>} />
                    {/* ── Universal ── */}
                    <Route path="/upload"      element={<Safe><UploadData /></Safe>} />
                    <Route path="/custom-data" element={<Safe><CustomData /></Safe>} />
                    <Route path="/settings"    element={<Safe><Settings /></Safe>} />
                    <Route path="/scan"        element={<Safe><TyreScan /></Safe>} />
                    <Route path="/qr-labels"   element={<Safe><QrLabels /></Safe>} />
                    <Route path="*"            element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </SettingsProvider>
    </AuthProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── System Console — completely isolated from main app ── */}
        <Route path="/console/login" element={
          <ConsoleAuthProvider>
            <ConsoleLogin />
          </ConsoleAuthProvider>
        } />
        <Route path="/console/*" element={
          <ConsoleAuthProvider>
            <ConsoleGuard>
              <ConsoleLayout />
            </ConsoleGuard>
          </ConsoleAuthProvider>
        }>
          <Route index                element={<ConsoleDashboard />} />
          <Route path="organisations" element={<ConsoleOrganisations />} />
          <Route path="users"         element={<ConsoleUsers />} />
          <Route path="permissions"   element={<ConsolePermissions />} />
          <Route path="ai-usage"      element={<ConsoleAIUsage />} />
          <Route path="audit"         element={<ConsoleAuditLog />} />
          <Route path="announcements" element={<ConsoleAnnouncements />} />
          <Route path="config"        element={<ConsoleSystemConfig />} />
          <Route path="*"             element={<Navigate to="/console" replace />} />
        </Route>

        {/* ── Main TyrePulse Application ── */}
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
