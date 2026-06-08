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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
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
                    <Route path="/analytics"   element={<Analytics />} />
                    <Route path="/brand-perf"  element={<BrandPerformance />} />
                    <Route path="/site-comp"   element={<SiteComparison />} />
                    <Route path="/fleet"       element={<FleetAnalytics />} />
                    <Route path="/kpi"         element={<KpiScorecard />} />
                    <Route path="/stock"       element={<StockManagement />} />
                    <Route path="/budgets"     element={<Budgets />} />
                    <Route path="/actions"     element={<CorrectiveActions />} />
                    <Route path="/accidents"   element={<Accidents />} />
                    <Route path="/rca"         element={<RcaRecords />} />
                    <Route path="/inspections" element={<Inspections />} />
                    <Route path="/alerts"      element={<Alerts />} />
                    <Route path="/anomalies"     element={<RoleRoute allowed={['Admin']}><Anomalies /></RoleRoute>} />
                    <Route path="/country-comp" element={<CountryComparison />} />
                    <Route path="/vehicle-history" element={<RoleRoute allowed={['Admin']}><VehicleHistory /></RoleRoute>} />
                    <Route path="/fleet-master"   element={<FleetMaster />} />
                    <Route path="/ai"          element={<RoleRoute allowed={['Admin']}><AiAnalytics /></RoleRoute>} />
                    <Route path="/cleaning"    element={<RoleRoute allowed={['Admin']}><DataCleaning /></RoleRoute>} />
                    <Route path="/upload"      element={<UploadData />} />
                    <Route path="/audit"       element={<RoleRoute allowed={['Admin']}><AuditTrail /></RoleRoute>} />
                    <Route path="/settings"    element={<Settings />} />
                    <Route path="/users"       element={<RoleRoute allowed={['Admin']}><UserManagement /></RoleRoute>} />
                    <Route path="/reports"        element={<Reports />} />
                    <Route path="/gate-pass"     element={<GatePass />} />
                    <Route path="/serial-tracker" element={<SerialTracker />} />
                    <Route path="/comparison"    element={<Comparison />} />
                    <Route path="/kpi-engine"              element={<EngineeringKpi />} />
                    <Route path="/position-intelligence"   element={<PositionIntelligence />} />
                    <Route path="/inspection-intelligence" element={<InspectionIntelligence />} />
                    <Route path="/root-cause"              element={<RootCauseEngine />} />
                    <Route path="/predictive-maintenance"  element={<PredictiveMaintenance />} />
                    <Route path="/vendor-intelligence"    element={<VendorIntelligence />} />
                    <Route path="/fleet-intelligence"     element={<FleetIntelligence />} />
                    <Route path="/advanced-analytics"    element={<AdvancedAnalytics />} />
                    <Route path="/ai-command-center"     element={<AiCommandCenter />} />
                    <Route path="/executive-report"      element={<ExecutiveReport />} />
                    <Route path="/forecasting"           element={<ForecastingEngine />} />
                    <Route path="/continuous-improvement" element={<ContinuousImprovement />} />
                    <Route path="/erp-sync"              element={<ErpSync />} />
                    <Route path="/work-orders"           element={<WorkOrders />} />
                    <Route path="/maintenance-calendar" element={<MaintenanceCalendar />} />
                    <Route path="/driver-management" element={<DriverManagement />} />
                    <Route path="/safety-compliance" element={<SafetyCompliance />} />
                    <Route path="/cost-center"       element={<CostCenter />} />
                    <Route path="/benchmark"         element={<PerformanceBenchmark />} />
                    <Route path="/procurement"       element={<Procurement />} />
                    <Route path="/tyre-size"         element={<TyreSizeAnalysis />} />
                    <Route path="/downtime"          element={<DowntimeTracker />} />
                    <Route path="/budget-planner"    element={<BudgetPlanner />} />
                    <Route path="/fleet-health"      element={<FleetHealthBoard />} />
                    <Route path="/tyre-lifecycle"    element={<TyreLifecycle />} />
                    <Route path="/workshop"          element={<WorkshopManagement />} />
                    <Route path="/pressure-intel"   element={<PressureIntelligence />} />
                    <Route path="/suppliers"        element={<SupplierManagement />} />
                    <Route path="/fuel-efficiency"  element={<FuelEfficiency />} />
                    <Route path="/daily-ops"        element={<DailyOps />} />
                    <Route path="/rotation"         element={<RotationSchedule />} />
                    <Route path="/kpi-command"      element={<KpiCommandCenter />} />
                    <Route path="/recall-tracker"   element={<RecallTracker />} />
                    <Route path="/warranty"         element={<WarrantyTracker />} />
                    <Route path="/tyre-exchange"    element={<TyreExchange />} />
                    <Route path="/tyre-specs"       element={<TyreSpecifications />} />
                    <Route path="/assets"              element={<AssetManagement />} />
                    <Route path="/inspection-planner" element={<InspectionPlanner />} />
                    <Route path="/retread"             element={<RetreadManagement />} />
                    <Route path="/live-fleet"          element={<LiveFleetStatus />} />
                    <Route path="/compliance"          element={<ComplianceDashboard />} />
                    <Route path="/scrap"               element={<TyreScrapManagement />} />
                    <Route path="/stock-replenishment" element={<StockReplenishment />} />
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
