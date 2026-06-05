import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import ProtectedRoute from './components/ProtectedRoute'
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
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
                    <Route path="/rca"         element={<RcaRecords />} />
                    <Route path="/inspections" element={<Inspections />} />
                    <Route path="/alerts"      element={<Alerts />} />
                    <Route path="/anomalies"     element={<Anomalies />} />
                    <Route path="/country-comp" element={<CountryComparison />} />
                    <Route path="/vehicle-history" element={<VehicleHistory />} />
                    <Route path="/fleet-master"   element={<FleetMaster />} />
                    <Route path="/ai"          element={<AiAnalytics />} />
                    <Route path="/cleaning"    element={<DataCleaning />} />
                    <Route path="/upload"      element={<UploadData />} />
                    <Route path="/audit"       element={<AuditTrail />} />
                    <Route path="/settings"    element={<Settings />} />
                    <Route path="/users"       element={<UserManagement />} />
                    <Route path="*"            element={<Navigate to="/" replace />} />
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
