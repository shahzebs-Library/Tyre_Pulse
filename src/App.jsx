import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isChecklistOnlyRole, isChecklistPathAllowed, CHECKLIST_AUTHOR_ROLES } from './lib/checklistAccess'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { TenantProvider } from './contexts/TenantContext'
import { CommandPaletteProvider } from './contexts/CommandPaletteContext'
import ProtectedRoute, { RoleRoute, ModuleRoute, SuperAdminRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import ErrorBoundary from './components/ErrorBoundary'
import { useFeatureGate } from './hooks/useFeatureFlags'
// Console (completely isolated auth context)
import { ConsoleAuthProvider, useConsoleAuth } from './console/ConsoleAuthContext'
import ConsoleLayout from './console/components/ConsoleLayout'
import ConsoleAuthBridge from './console/ConsoleAuthBridge'
// Console pages are admin/super-admin only and rarely loaded; lazy-load them so
// their code stays out of the main entry chunk for the typical user.
const ConsoleLogin         = lazy(() => import('./console/pages/ConsoleLogin'))
const ConsoleDashboard     = lazy(() => import('./console/pages/ConsoleDashboard'))
const ConsoleOrganisations = lazy(() => import('./console/pages/ConsoleOrganisations'))
const ConsoleUsers         = lazy(() => import('./console/pages/ConsoleUsers'))
const ConsolePermissions   = lazy(() => import('./console/pages/ConsolePermissions'))
const ConsoleAIUsage       = lazy(() => import('./console/pages/ConsoleAIUsage'))
const ConsoleAuditLog      = lazy(() => import('./console/pages/ConsoleAuditLog'))
const ConsoleAnnouncements = lazy(() => import('./console/pages/ConsoleAnnouncements'))
const ConsoleSystemConfig  = lazy(() => import('./console/pages/ConsoleSystemConfig'))
const ConsoleReportAppearance = lazy(() => import('./console/pages/ConsoleReportAppearance'))
const ConsoleSystemHealth  = lazy(() => import('./console/pages/ConsoleSystemHealth'))
const ConsoleBackups       = lazy(() => import('./console/pages/ConsoleBackups'))
const ConsoleAdminRoles    = lazy(() => import('./console/pages/ConsoleAdminRoles'))
const ConsoleAuditTrail    = lazy(() => import('./console/pages/ConsoleAuditTrail'))
const ConsoleAlertRules    = lazy(() => import('./console/pages/ConsoleAlertRules'))
const ConsoleModuleControl = lazy(() => import('./console/pages/ConsoleModuleControl'))
const ConsoleSelfHealing   = lazy(() => import('./console/pages/ConsoleSelfHealing'))
const ConsoleDataBrowser   = lazy(() => import('./console/pages/ConsoleDataBrowser'))
const ConsoleVehicleDesigner = lazy(() => import('./console/pages/ConsoleVehicleDesigner'))
const ConsoleNavigation    = lazy(() => import('./console/pages/ConsoleNavigation'))
const ConsoleCrashReports  = lazy(() => import('./console/pages/ConsoleCrashReports'))
const ConsoleSessions      = lazy(() => import('./console/pages/ConsoleSessions'))
const ConsoleAutomation    = lazy(() => import('./console/pages/ConsoleAutomation'))
const ConsoleDelivery      = lazy(() => import('./console/pages/ConsoleDelivery'))

// Console admin pages built in parallel by other agents. Resolved via
// import.meta.glob so this build succeeds whether or not the files exist yet: a
// missing file is simply absent from the map and renders a placeholder; once
// present it is code-split and bundled normally.
const consolePageModules = import.meta.glob('./console/pages/*.jsx')
function ConsoleModulePlaceholder({ label }) {
  return <div className="p-8 text-sm text-gray-400">Loading {label} module</div>
}
function lazyConsolePage(name, label) {
  return lazy(() => {
    const importer = consolePageModules[`./console/pages/${name}.jsx`]
    return importer
      ? importer()
      : Promise.resolve({ default: () => <ConsoleModulePlaceholder label={label} /> })
  })
}
const ConsoleAccessControl = lazyConsolePage('ConsoleAccessControl', 'Access Control')
const ConsoleSecurity      = lazyConsolePage('ConsoleSecurity', 'Security')
const ConsoleSystem        = lazyConsolePage('ConsoleSystem', 'System')

// ── Lazy page imports ─────────────────────────────────────────────────────
const Login                  = lazy(() => import('./pages/Login'))
const Dashboard              = lazy(() => import('./pages/Dashboard'))
const TyreRecords            = lazy(() => import('./pages/TyreRecords'))
const StockManagement        = lazy(() => import('./pages/StockManagement'))
const Budgets                = lazy(() => import('./pages/Budgets'))
const CorrectiveActions      = lazy(() => import('./pages/CorrectiveActions'))
const RcaRecords             = lazy(() => import('./pages/RcaRecords'))
const DataCleaning           = lazy(() => import('./pages/DataCleaning'))
const DataReconciliation     = lazy(() => import('./pages/DataReconciliation'))
const ErpImport              = lazy(() => import('./pages/ErpImport'))
const UploadData             = lazy(() => import('./pages/UploadData'))
const DataIntakeCenter       = lazy(() => import('./pages/DataIntakeCenter'))
const NotFound               = lazy(() => import('./pages/NotFound'))
const DataIntakeHistory      = lazy(() => import('./pages/DataIntakeHistory'))
const Checklists             = lazy(() => import('./pages/Checklists'))
const ChecklistBuilder       = lazy(() => import('./pages/ChecklistBuilder'))
const ChecklistRun           = lazy(() => import('./pages/ChecklistRun'))
const ChecklistSubmission    = lazy(() => import('./pages/ChecklistSubmission'))
const ChecklistInsights      = lazy(() => import('./pages/ChecklistInsights'))
const ChecklistSchedules     = lazy(() => import('./pages/ChecklistSchedules'))
const MyChecklists           = lazy(() => import('./pages/MyChecklists'))
const UploadApprovals        = lazy(() => import('./pages/UploadApprovals'))
const Settings               = lazy(() => import('./pages/Settings'))
const HelpCenter             = lazy(() => import('./pages/HelpCenter'))
const TyreAgeCompliance      = lazy(() => import('./pages/TyreAgeCompliance'))
const RoiCalculator          = lazy(() => import('./pages/RoiCalculator'))
const TyrePassport           = lazy(() => import('./pages/TyrePassport'))
const FitmentValidation      = lazy(() => import('./pages/FitmentValidation'))
const TechnicianScorecard    = lazy(() => import('./pages/TechnicianScorecard'))
const TcoCalculator          = lazy(() => import('./pages/TcoCalculator'))
const TyrePool               = lazy(() => import('./pages/TyrePool'))
const OpsIntelligence        = lazy(() => import('./pages/OpsIntelligence'))
const FleetRiskScore         = lazy(() => import('./pages/FleetRiskScore'))
const RotationOptimizer      = lazy(() => import('./pages/RotationOptimizer'))
const CostScenarioPlanner    = lazy(() => import('./pages/CostScenarioPlanner'))
const CarbonTracker          = lazy(() => import('./pages/CarbonTracker'))
const Tpms                   = lazy(() => import('./pages/Tpms'))
const Contracts              = lazy(() => import('./pages/Contracts'))
const Rfid                   = lazy(() => import('./pages/Rfid'))
const Geofencing             = lazy(() => import('./pages/Geofencing'))
const InsuranceClaims        = lazy(() => import('./pages/InsuranceClaims'))
const FuelCards              = lazy(() => import('./pages/FuelCards'))
const Certifications         = lazy(() => import('./pages/Certifications'))
const PolicyManagement       = lazy(() => import('./pages/PolicyManagement'))
const IncidentReports        = lazy(() => import('./pages/IncidentReports'))
const JourneyLog             = lazy(() => import('./pages/JourneyLog'))
const DigitalTwin            = lazy(() => import('./pages/DigitalTwin'))
const PartsCatalog           = lazy(() => import('./pages/PartsCatalog'))
const Combinations           = lazy(() => import('./pages/Combinations'))
const Dispatch               = lazy(() => import('./pages/Dispatch'))
const ColdChain              = lazy(() => import('./pages/ColdChain'))
const VehicleCheckInOut      = lazy(() => import('./pages/VehicleCheckInOut'))
const RetreadClaims          = lazy(() => import('./pages/RetreadClaims'))
const Batteries              = lazy(() => import('./pages/Batteries'))
const TelematicsDevices      = lazy(() => import('./pages/TelematicsDevices'))
const FuelDelivery           = lazy(() => import('./pages/FuelDelivery'))
const ShiftScheduling        = lazy(() => import('./pages/ShiftScheduling'))
const Equipment              = lazy(() => import('./pages/Equipment'))
const TyreServiceEvents      = lazy(() => import('./pages/TyreServiceEvents'))
const DriverExpenses         = lazy(() => import('./pages/DriverExpenses'))
const SpeedLimiter           = lazy(() => import('./pages/SpeedLimiter'))
const DriverDocuments        = lazy(() => import('./pages/DriverDocuments'))
const Dvir                   = lazy(() => import('./pages/Dvir'))
const Requisitions           = lazy(() => import('./pages/Requisitions'))
const GoodsReceipt           = lazy(() => import('./pages/GoodsReceipt'))
const Customers              = lazy(() => import('./pages/Customers'))
const FleetRenewal           = lazy(() => import('./pages/FleetRenewal'))
const DtcDiagnostics         = lazy(() => import('./pages/DtcDiagnostics'))
const EngineHours            = lazy(() => import('./pages/EngineHours'))
const OdometerLogs           = lazy(() => import('./pages/OdometerLogs'))
const PmPrograms             = lazy(() => import('./pages/PmPrograms'))
const VehicleWashing         = lazy(() => import('./pages/VehicleWashing'))
const Trips                  = lazy(() => import('./pages/Trips'))
const RouteOptimization      = lazy(() => import('./pages/RouteOptimization'))
const ChargingSessions       = lazy(() => import('./pages/ChargingSessions'))
const LoadPlanning           = lazy(() => import('./pages/LoadPlanning'))
const VideoTelematics        = lazy(() => import('./pages/VideoTelematics'))
const TollTransactions       = lazy(() => import('./pages/TollTransactions'))
const DriverSafety           = lazy(() => import('./pages/DriverSafety'))
const GpsTracking            = lazy(() => import('./pages/GpsTracking'))
const HoursOfService         = lazy(() => import('./pages/HoursOfService'))
const IftaReporting          = lazy(() => import('./pages/IftaReporting'))
const ServiceRequests        = lazy(() => import('./pages/ServiceRequests'))
const VehicleReservations    = lazy(() => import('./pages/VehicleReservations'))
const BreakdownCallouts      = lazy(() => import('./pages/BreakdownCallouts'))
const Weighbridge            = lazy(() => import('./pages/Weighbridge'))
const Emissions              = lazy(() => import('./pages/Emissions'))
const ProofOfDelivery        = lazy(() => import('./pages/ProofOfDelivery'))
const FuelTheftAlerts        = lazy(() => import('./pages/FuelTheftAlerts'))
const VehicleHandover        = lazy(() => import('./pages/VehicleHandover'))
const DriverTraining         = lazy(() => import('./pages/DriverTraining'))
const Tachograph             = lazy(() => import('./pages/Tachograph'))
const BayScheduling          = lazy(() => import('./pages/BayScheduling'))
const SlaDashboard           = lazy(() => import('./pages/SlaDashboard'))
const ActionCenter           = lazy(() => import('./pages/ActionCenter'))
const DriverCoaching         = lazy(() => import('./pages/DriverCoaching'))
const HeatIntelligence       = lazy(() => import('./pages/HeatIntelligence'))
const FleetGroups            = lazy(() => import('./pages/FleetGroups'))
const Materials              = lazy(() => import('./pages/Materials'))
const TripReplay             = lazy(() => import('./pages/TripReplay'))
const FleetOptimizer         = lazy(() => import('./pages/FleetOptimizer'))
const CustomerPortal         = lazy(() => import('./pages/CustomerPortal'))
const DeveloperPortal        = lazy(() => import('./pages/DeveloperPortal'))
const Taas                   = lazy(() => import('./pages/Taas'))
const SupplierMarketplace    = lazy(() => import('./pages/SupplierMarketplace'))
const OcrScanner             = lazy(() => import('./pages/OcrScanner'))
const AdvancedSearch         = lazy(() => import('./pages/AdvancedSearch'))
const OnboardingWizard       = lazy(() => import('./pages/OnboardingWizard'))
const SsoConfiguration       = lazy(() => import('./pages/SsoConfiguration'))
const HoldingCompany         = lazy(() => import('./pages/HoldingCompany'))
const OrgHierarchy           = lazy(() => import('./pages/OrgHierarchy'))
const AdminConsole           = lazy(() => import('./pages/AdminConsole'))
const ApprovalDelegations    = lazy(() => import('./pages/ApprovalDelegations'))
const Analytics              = lazy(() => import('./pages/Analytics'))
const BrandPerformance       = lazy(() => import('./pages/BrandPerformance'))
const SiteComparison         = lazy(() => import('./pages/SiteComparison'))
const FleetAnalytics         = lazy(() => import('./pages/FleetAnalytics'))
const KpiScorecard           = lazy(() => import('./pages/KpiScorecard'))
const Inspections            = lazy(() => import('./pages/Inspections'))
const Alerts                 = lazy(() => import('./pages/Alerts'))
const AlertThresholds        = lazy(() => import('./pages/AlertThresholds'))
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
const AccidentDetail         = lazy(() => import('./components/AccidentDetailModal'))
const ClaimsSummary          = lazy(() => import('./pages/ClaimsSummary'))
const Reports                = lazy(() => import('./pages/Reports'))
const GatePass               = lazy(() => import('./pages/GatePass'))
const SerialTracker          = lazy(() => import('./pages/SerialTracker'))
const RfidRegistry           = lazy(() => import('./pages/RfidRegistry'))
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
const BoardOverview          = lazy(() => import('./pages/BoardOverview'))
const ReportSharing          = lazy(() => import('./pages/ReportSharing'))
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
const SiteManagement         = lazy(() => import('./pages/SiteManagement'))
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
const AiAdministration       = lazy(() => import('./pages/AiAdministration'))
const DisplayDashboard       = lazy(() => import('./pages/DisplayDashboard'))
const ReportBuilder          = lazy(() => import('./pages/ReportBuilder'))
const SystemHealth           = lazy(() => import('./pages/SystemHealth'))
const SecurityCenter         = lazy(() => import('./pages/SecurityCenter'))
const DashboardBuilder       = lazy(() => import('./pages/DashboardBuilder'))
const TenantHealth           = lazy(() => import('./pages/TenantHealth'))
const ExecutiveAnalytics     = lazy(() => import('./pages/ExecutiveAnalytics'))
const PermissionMatrix       = lazy(() => import('./pages/PermissionMatrix'))
const MasterAccessControl    = lazy(() => import('./pages/MasterAccessControl'))
const ReportShare            = lazy(() => import('./pages/ReportShare'))
const DataDeletion           = lazy(() => import('./pages/DataDeletion'))
const Privacy                = lazy(() => import('./pages/Privacy'))
const EventStream            = lazy(() => import('./pages/EventStream'))
const Approvals              = lazy(() => import('./pages/Approvals'))
const WorkflowSettings       = lazy(() => import('./pages/WorkflowSettings'))
const AutomationRules        = lazy(() => import('./pages/AutomationRules'))
const Integrations           = lazy(() => import('./pages/Integrations'))
const Billing                = lazy(() => import('./pages/Billing'))
const BrandAssets            = lazy(() => import('./pages/BrandAssets'))
// ── Detail & builder pages (modal→page conversions, Session 15) ──
const AssetDetail            = lazy(() => import('./pages/AssetDetail'))
const SupplierDetail         = lazy(() => import('./pages/SupplierDetail'))
const DriverDetail           = lazy(() => import('./pages/DriverDetail'))
const WorkshopJobDetail      = lazy(() => import('./pages/WorkshopJobDetail'))
const WorkflowBuilder        = lazy(() => import('./pages/WorkflowBuilder'))
const RuleBuilder            = lazy(() => import('./pages/RuleBuilder'))
const RecallDetail           = lazy(() => import('./pages/RecallDetail'))

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
  if (isChecklistOnlyRole(profile?.role)) return <Navigate to="/checklists" replace />
  if (profile?.role === 'Tyre Man') return <Navigate to="/inspections" replace />
  if (profile?.role === 'Data Monitor Officer') return <Navigate to="/accidents" replace />
  return <Dashboard />
}

