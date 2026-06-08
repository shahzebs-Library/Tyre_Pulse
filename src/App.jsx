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
