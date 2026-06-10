import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import ProtectedRoute, { RoleRoute } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
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
import PwaUpdatePrompt from './components/PwaUpdatePrompt'

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
                    <Route path="/"            element={<Dashboard />} />
                    <Route path="/tyres"       element={<TyreRecords />} />
                    {/* ── Analytics (Admin + Manager + Director) ── */}
                    <Route path="/analytics"    element={<RoleRoute allowed={['Admin','Manager','Director']}><Analytics /></RoleRoute>} />
                    <Route path="/brand-perf"   element={<RoleRoute allowed={['Admin','Manager','Director']}><BrandPerformance /></RoleRoute>} />
                    <Route path="/site-comp"    element={<RoleRoute allowed={['Admin','Manager','Director']}><SiteComparison /></RoleRoute>} />
                    <Route path="/fleet"        element={<RoleRoute allowed={['Admin','Manager','Director']}><FleetAnalytics /></RoleRoute>} />
                    <Route path="/kpi"          element={<RoleRoute allowed={['Admin','Manager','Director']}><KpiScorecard /></RoleRoute>} />
                    <Route path="/country-comp" element={<RoleRoute allowed={['Admin','Manager','Director']}><CountryComparison /></RoleRoute>} />
                    <Route path="/comparison"   element={<RoleRoute allowed={['Admin','Manager','Director']}><Comparison /></RoleRoute>} />

                    {/* ── Operations (all authenticated roles) ── */}
                    <Route path="/stock"       element={<StockManagement />} />
                    <Route path="/budgets"     element={<Budgets />} />
                    <Route path="/actions"     element={<CorrectiveActions />} />
                    <Route path="/accidents"   element={<Accidents />} />
                    <Route path="/rca"         element={<RcaRecords />} />
                    <Route path="/inspections" element={<Inspections />} />
                    <Route path="/alerts"      element={<Alerts />} />
                    <Route path="/fleet-master"        element={<FleetMaster />} />
                    <Route path="/reports"             element={<Reports />} />
                    <Route path="/gate-pass"           element={<GatePass />} />
                    <Route path="/serial-tracker"      element={<SerialTracker />} />
                    <Route path="/work-orders"         element={<WorkOrders />} />
                    <Route path="/maintenance-calendar" element={<MaintenanceCalendar />} />
                    <Route path="/safety-compliance"   element={<SafetyCompliance />} />
                    <Route path="/assets"              element={<AssetManagement />} />
                    <Route path="/inspection-planner"  element={<InspectionPlanner />} />
                    <Route path="/warranty"            element={<WarrantyTracker />} />
                    <Route path="/tyre-exchange"       element={<TyreExchange />} />
                    <Route path="/scrap"               element={<TyreScrapManagement />} />
                    <Route path="/stock-replenishment" element={<StockReplenishment />} />
                    <Route path="/live-fleet"          element={<LiveFleetStatus />} />
                    <Route path="/compliance"          element={<ComplianceDashboard />} />
                    <Route path="/retread"             element={<RetreadManagement />} />
                    <Route path="/recall-tracker"      element={<RecallTracker />} />
                    <Route path="/tyre-specs"          element={<TyreSpecifications />} />
                    <Route path="/rotation"            element={<RotationSchedule />} />
                    <Route path="/daily-ops"           element={<DailyOps />} />

                    {/* ── Intelligence (Admin only) ── */}
                    <Route path="/kpi-engine"              element={<RoleRoute allowed={['Admin']}><EngineeringKpi /></RoleRoute>} />
                    <Route path="/kpi-command"             element={<RoleRoute allowed={['Admin']}><KpiCommandCenter /></RoleRoute>} />
                    <Route path="/position-intelligence"   element={<RoleRoute allowed={['Admin']}><PositionIntelligence /></RoleRoute>} />
                    <Route path="/pressure-intel"          element={<RoleRoute allowed={['Admin']}><PressureIntelligence /></RoleRoute>} />
                    <Route path="/inspection-intelligence" element={<RoleRoute allowed={['Admin']}><InspectionIntelligence /></RoleRoute>} />
                    <Route path="/root-cause"              element={<RoleRoute allowed={['Admin']}><RootCauseEngine /></RoleRoute>} />
                    <Route path="/predictive-maintenance"  element={<RoleRoute allowed={['Admin']}><PredictiveMaintenance /></RoleRoute>} />
                    <Route path="/vendor-intelligence"     element={<RoleRoute allowed={['Admin']}><VendorIntelligence /></RoleRoute>} />
                    <Route path="/driver-management"       element={<RoleRoute allowed={['Admin']}><DriverManagement /></RoleRoute>} />
                    <Route path="/fleet-intelligence"      element={<RoleRoute allowed={['Admin']}><FleetIntelligence /></RoleRoute>} />
                    <Route path="/fleet-health"            element={<RoleRoute allowed={['Admin']}><FleetHealthBoard /></RoleRoute>} />
                    <Route path="/advanced-analytics"      element={<RoleRoute allowed={['Admin']}><AdvancedAnalytics /></RoleRoute>} />
                    <Route path="/ai-command-center"       element={<RoleRoute allowed={['Admin']}><AiCommandCenter /></RoleRoute>} />
                    <Route path="/executive-report"        element={<RoleRoute allowed={['Admin']}><ExecutiveReport /></RoleRoute>} />
                    <Route path="/forecasting"             element={<RoleRoute allowed={['Admin']}><ForecastingEngine /></RoleRoute>} />
                    <Route path="/cost-center"             element={<RoleRoute allowed={['Admin']}><CostCenter /></RoleRoute>} />
                    <Route path="/benchmark"               element={<RoleRoute allowed={['Admin']}><PerformanceBenchmark /></RoleRoute>} />
                    <Route path="/procurement"             element={<RoleRoute allowed={['Admin']}><Procurement /></RoleRoute>} />
                    <Route path="/suppliers"               element={<RoleRoute allowed={['Admin']}><SupplierManagement /></RoleRoute>} />
                    <Route path="/tyre-size"               element={<RoleRoute allowed={['Admin']}><TyreSizeAnalysis /></RoleRoute>} />
                    <Route path="/tyre-lifecycle"          element={<RoleRoute allowed={['Admin']}><TyreLifecycle /></RoleRoute>} />
                    <Route path="/downtime"                element={<RoleRoute allowed={['Admin']}><DowntimeTracker /></RoleRoute>} />
                    <Route path="/budget-planner"          element={<RoleRoute allowed={['Admin']}><BudgetPlanner /></RoleRoute>} />
                    <Route path="/workshop"                element={<RoleRoute allowed={['Admin']}><WorkshopManagement /></RoleRoute>} />
                    <Route path="/fuel-efficiency"         element={<RoleRoute allowed={['Admin']}><FuelEfficiency /></RoleRoute>} />
                    <Route path="/continuous-improvement"  element={<RoleRoute allowed={['Admin']}><ContinuousImprovement /></RoleRoute>} />
                    <Route path="/erp-sync"                element={<RoleRoute allowed={['Admin']}><ErpSync /></RoleRoute>} />
                    <Route path="/safety-compliance"       element={<RoleRoute allowed={['Admin']}><SafetyCompliance /></RoleRoute>} />
                    <Route path="/anomalies"               element={<RoleRoute allowed={['Admin']}><Anomalies /></RoleRoute>} />
                    <Route path="/vehicle-history"         element={<RoleRoute allowed={['Admin']}><VehicleHistory /></RoleRoute>} />
                    <Route path="/ai"                      element={<RoleRoute allowed={['Admin']}><AiAnalytics /></RoleRoute>} />

                    {/* ── Data (Admin only) ── */}
                    <Route path="/cleaning"    element={<RoleRoute allowed={['Admin']}><DataCleaning /></RoleRoute>} />
                    <Route path="/audit"       element={<RoleRoute allowed={['Admin']}><AuditTrail /></RoleRoute>} />
                    <Route path="/users"       element={<RoleRoute allowed={['Admin']}><UserManagement /></RoleRoute>} />

                    {/* ── Universal ── */}
                    <Route path="/upload"      element={<UploadData />} />
                    <Route path="/settings"    element={<Settings />} />
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