// ── Checklist-only access gate ────────────────────────────────────────────────
// A Maintenance Supervisor may reach ONLY the checklist routes; any other path
// bounces back to the checklist home. Combined with the reduced sidebar, the
// rest of the app is out of reach for this role.
function ChecklistOnlyGate({ children }) {
  const { profile } = useAuth()
  const loc = useLocation()
  if (isChecklistOnlyRole(profile?.role) && !isChecklistPathAllowed(loc.pathname)) {
    return <Navigate to="/checklists" replace />
  }
  return children
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

// ── Maintenance gate: when Maintenance Mode is ON (System Configuration), regular
// users see a calm maintenance screen instead of the app. Super-admins / Admins
// pass through (they administer the toggle). Data access is unaffected; this is a
// user-facing pause. Sits inside SettingsProvider so it reads the global config.
function MaintenanceGate({ children }) {
  const { maintenanceActive, systemConfig } = useSettings()
  if (!maintenanceActive) return children
  let msg = 'System maintenance in progress. We will be back shortly.'
  const raw = systemConfig?.maintenance_message
  if (raw) { try { msg = JSON.parse(raw) } catch { msg = String(raw) } }
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
          style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
          <span className="text-4xl">🛠️</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-3">Under maintenance</h2>
        <p className="text-gray-400 text-sm leading-relaxed">{msg}</p>
        <button
          onClick={() => import('./lib/supabase').then(m => m.supabase.auth.signOut())}
          className="mt-6 text-sm text-gray-500 hover:text-green-400 transition-colors">
          Sign out
        </button>
      </div>
    </div>
  )
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
            {/* PUBLIC account & data deletion page - the URL for the Google Play
                Data Safety form's deletion mechanism. Anon, no app shell. */}
            <Route path="/data-deletion"   element={<Safe><DataDeletion /></Safe>} />
            <Route path="/delete-account"  element={<Navigate to="/data-deletion" replace />} />
            {/* PUBLIC privacy policy - the URL for Play Console App content + Data Safety. */}
            <Route path="/privacy"         element={<Safe><Privacy /></Safe>} />
            <Route path="/privacy-policy"  element={<Navigate to="/privacy" replace />} />
            {/* Public, light-theme, auto-rotating TV/kiosk report viewer (V251/V252
                share token) - ANON, no chrome. The single public report-share surface
                (replaces the retired /display/:token executive board). The
                get_report_snapshot RPC is anon-granted and org-scoped by the token
                row; the page degrades gracefully until the migrations are applied. */}
            <Route path="/report/:token" element={<Safe><ReportShare /></Safe>} />
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
                  <MaintenanceGate>
                  <Layout>
                    <ChecklistOnlyGate>
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
                      <Route path="/accidents/:id" element={<Safe><FlagRoute flag="accidents_module"><AccidentDetail /></FlagRoute></Safe>} />
                      <Route path="/claims-summary" element={<Safe><FlagRoute flag="accidents_module"><ClaimsSummary /></FlagRoute></Safe>} />
                      <Route path="/rca"         element={<Safe><ModuleRoute moduleKey="rca"><RcaRecords /></ModuleRoute></Safe>} />
                      <Route path="/inspections" element={<Safe><ModuleRoute moduleKey="inspections"><Inspections /></ModuleRoute></Safe>} />
<Route path="/alerts"      element={<Safe><ModuleRoute moduleKey="alerts"><Alerts /></ModuleRoute></Safe>} />
                      <Route path="/alert-thresholds" element={<Safe><ModuleRoute moduleKey="alerts"><AlertThresholds /></ModuleRoute></Safe>} />
                      <Route path="/fleet-master"         element={<Safe><ModuleRoute moduleKey="fleet_master"><FleetMaster /></ModuleRoute></Safe>} />
                      <Route path="/vehicle/:assetNo"     element={<Safe><FlagRoute flag="vehicle_360"><Vehicle360 /></FlagRoute></Safe>} />
                      <Route path="/reports"              element={<Safe><ModuleRoute moduleKey="reports"><Reports /></ModuleRoute></Safe>} />
                      <Route path="/report-center"       element={<Safe><ModuleRoute moduleKey="reports"><ReportCenter /></ModuleRoute></Safe>} />
                      <Route path="/scheduled-reports"   element={<Safe><FlagRoute flag="report_scheduling"><ScheduledReports /></FlagRoute></Safe>} />
                      <Route path="/knowledge-base"       element={<Safe><FlagRoute flag="ai_tools"><KnowledgeBase /></FlagRoute></Safe>} />
                      <Route path="/ai-cost-monitor"      element={<Safe><FlagRoute flag="ai_tools"><AiCostMonitor /></FlagRoute></Safe>} />
                      <Route path="/ai-administration"    element={<Navigate to="/console/ai-admin" replace />} />
                      <Route path="/gate-pass"            element={<Safe><ModuleRoute moduleKey="gate_pass"><GatePass /></ModuleRoute></Safe>} />
                      <Route path="/serial-tracker"       element={<Safe><RoleRoute allowed={['Admin']}><SerialTracker /></RoleRoute></Safe>} />
                      <Route path="/work-orders"          element={<Safe><ModuleRoute moduleKey="work_orders"><WorkOrders /></ModuleRoute></Safe>} />
                      <Route path="/maintenance-calendar" element={<Safe><RoleRoute allowed={['Admin']}><MaintenanceCalendar /></RoleRoute></Safe>} />
                      <Route path="/safety-compliance"    element={<Safe><RoleRoute allowed={['Admin']}><SafetyCompliance /></RoleRoute></Safe>} />
                      <Route path="/assets"               element={<Safe><ModuleRoute moduleKey="fleet_master"><AssetManagement /></ModuleRoute></Safe>} />
                      <Route path="/sites"                element={<Safe><ModuleRoute moduleKey="fleet_master"><SiteManagement /></ModuleRoute></Safe>} />
                      <Route path="/inspection-planner"   element={<Safe><InspectionPlanner /></Safe>} />
                      <Route path="/warranty"             element={<Safe><WarrantyTracker /></Safe>} />
                      <Route path="/tyre-exchange"        element={<Safe><RoleRoute allowed={['Admin']}><TyreExchange /></RoleRoute></Safe>} />
                      <Route path="/scrap"                element={<Safe><TyreScrapManagement /></Safe>} />
                      <Route path="/stock-replenishment"  element={<Safe><StockReplenishment /></Safe>} />
                      <Route path="/live-fleet"           element={<Safe><RoleRoute allowed={['Admin']}><LiveFleetStatus /></RoleRoute></Safe>} />
                      <Route path="/compliance"           element={<Safe><RoleRoute allowed={['Admin']}><ComplianceDashboard /></RoleRoute></Safe>} />
                      <Route path="/retread"              element={<Safe><RoleRoute allowed={['Admin']}><RetreadManagement /></RoleRoute></Safe>} />
                      <Route path="/recall-tracker"       element={<Safe><RoleRoute allowed={['Admin']}><RecallTracker /></RoleRoute></Safe>} />
                      <Route path="/tyre-specs"           element={<Safe><RoleRoute allowed={['Admin']}><TyreSpecifications /></RoleRoute></Safe>} />
                      <Route path="/rotation"             element={<Safe><RoleRoute allowed={['Admin']}><RotationSchedule /></RoleRoute></Safe>} />
                      <Route path="/daily-ops"            element={<Safe><ModuleRoute moduleKey="daily_ops"><DailyOps /></ModuleRoute></Safe>} />
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
                      <Route path="/board-overview"          element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><BoardOverview /></RoleRoute></Safe>} />
                      <Route path="/report-sharing"          element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><ReportSharing /></RoleRoute></Safe>} />
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
                      <Route path="/data-reconciliation" element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><DataReconciliation /></RoleRoute></Safe>} />
                      <Route path="/erp-import"  element={<Safe><RoleRoute allowed={['Admin','Manager','Director']}><ErpImport /></RoleRoute></Safe>} />
                      <Route path="/audit"       element={<Safe><ModuleRoute moduleKey="audit_trail"><AuditTrail /></ModuleRoute></Safe>} />
                      <Route path="/users"       element={<Navigate to="/console/users" replace />} />
                      {/* ── Universal ── */}
                      <Route path="/upload"      element={<Safe><FlagRoute flag="data_intake"><UploadData /></FlagRoute></Safe>} />
                      <Route path="/data-intake" element={<Safe><FlagRoute flag="data_intake"><DataIntakeCenter /></FlagRoute></Safe>} />
                      <Route path="/data-intake/history" element={<Safe><FlagRoute flag="data_intake"><DataIntakeHistory /></FlagRoute></Safe>} />
                      <Route path="/checklists" element={<Safe><Checklists /></Safe>} />
                      <Route path="/checklists/:templateId/run" element={<Safe><ChecklistRun /></Safe>} />
                      <Route path="/checklists/submission/:id" element={<Safe><ChecklistSubmission /></Safe>} />
                      <Route path="/checklist-insights" element={<Safe><RoleRoute allowed={CHECKLIST_AUTHOR_ROLES}><ChecklistInsights /></RoleRoute></Safe>} />
                      <Route path="/my-checklists" element={<Safe><MyChecklists /></Safe>} />
                      <Route path="/checklist-schedules" element={<Safe><RoleRoute allowed={CHECKLIST_AUTHOR_ROLES}><ChecklistSchedules /></RoleRoute></Safe>} />
                      <Route path="/checklist-builder" element={<Safe><RoleRoute allowed={CHECKLIST_AUTHOR_ROLES}><ChecklistBuilder /></RoleRoute></Safe>} />
                      <Route path="/checklist-builder/:id" element={<Safe><RoleRoute allowed={CHECKLIST_AUTHOR_ROLES}><ChecklistBuilder /></RoleRoute></Safe>} />
                      <Route path="/upload-approvals" element={<Safe><FlagRoute flag="data_intake"><UploadApprovals /></FlagRoute></Safe>} />
                      <Route path="/custom-data" element={<Safe><ModuleRoute moduleKey="custom_data"><CustomData /></ModuleRoute></Safe>} />
                      <Route path="/settings"    element={<Safe><Settings /></Safe>} />
                      <Route path="/help"        element={<Safe><HelpCenter /></Safe>} />
                      <Route path="/tyre-age-compliance" element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><TyreAgeCompliance /></RoleRoute></Safe>} />
                      <Route path="/roi-calculator"      element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><RoiCalculator /></RoleRoute></Safe>} />
                      <Route path="/tyre-passport"         element={<Safe><TyrePassport /></Safe>} />
                      <Route path="/tyre-passport/:serial" element={<Safe><TyrePassport /></Safe>} />
                      <Route path="/fitment-validation"    element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><FitmentValidation /></RoleRoute></Safe>} />
                      <Route path="/technician-scorecard"  element={<Safe><RoleRoute allowed={['Admin']}><TechnicianScorecard /></RoleRoute></Safe>} />
                      <Route path="/tco-calculator"        element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><TcoCalculator /></RoleRoute></Safe>} />
                      <Route path="/tyre-pool"             element={<Safe><TyrePool /></Safe>} />
                      <Route path="/ops-intelligence"      element={<Safe><RoleRoute allowed={['Admin']}><OpsIntelligence /></RoleRoute></Safe>} />
                      <Route path="/fleet-risk-score"      element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><FleetRiskScore /></RoleRoute></Safe>} />
                      <Route path="/rotation-optimizer"    element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><RotationOptimizer /></RoleRoute></Safe>} />
                      <Route path="/cost-scenario-planner" element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><CostScenarioPlanner /></RoleRoute></Safe>} />
                      <Route path="/carbon-tracker"        element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><CarbonTracker /></RoleRoute></Safe>} />
                      <Route path="/tpms"                  element={<Safe><RoleRoute allowed={['Admin']}><Tpms /></RoleRoute></Safe>} />
                      <Route path="/contracts"             element={<Safe><Contracts /></Safe>} />
                      <Route path="/rfid"                  element={<Safe><RoleRoute allowed={['Admin']}><Rfid /></RoleRoute></Safe>} />
                      <Route path="/geofencing"            element={<Safe><RoleRoute allowed={['Admin']}><Geofencing /></RoleRoute></Safe>} />
                      <Route path="/insurance-claims"      element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><InsuranceClaims /></RoleRoute></Safe>} />
                      <Route path="/fuel-cards"            element={<Safe><RoleRoute allowed={['Admin']}><FuelCards /></RoleRoute></Safe>} />
                      <Route path="/certifications"        element={<Safe><Certifications /></Safe>} />
                      <Route path="/policies"              element={<Safe><RoleRoute allowed={['Admin']}><PolicyManagement /></RoleRoute></Safe>} />
                      <Route path="/incidents"             element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><IncidentReports /></RoleRoute></Safe>} />
                      <Route path="/journeys"              element={<Safe><RoleRoute allowed={['Admin']}><JourneyLog /></RoleRoute></Safe>} />
                      <Route path="/digital-twin"          element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><DigitalTwin /></RoleRoute></Safe>} />
                      <Route path="/digital-twin/:assetNo" element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><DigitalTwin /></RoleRoute></Safe>} />
                      <Route path="/parts-catalog"         element={<Safe><PartsCatalog /></Safe>} />
                      <Route path="/combinations"          element={<Safe><RoleRoute allowed={['Admin']}><Combinations /></RoleRoute></Safe>} />
                      <Route path="/dispatch"              element={<Safe><RoleRoute allowed={['Admin']}><Dispatch /></RoleRoute></Safe>} />
                      <Route path="/cold-chain"            element={<Safe><RoleRoute allowed={['Admin']}><ColdChain /></RoleRoute></Safe>} />
                      <Route path="/vehicle-checkinout"    element={<Safe><RoleRoute allowed={['Admin']}><VehicleCheckInOut /></RoleRoute></Safe>} />
                      <Route path="/retread-claims"        element={<Safe><RoleRoute allowed={['Admin']}><RetreadClaims /></RoleRoute></Safe>} />
                      <Route path="/batteries"             element={<Safe><RoleRoute allowed={['Admin']}><Batteries /></RoleRoute></Safe>} />
                      <Route path="/telematics-devices"    element={<Safe><RoleRoute allowed={['Admin']}><TelematicsDevices /></RoleRoute></Safe>} />
                      <Route path="/fuel-delivery"         element={<Safe><RoleRoute allowed={['Admin']}><FuelDelivery /></RoleRoute></Safe>} />
                      <Route path="/shifts"                element={<Safe><RoleRoute allowed={['Admin']}><ShiftScheduling /></RoleRoute></Safe>} />
                      <Route path="/equipment"             element={<Safe><RoleRoute allowed={['Admin']}><Equipment /></RoleRoute></Safe>} />
                      <Route path="/tyre-service-events"   element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><TyreServiceEvents /></RoleRoute></Safe>} />
                      <Route path="/driver-expenses"       element={<Safe><RoleRoute allowed={['Admin']}><DriverExpenses /></RoleRoute></Safe>} />
                      <Route path="/speed-limiter"         element={<Safe><RoleRoute allowed={['Admin']}><SpeedLimiter /></RoleRoute></Safe>} />
                      <Route path="/driver-documents"      element={<Safe><RoleRoute allowed={['Admin']}><DriverDocuments /></RoleRoute></Safe>} />
                      <Route path="/dvir"                  element={<Safe><RoleRoute allowed={['Admin']}><Dvir /></RoleRoute></Safe>} />
                      <Route path="/requisitions"          element={<Safe><Requisitions /></Safe>} />
                      <Route path="/goods-receipt"         element={<Safe><GoodsReceipt /></Safe>} />
                      <Route path="/customers"             element={<Safe><RoleRoute allowed={['Admin']}><Customers /></RoleRoute></Safe>} />
                      <Route path="/fleet-renewal"         element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><FleetRenewal /></RoleRoute></Safe>} />
                      <Route path="/dtc"                   element={<Safe><RoleRoute allowed={['Admin']}><DtcDiagnostics /></RoleRoute></Safe>} />
                      <Route path="/engine-hours"          element={<Safe><RoleRoute allowed={['Admin']}><EngineHours /></RoleRoute></Safe>} />
                      <Route path="/odometer-logs"         element={<Safe><RoleRoute allowed={['Admin']}><OdometerLogs /></RoleRoute></Safe>} />
                      <Route path="/pm-programs"           element={<Safe><RoleRoute allowed={['Admin']}><PmPrograms /></RoleRoute></Safe>} />
                      <Route path="/vehicle-washing"       element={<Safe><ModuleRoute moduleKey="vehicle_washing"><VehicleWashing /></ModuleRoute></Safe>} />
                      <Route path="/trips"                 element={<Safe><RoleRoute allowed={['Admin']}><Trips /></RoleRoute></Safe>} />
                      <Route path="/route-optimization"    element={<Safe><RoleRoute allowed={['Admin']}><RouteOptimization /></RoleRoute></Safe>} />
                      <Route path="/charging-sessions"     element={<Safe><RoleRoute allowed={['Admin']}><ChargingSessions /></RoleRoute></Safe>} />
                      <Route path="/load-planning"         element={<Safe><RoleRoute allowed={['Admin']}><LoadPlanning /></RoleRoute></Safe>} />
                      <Route path="/video-telematics"      element={<Safe><RoleRoute allowed={['Admin']}><VideoTelematics /></RoleRoute></Safe>} />
                      <Route path="/toll-transactions"     element={<Safe><RoleRoute allowed={['Admin']}><TollTransactions /></RoleRoute></Safe>} />
                      <Route path="/driver-safety"         element={<Safe><RoleRoute allowed={['Admin']}><DriverSafety /></RoleRoute></Safe>} />
                      <Route path="/gps-tracking"          element={<Safe><RoleRoute allowed={['Admin']}><GpsTracking /></RoleRoute></Safe>} />
                      <Route path="/hours-of-service"      element={<Safe><RoleRoute allowed={['Admin']}><HoursOfService /></RoleRoute></Safe>} />
                      <Route path="/ifta-reporting"        element={<Safe><RoleRoute allowed={['Admin']}><IftaReporting /></RoleRoute></Safe>} />
                      <Route path="/service-requests"      element={<Safe><RoleRoute allowed={['Admin']}><ServiceRequests /></RoleRoute></Safe>} />
                      <Route path="/reservations"          element={<Safe><RoleRoute allowed={['Admin']}><VehicleReservations /></RoleRoute></Safe>} />
                      <Route path="/breakdowns"            element={<Safe><RoleRoute allowed={['Admin']}><BreakdownCallouts /></RoleRoute></Safe>} />
                      <Route path="/weighbridge"           element={<Safe><RoleRoute allowed={['Admin']}><Weighbridge /></RoleRoute></Safe>} />
                      <Route path="/emissions"             element={<Safe><RoleRoute allowed={['Admin']}><Emissions /></RoleRoute></Safe>} />
                      <Route path="/proof-of-delivery"     element={<Safe><RoleRoute allowed={['Admin']}><ProofOfDelivery /></RoleRoute></Safe>} />
                      <Route path="/fuel-theft"            element={<Safe><RoleRoute allowed={['Admin']}><FuelTheftAlerts /></RoleRoute></Safe>} />
                      <Route path="/handovers"             element={<Safe><RoleRoute allowed={['Admin']}><VehicleHandover /></RoleRoute></Safe>} />
                      <Route path="/driver-training"       element={<Safe><RoleRoute allowed={['Admin']}><DriverTraining /></RoleRoute></Safe>} />
                      <Route path="/tachograph"            element={<Safe><RoleRoute allowed={['Admin']}><Tachograph /></RoleRoute></Safe>} />
                      <Route path="/bay-scheduling"        element={<Safe><RoleRoute allowed={['Admin']}><BayScheduling /></RoleRoute></Safe>} />
                      <Route path="/sla-dashboard"         element={<Safe><RoleRoute allowed={['Admin']}><SlaDashboard /></RoleRoute></Safe>} />
                      <Route path="/action-center"         element={<Safe><RoleRoute allowed={['Admin']}><ActionCenter /></RoleRoute></Safe>} />
                      <Route path="/driver-coaching"       element={<Safe><RoleRoute allowed={['Admin']}><DriverCoaching /></RoleRoute></Safe>} />
                      <Route path="/heat-intelligence"     element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><HeatIntelligence /></RoleRoute></Safe>} />
                      <Route path="/fleet-groups"          element={<Safe><RoleRoute allowed={['Admin']}><FleetGroups /></RoleRoute></Safe>} />
                      <Route path="/materials"             element={<Safe><RoleRoute allowed={['Admin']}><Materials /></RoleRoute></Safe>} />
                      <Route path="/trip-replay"           element={<Safe><RoleRoute allowed={['Admin']}><TripReplay /></RoleRoute></Safe>} />
                      <Route path="/fleet-optimizer"       element={<Safe><RoleRoute allowed={['Admin']}><FleetOptimizer /></RoleRoute></Safe>} />
                      <Route path="/customer-portal"       element={<Safe><RoleRoute allowed={['Admin']}><CustomerPortal /></RoleRoute></Safe>} />
                      <Route path="/developer-portal"      element={<Safe><RoleRoute allowed={['Admin','Manager','Director','Integration Admin']}><DeveloperPortal /></RoleRoute></Safe>} />
                      <Route path="/taas"                  element={<Safe><RoleRoute allowed={['Admin']}><Taas /></RoleRoute></Safe>} />
                      <Route path="/marketplace"           element={<Safe><RoleRoute allowed={['Admin']}><SupplierMarketplace /></RoleRoute></Safe>} />
                      <Route path="/ocr-scanner"           element={<Safe><RoleRoute allowed={['Admin']}><OcrScanner /></RoleRoute></Safe>} />
                      <Route path="/advanced-search"       element={<Safe><AdvancedSearch /></Safe>} />
                      <Route path="/onboarding-wizard"     element={<Safe><RoleRoute allowed={['Admin']}><OnboardingWizard /></RoleRoute></Safe>} />
                      <Route path="/sso-configuration"     element={<Navigate to="/console/security" replace />} />
                      <Route path="/admin"                 element={<Navigate to="/console" replace />} />
                      <Route path="/holding-company"       element={<Navigate to="/console/organisations" replace />} />
                      <Route path="/org-hierarchy"         element={<Navigate to="/console/organisations" replace />} />
                      <Route path="/scan"        element={<Safe><TyreScan /></Safe>} />
