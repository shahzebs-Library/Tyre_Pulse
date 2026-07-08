import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { SettingsProvider } from './contexts/SettingsContext'
import { TenantProvider } from './contexts/TenantContext'
import { CommandPaletteProvider } from './contexts/CommandPaletteContext'
import ProtectedRoute, { RoleRoute, ModuleRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import ErrorBoundary from './components/ErrorBoundary'
import { useFeatureGate } from './hooks/useFeatureFlags'
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

// ── Lazy page imports ─────────────────────────────────────────────────────
const Login                  = lazy(() => import('./pages/Login'))
const Dashboard              = lazy(() => import('./pages/Dashboard'))
const TyreRecords            = lazy(() => import('./pages/TyreRecords'))
const StockManagement        = lazy(() => import('./pages/StockManagement'))
const Budgets                = lazy(() => import('./pages/Budgets'))
const CorrectiveActions      = lazy(() => import('./pages/CorrectiveActions'))
const RcaRecords             = lazy(() => import('./pages/RcaRecords'))
const DataCleaning           = lazy(() => import('./pages/DataCleaning'))
const UploadData             = lazy(() => import('./pages/UploadData'))
const DataIntakeCenter       = lazy(() => import('./pages/DataIntakeCenter'))
const DataIntakeHistory      = lazy(() => import('./pages/DataIntakeHistory'))
const UploadApprovals        = lazy(() => import('./pages/UploadApprovals'))
const Settings               = lazy(() => import('./pages/Settings'))
const Analytics              = lazy(() => import('./pages/Analytics'))
const BrandPerformance       = lazy(() => import('./pages/BrandPerformance'))
const SiteComparison         = lazy(() => import('./pages/SiteComparison'))
const FleetAnalytics         = lazy(() => import('./pages/FleetAnalytics'))
const KpiScorecard           = lazy(() => import('./pages/KpiScorecard'))
const Inspections            = lazy(() => import('./pages/Inspections'))
const Alerts                 = lazy(() => import('./pages/Alerts'))
const Anomalies              = lazy(() => import('./pages/Anomalies'))
const CountryComparison      = lazy(() => import('./pages/CountryComparison'))
const VehicleHistory         = lazy(() => import('./pages/VehicleHistory'))
const UserManagement         = lazy(() => import('./pages/UserManagement'))
const AiAnalytics            = lazy(() => import('./pages/AiAnalytics'))
const FleetMaster            = lazy(() => import('./pages/FleetMaster'))
const Vehicle360             = lazy(() => import('./pages/Vehicle360'))
const AuditTrail             = lazy(() => import('./pages/AuditTrail'))
const ResetPassword          = lazy(() => import('./pages/ResetPassword'))
const Accidents              = lazy(() => import('./pages/Accidents'))
const Reports                = lazy(() => import('./pages/Reports'))
const GatePass               = lazy(() => import('./pages/GatePass'))
const SerialTracker          = lazy(() => import('./pages/SerialTracker'))
const Comparison             = lazy(() => import('./pages/Comparison'))
const EngineeringKpi         = lazy(() => import('./pages/EngineeringKpi'))
const PositionIntelligence   = lazy(() => import('./pages/PositionIntelligence'))
const InspectionIntelligence = lazy(() => import('./pages/InspectionIntelligence'))
const RootCauseEngine        = lazy(() => import('./pages/RootCauseEngine'))
const PredictiveMaintenance  = lazy(() => import('./pages/PredictiveMaintenance'))
const VendorIntelligence     = lazy(() => import('./pages/VendorIntelligence'))
const FleetIntelligence      = lazy(() => import('./pages/FleetIntelligence'))
const AdvancedAnalytics      = lazy(() => import('./pages/AdvancedAnalytics'))
const AiCommandCenter        = lazy(() => import('./pages/AiCommandCenter'))
const ExecutiveReport        = lazy(() => import('./pages/ExecutiveReport'))
const ForecastingEngine      = lazy(() => import('./pages/ForecastingEngine'))
const ContinuousImprovement  = lazy(() => import('./pages/ContinuousImprovement'))
const ErpSync                = lazy(() => import('./pages/ErpSync'))
const WorkOrders             = lazy(() => import('./pages/WorkOrders'))
const MaintenanceCalendar    = lazy(() => import('./pages/MaintenanceCalendar'))
const DriverManagement       = lazy(() => import('./pages/DriverManagement'))
const SafetyCompliance       = lazy(() => import('./pages/SafetyCompliance'))
const CostCenter             = lazy(() => import('./pages/CostCenter'))
const PerformanceBenchmark   = lazy(() => import('./pages/PerformanceBenchmark'))
const Procurement            = lazy(() => import('./pages/Procurement'))
const TyreSizeAnalysis       = lazy(() => import('./pages/TyreSizeAnalysis'))
const DowntimeTracker        = lazy(() => import('./pages/DowntimeTracker'))
const BudgetPlanner          = lazy(() => import('./pages/BudgetPlanner'))
const FleetHealthBoard       = lazy(() => import('./pages/FleetHealthBoard'))
const TyreLifecycle          = lazy(() => import('./pages/TyreLifecycle'))
const WorkshopManagement     = lazy(() => import('./pages/WorkshopManagement'))
const PressureIntelligence   = lazy(() => import('./pages/PressureIntelligence'))
const SupplierManagement     = lazy(() => import('./pages/SupplierManagement'))
const FuelEfficiency         = lazy(() => import('./pages/FuelEfficiency'))
const DailyOps               = lazy(() => import('./pages/DailyOps'))
const RotationSchedule       = lazy(() => import('./pages/RotationSchedule'))
const KpiCommandCenter       = lazy(() => import('./pages/KpiCommandCenter'))
const RecallTracker          = lazy(() => import('./pages/RecallTracker'))
const WarrantyTracker        = lazy(() => import('./pages/WarrantyTracker'))
const TyreExchange           = lazy(() => import('./pages/TyreExchange'))
const TyreSpecifications     = lazy(() => import('./pages/TyreSpecifications'))
const AssetManagement        = lazy(() => import('./pages/AssetManagement'))
const InspectionPlanner      = lazy(() => import('./pages/InspectionPlanner'))
const RetreadManagement      = lazy(() => import('./pages/RetreadManagement'))
const LiveFleetStatus        = lazy(() => import('./pages/LiveFleetStatus'))
const ComplianceDashboard    = lazy(() => import('./pages/ComplianceDashboard'))
const TyreScrapManagement    = lazy(() => import('./pages/TyreScrapManagement'))
const StockReplenishment     = lazy(() => import('./pages/StockReplenishment'))
const TyreScan               = lazy(() => import('./pages/TyreScan'))
const QrLabels               = lazy(() => import('./pages/QrLabels'))
const CustomData             = lazy(() => import('./pages/CustomData'))
const ScheduledReports       = lazy(() => import('./pages/ScheduledReports'))
const ReportCenter           = lazy(() => import('./pages/ReportCenter'))
const KnowledgeBase          = lazy(() => import('./pages/KnowledgeBase'))
const AiCostMonitor          = lazy(() => import('./pages/AiCostMonitor'))
const DisplayDashboard       = lazy(() => import('./pages/DisplayDashboard'))
const ReportBuilder          = lazy(() => import('./pages/ReportBuilder'))
const SystemHealth           = lazy(() => import('./pages/SystemHealth'))
const SecurityCenter         = lazy(() => import('./pages/SecurityCenter'))
const DashboardBuilder       = lazy(() => import('./pages/DashboardBuilder'))
const TenantHealth           = lazy(() => import('./pages/TenantHealth'))
const ExecutiveAnalytics     = lazy(() => import('./pages/ExecutiveAnalytics'))
const PermissionMatrix       = lazy(() => import('./pages/PermissionMatrix'))
const DisplayShare           = lazy(() => import('./pages/DisplayShare'))
const EventStream            = lazy(() => import('./pages/EventStream'))
const Approvals              = lazy(() => import('./pages/Approvals'))
const WorkflowSettings       = lazy(() => import('./pages/WorkflowSettings'))
const AutomationRules        = lazy(() => import('./pages/AutomationRules'))
const Integrations           = lazy(() => import('./pages/Integrations'))
const Billing                = lazy(() => import('./pages/Billing'))

// ── Per-page error boundary ───────────────────────────────────────────────
function Safe({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>
}

// ── Feature-flag gate (org-level toggles from Settings → Feature flags) ───
// Fails open while flags load; disabled features redirect home like ModuleRoute.
function FlagRoute({ flag, children }) {
  const enabled = useFeatureGate(flag)
  if (!enabled) return <Navigate to="/" replace />
  return children
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
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
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
      <TenantProvider>
      <CommandPaletteProvider>
        <PwaUpdatePrompt />
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/login"          element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Public read-only executive board (V103 share token) — ANON, no chrome,
                no ProtectedRoute/flag: the RPC is anon-granted and the page degrades
                gracefully until V103 is applied. */}
            <Route path="/display/:token" element={<Safe><DisplayShare /></Safe>} />
            {/* TV display mode: authed, but rendered WITHOUT the Layout chrome */}
            <Route
              path="/display"
              element={
                <ProtectedRoute>
                  <FlagRoute flag="tv_display"><Safe><DisplayDashboard /></Safe></FlagRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/"            element={<Safe><HomeRoute /></Safe>} />
                      <Route path="/tyres"       element={<Safe><ModuleRoute moduleKey="tyre_records"><TyreRecords /></ModuleRoute></Safe>} />
                      {/* ── Analytics ── */}
                      <Route path="/analytics"    element={<Safe><ModuleRoute moduleKey="analytics"><Analytics /></ModuleRoute></Safe>} />
                      <Route path="/brand-perf"   element={<Safe><ModuleRoute moduleKey="brand_performance"><BrandPerformance /></ModuleRoute></Safe>} />
                      <Route path="/site-comp"    element={<Safe><ModuleRoute moduleKey="site_comparison"><SiteComparison /></ModuleRoute></Safe>} />
                      <Route path="/fleet"        element={<Safe><ModuleRoute moduleKey="fleet_analytics"><FleetAnalytics /></ModuleRoute></Safe>} />
                      <Route path="/kpi"          element={<Safe><ModuleRoute moduleKey="kpi_scorecard"><KpiScorecard /></ModuleRoute></Safe>} />
                      <Route path="/country-comp" element={<Safe><ModuleRoute moduleKey="country_comparison"><CountryComparison /></ModuleRoute></Safe>} />
                      <Route path="/comparison"   element={<Safe><ModuleRoute moduleKey="analytics"><Comparison /></ModuleRoute></Safe>} />
                      {/* ── Operations ── */}
                      <Route path="/stock"       element={<Safe><ModuleRoute moduleKey="stock"><StockManagement /></ModuleRoute></Safe>} />
                      <Route path="/budgets"     element={<Safe><ModuleRoute moduleKey="budgets"><Budgets /></ModuleRoute></Safe>} />
                      <Route path="/actions"     element={<Safe><ModuleRoute moduleKey="corrective_actions"><CorrectiveActions /></ModuleRoute></Safe>} />
                      <Route path="/accidents"   element={<Safe><FlagRoute flag="accidents_module"><Accidents /></FlagRoute></Safe>} />
                      <Route path="/rca"         element={<Safe><ModuleRoute moduleKey="rca"><RcaRecords /></ModuleRoute></Safe>} />
                      <Route path="/inspections" element={<Safe><ModuleRoute moduleKey="inspections"><Inspections /></ModuleRoute></Safe>} />
                      <Route path="/alerts"      element={<Safe><ModuleRoute moduleKey="alerts"><Alerts /></ModuleRoute></Safe>} />
                      <Route path="/fleet-master"         element={<Safe><ModuleRoute moduleKey="fleet_master"><FleetMaster /></ModuleRoute></Safe>} />
                      <Route path="/vehicle/:assetNo"     element={<Safe><FlagRoute flag="vehicle_360"><Vehicle360 /></FlagRoute></Safe>} />
                      <Route path="/reports"              element={<Safe><ModuleRoute moduleKey="reports"><Reports /></ModuleRoute></Safe>} />
                      <Route path="/report-center"       element={<Safe><ModuleRoute moduleKey="reports"><ReportCenter /></ModuleRoute></Safe>} />
                      <Route path="/scheduled-reports"   element={<Safe><FlagRoute flag="report_scheduling"><ScheduledReports /></FlagRoute></Safe>} />
                      <Route path="/knowledge-base"       element={<Safe><FlagRoute flag="ai_tools"><KnowledgeBase /></FlagRoute></Safe>} />
                      <Route path="/ai-cost-monitor"      element={<Safe><FlagRoute flag="ai_tools"><AiCostMonitor /></FlagRoute></Safe>} />
                      <Route path="/gate-pass"            element={<Safe><ModuleRoute moduleKey="gate_pass"><GatePass /></ModuleRoute></Safe>} />
                      <Route path="/serial-tracker"       element={<Safe><SerialTracker /></Safe>} />
                      <Route path="/work-orders"          element={<Safe><ModuleRoute moduleKey="work_orders"><WorkOrders /></ModuleRoute></Safe>} />
                      <Route path="/maintenance-calendar" element={<Safe><MaintenanceCalendar /></Safe>} />
                      <Route path="/safety-compliance"    element={<Safe><SafetyCompliance /></Safe>} />
                      <Route path="/assets"               element={<Safe><ModuleRoute moduleKey="fleet_master"><AssetManagement /></ModuleRoute></Safe>} />
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
                      <Route path="/ai-command-center"       element={<Safe><FlagRoute flag="ai_tools"><ModuleRoute moduleKey="ai_command_center"><AiCommandCenter /></ModuleRoute></FlagRoute></Safe>} />
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
                      <Route path="/erp-sync"                element={<Safe><FlagRoute flag="erp_sync"><ModuleRoute moduleKey="erp_sync"><ErpSync /></ModuleRoute></FlagRoute></Safe>} />
                      <Route path="/anomalies"               element={<Safe><ModuleRoute moduleKey="tyre_records"><Anomalies /></ModuleRoute></Safe>} />
                      <Route path="/vehicle-history"         element={<Safe><ModuleRoute moduleKey="fleet_master"><VehicleHistory /></ModuleRoute></Safe>} />
                      <Route path="/ai"                      element={<Safe><FlagRoute flag="ai_tools"><ModuleRoute moduleKey="ai_analytics"><AiAnalytics /></ModuleRoute></FlagRoute></Safe>} />
                      {/* ── Data ── */}
                      <Route path="/cleaning"    element={<Safe><ModuleRoute moduleKey="data_cleaning"><DataCleaning /></ModuleRoute></Safe>} />
                      <Route path="/audit"       element={<Safe><ModuleRoute moduleKey="audit_trail"><AuditTrail /></ModuleRoute></Safe>} />
                      <Route path="/users"       element={<Safe><ModuleRoute moduleKey="user_management"><UserManagement /></ModuleRoute></Safe>} />
                      {/* ── Universal ── */}
                      <Route path="/upload"      element={<Safe><FlagRoute flag="data_intake"><UploadData /></FlagRoute></Safe>} />
                      <Route path="/data-intake" element={<Safe><FlagRoute flag="data_intake"><DataIntakeCenter /></FlagRoute></Safe>} />
                      <Route path="/data-intake/history" element={<Safe><FlagRoute flag="data_intake"><DataIntakeHistory /></FlagRoute></Safe>} />
                      <Route path="/upload-approvals" element={<Safe><FlagRoute flag="data_intake"><UploadApprovals /></FlagRoute></Safe>} />
                      <Route path="/custom-data" element={<Safe><ModuleRoute moduleKey="custom_data"><CustomData /></ModuleRoute></Safe>} />
                      <Route path="/settings"    element={<Safe><Settings /></Safe>} />
                      <Route path="/scan"        element={<Safe><TyreScan /></Safe>} />
                      <Route path="/qr-labels"   element={<Safe><QrLabels /></Safe>} />
                      {/* ── Platform (roadmap tranche: pages self-gate their roles) ── */}
                      <Route path="/report-builder"      element={<Safe><ReportBuilder /></Safe>} />
                      <Route path="/dashboard-builder"   element={<Safe><DashboardBuilder /></Safe>} />
                      <Route path="/executive-analytics" element={<Safe><ExecutiveAnalytics /></Safe>} />
                      <Route path="/security-center"     element={<Safe><SecurityCenter /></Safe>} />
                      <Route path="/system-health"       element={<Safe><SystemHealth /></Safe>} />
                      <Route path="/tenant-health"       element={<Safe><TenantHealth /></Safe>} />
                      <Route path="/permission-matrix"   element={<Safe><PermissionMatrix /></Safe>} />
                      {/* ── Commercial: Subscription & Billing (roadmap #6) ── */}
                      <Route path="/billing"             element={<Safe><FlagRoute flag="billing"><Billing /></FlagRoute></Safe>} />
                      {/* ── Automation platform (backend V96–V103; flag OFF until DB applied) ── */}
                      <Route path="/events"              element={<Safe><FlagRoute flag="automation_platform"><EventStream /></FlagRoute></Safe>} />
                      <Route path="/approvals"           element={<Safe><FlagRoute flag="automation_platform"><Approvals /></FlagRoute></Safe>} />
                      <Route path="/workflow-settings"   element={<Safe><FlagRoute flag="automation_platform"><WorkflowSettings /></FlagRoute></Safe>} />
                      <Route path="/automation-rules"    element={<Safe><FlagRoute flag="automation_platform"><AutomationRules /></FlagRoute></Safe>} />
                      <Route path="/integrations"        element={<Safe><FlagRoute flag="automation_platform"><Integrations /></FlagRoute></Safe>} />
                      <Route path="*"            element={<Navigate to="/" replace />} />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </CommandPaletteProvider>
      </TenantProvider>
      </SettingsProvider>
    </AuthProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <LanguageProvider>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* ── System Console - completely isolated from main app ── */}
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
    </LanguageProvider>
    </QueryClientProvider>
  )
}