<Route path="/qr-labels"   element={<Safe><RoleRoute allowed={['Admin']}><QrLabels /></RoleRoute></Safe>} />
                      <Route path="/rfid-registry" element={<Safe><ModuleRoute moduleKey="tyre_records"><RfidRegistry /></ModuleRoute></Safe>} />
                      <Route path="/report-builder"      element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><ReportBuilder /></RoleRoute></Safe>} />
                      <Route path="/dashboard-builder"   element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><DashboardBuilder /></RoleRoute></Safe>} />
                      <Route path="/executive-analytics" element={<Safe><RoleRoute allowed={['Admin', 'Manager', 'Director']}><ExecutiveAnalytics /></RoleRoute></Safe>} />
                      <Route path="/security-center"     element={<Navigate to="/console/access?tab=security" replace />} />
                      <Route path="/system-health"       element={<Safe><RoleRoute allowed={['Admin']}><SystemHealth /></RoleRoute></Safe>} />
                      <Route path="/tenant-health"       element={<Safe><RoleRoute allowed={['Admin']}><TenantHealth /></RoleRoute></Safe>} />
                      <Route path="/permission-matrix"   element={<Navigate to="/console/access?tab=roles" replace />} />
                      <Route path="/master-access-control" element={<Navigate to="/console/access" replace />} />
                      <Route path="/brand-assets"        element={<Safe><RoleRoute allowed={['Admin']}><BrandAssets /></RoleRoute></Safe>} />
                      {/* ── Commercial: Subscription & Billing (roadmap #6) ── */}
                      <Route path="/billing"             element={<Safe><FlagRoute flag="billing"><Billing /></FlagRoute></Safe>} />
                      {/* ── Automation platform (backend V96–V103; flag OFF until DB applied) ── */}
                      <Route path="/events"              element={<Safe><FlagRoute flag="automation_platform"><EventStream /></FlagRoute></Safe>} />
                      <Route path="/approvals"           element={<Safe><FlagRoute flag="automation_platform"><Approvals /></FlagRoute></Safe>} />
                      <Route path="/workflow-settings"   element={<Safe><FlagRoute flag="automation_platform"><WorkflowSettings /></FlagRoute></Safe>} />
                      <Route path="/approval-delegations" element={<Safe><FlagRoute flag="automation_platform"><ApprovalDelegations /></FlagRoute></Safe>} />
                      <Route path="/automation-rules"    element={<Safe><FlagRoute flag="automation_platform"><AutomationRules /></FlagRoute></Safe>} />
                      <Route path="/integrations"        element={<Safe><FlagRoute flag="automation_platform"><Integrations /></FlagRoute></Safe>} />
                      {/* ── Detail & builder pages (modal→page conversions, Session 15) ── */}
                      <Route path="/assets/:assetNo"                   element={<Safe><ModuleRoute moduleKey="fleet_master"><AssetDetail /></ModuleRoute></Safe>} />
                      <Route path="/suppliers/:supplierId"             element={<Safe><ModuleRoute moduleKey="stock"><SupplierDetail /></ModuleRoute></Safe>} />
                      <Route path="/driver-management/:driverId"       element={<Safe><ModuleRoute moduleKey="fleet_master"><DriverDetail /></ModuleRoute></Safe>} />
                      <Route path="/workshop/:jobId"                   element={<Safe><ModuleRoute moduleKey="work_orders"><WorkshopJobDetail /></ModuleRoute></Safe>} />
                      <Route path="/recalls/:recallId"                 element={<Safe><RecallDetail /></Safe>} />
                      <Route path="/workflow-settings/builder/:defId?" element={<Safe><FlagRoute flag="automation_platform"><WorkflowBuilder /></FlagRoute></Safe>} />
                      <Route path="/automation-rules/builder"          element={<Safe><FlagRoute flag="automation_platform"><RuleBuilder /></FlagRoute></Safe>} />
                      <Route path="/automation-rules/builder/:ruleId"  element={<Safe><FlagRoute flag="automation_platform"><RuleBuilder /></FlagRoute></Safe>} />
                      <Route path="*"            element={<NotFound />} />
                    </Routes>
                    </ChecklistOnlyGate>
                  </Layout>
                  </MaintenanceGate>
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
            <Suspense fallback={<LoadingSpinner />}>
              <ConsoleLogin />
            </Suspense>
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
          <Route path="appearance"    element={<ConsoleReportAppearance />} />
          <Route path="health"        element={<ConsoleSystemHealth />} />
          <Route path="backups"       element={<ConsoleBackups />} />
          <Route path="admin-roles"   element={<ConsoleAdminRoles />} />
          <Route path="audit-trail"   element={<ConsoleAuditTrail />} />
          <Route path="alert-rules"   element={<ConsoleAlertRules />} />
          <Route path="module-control" element={<ConsoleModuleControl />} />
          <Route path="self-healing"  element={<ConsoleSelfHealing />} />
          <Route path="data-browser"  element={<ConsoleDataBrowser />} />
          <Route path="vehicle-designer" element={<ConsoleVehicleDesigner />} />
          <Route path="navigation"    element={<ConsoleNavigation />} />
          <Route path="crash-reports" element={<ConsoleCrashReports />} />
          <Route path="sessions"      element={<ConsoleSessions />} />
          <Route path="automation"    element={<ConsoleAutomation />} />
          <Route path="delivery"      element={<ConsoleDelivery />} />
          {/* Unified admin + access control hosted from the main app via ConsoleAuthBridge */}
          <Route path="access"        element={<ConsoleAuthBridge><Suspense fallback={<ConsoleModulePlaceholder label="Access Control" />}><ConsoleAccessControl /></Suspense></ConsoleAuthBridge>} />
          <Route path="ai-admin"      element={<ConsoleAuthBridge><Suspense fallback={<ConsoleModulePlaceholder label="AI Administration" />}><AiAdministration /></Suspense></ConsoleAuthBridge>} />
          <Route path="security"      element={<ConsoleAuthBridge><Suspense fallback={<ConsoleModulePlaceholder label="Security" />}><ConsoleSecurity /></Suspense></ConsoleAuthBridge>} />
          <Route path="system"        element={<ConsoleAuthBridge><Suspense fallback={<ConsoleModulePlaceholder label="System" />}><ConsoleSystem /></Suspense></ConsoleAuthBridge>} />
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
