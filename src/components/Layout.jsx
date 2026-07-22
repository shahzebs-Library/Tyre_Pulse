import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { isChecklistOnlyRole, isChecklistPathAllowed } from '../lib/checklistAccess'
import { navItemAllowedForCustomRole, NAV_MODULE_KEY } from '../lib/navAccess'
import { ACCESS_ROLES } from '../lib/moduleCatalog'
import { applyNavLayout } from '../lib/navLayout'
import { getNavLayout } from '../lib/api/navLayout'
import { configStr } from '../lib/api/systemConfig'

// Built-in roles have hardcoded sidebar rules below; any other (non-empty) role
// is an admin-defined CUSTOM role whose sidebar is derived from its module grants.
const BUILTIN_NAV_ROLES = new Set([...ACCESS_ROLES, 'Maintenance Supervisor', 'Store Keeper'])
const isCustomNavRole = (role) => !!role && !BUILTIN_NAV_ROLES.has(role)
import { useSettings, COUNTRIES, COUNTRY_LABEL } from '../contexts/SettingsContext'
import {
  LayoutDashboard, CircleDot, Package, DollarSign,
  ClipboardList, Search, Upload, Settings, LogOut,
  Menu, X, Wand2, BarChart2, Shield, ClipboardCheck, ListChecks,
  Bell, GitBranch, Layers, AlertTriangle, Globe, Car, Users, User, Sparkles,
  Sun, Moon, Truck, AlertOctagon, FileText, ShieldCheck, ScanLine, GitCompare, QrCode,
  ChevronDown, ChevronRight,
  Cpu, MapPin, Activity, GitMerge, CalendarClock, Trophy, BarChartBig, Microscope, Bot,
  TrendingUp, BookOpen, Zap, Database, Wrench, Calendar,
  Target, ShoppingCart, HeartPulse, RefreshCw, Clock, Gauge, Fuel,
  RotateCcw, AlertCircle, ArrowLeftRight, FileWarning, LayoutGrid, Coffee,
  Recycle, Radio, PackagePlus, CalendarCheck2, BellRing, Brain, BarChart, Download,
  Webhook, CheckSquare, CreditCard, Palette, LifeBuoy, Share2,
  Award, PackageCheck, Calculator, Siren, ShieldAlert, SlidersHorizontal,
  Leaf, BadgeCheck, ScrollText, Navigation,
  Boxes, Combine, Snowflake, BatteryCharging, Router, Video, Receipt,
  Satellite, Landmark, BookMarked, PhoneCall, Scale,
  Droplet, KeyRound, GraduationCap, FileClock,
  CalendarRange, ListTodo, Thermometer, Network, Play, Code, Repeat, Store, Rocket,
  Wallet, FileCheck, Building2, Lock, ArrowLeft,
} from 'lucide-react'
// Branded domain icons (custom Tyre Pulse set) for the clearest fleet/tyre nav
// items. Same ({ size, strokeWidth }) API as Lucide, so they drop straight in.
import TyreIc from './icons/tyre.icon'
import TruckIc from './icons/truck.icon'
import ScrapBinIc from './icons/scrap-bin.icon'
import TyreRotationIc from './icons/tyre-rotation.icon'
import PlyRatingIc from './icons/ply-rating.icon'
import PsiGaugeIc from './icons/psi-gauge.icon'
import FuelPumpIc from './icons/fuel-pump.icon'
import WorkOrderIc from './icons/work-order.icon'
import GatePassIc from './icons/gate-pass.icon'
import WorkshopIc from './icons/workshop.icon'
import SupplierTruckIc from './icons/supplier-truck.icon'
import PurchaseOrderIc from './icons/purchase-order.icon'
import TyreSwapIc from './icons/tyre-swap.icon'
import AnomalyScanIc from './icons/anomaly-scan.icon'
import ForecastTrendIc from './icons/forecast-trend.icon'
import ServiceCalendarIc from './icons/service-calendar.icon'
import StockBoxIc from './icons/stock-box.icon'
import BarcodeScanIc from './icons/barcode-scan.icon'
import OdometerIc from './icons/odometer.icon'
import { supabase } from '../lib/supabase'
import { detectAlerts, countAlertsBySeverity } from '../lib/alertEngine'
import { syncPendingInspections, getPendingCount, getFailedCount, getFailedInspections, retryFailedInspection } from '../lib/offlineQueue'
import { useWakeLock } from '../hooks/useWakeLock'
import { useRealtimeSync } from '../hooks/useRealtime'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import TpLogo from '../assets/logo.svg'
import { useTenant } from '../contexts/TenantContext'
import { resolveBrandLogo } from '../lib/brand/library'
import BrandIcon from './ui/BrandIcon'
import InstallPwaPrompt from './InstallPwaPrompt'
import NotificationCenter from './NotificationCenter'
import GlobalSearch from './GlobalSearch'
import MobileBottomNav from './MobileBottomNav'
import LanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from './ui/ThemeToggle'
import { useLanguage } from '../contexts/LanguageContext'
import OnboardingWizard from './OnboardingWizard'
import CommandPalette from './CommandPalette'
import Breadcrumbs from './ui/Breadcrumbs'
import { useCommandPalette } from '../contexts/CommandPaletteContext'

// Roles that see the analytics/intelligence items. Item-level gating (adminOnly /
// roles) is preserved from the previous group-level gating so the regrouped
// workspaces expose exactly what each role saw before.
const ANALYTICS_ROLES = ['Admin', 'Manager', 'Director']
const A = true // adminOnly shorthand (was the Admin-only "Intelligence" group)

// Data & integration roles (see AuthContext ROLE_DEFAULTS / MIGRATIONS_V107).
// Item-level `roles` gating so these focused roles reach their modules in the
// sidebar without granting full tenant administration.
const ERP_ROLES = ['Admin', 'Integration Admin', 'Data Engineer', 'Automation']
const UPLOAD_ROLES = ['Admin', 'Integration Admin', 'Data Engineer', 'Automation']
const CLEANING_ROLES = ['Admin', 'Integration Admin', 'Data Engineer']
const AUDIT_ROLES = ['Admin', 'Integration Admin']

// Eight operational workspaces (directive Phase 5) + Overview. Every route is
// unchanged - pages are only regrouped and no journey is removed.
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/',      label: 'Dashboard',    icon: LayoutDashboard, end: true },
      { to: '/tyres', label: 'Tyre Records', icon: TyreIc },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/fleet-master',        label: 'Fleet Master',       icon: TruckIc },
      { to: '/assets',              label: 'Asset Management',   icon: LayoutGrid },
      { to: '/sites',               label: 'Site Management',    icon: MapPin },
      { to: '/actions',             label: 'Corrective Actions', icon: ClipboardList },
      { to: '/rca',                 label: 'Root Cause',         icon: Search },
      { to: '/daily-ops',           label: 'Daily Ops',          icon: Coffee, adminOnly: A },
      { to: '/live-fleet',          label: 'Live Fleet Status',  icon: Radio, adminOnly: A },
      { to: '/serial-tracker',      label: 'Serial Tracker',     icon: BarcodeScanIc, adminOnly: A },
      { to: '/qr-labels',           label: 'QR Labels',          icon: QrCode, adminOnly: A },
      { to: '/vehicle-history',     label: 'Vehicle History',    icon: OdometerIc, adminOnly: A },
      { to: '/anomalies',           label: 'Anomaly Scan',       icon: AnomalyScanIc, adminOnly: A },
      { to: '/maintenance-calendar', label: 'Maintenance Calendar', icon: Calendar, adminOnly: A },
      { to: '/erp-sync',            label: 'ERP Sync',           icon: Database, roles: ERP_ROLES },
      { to: '/rfid',                label: 'RFID Registry',      icon: Radio, adminOnly: A },
      { to: '/geofencing',          label: 'Geofencing',         icon: MapPin, adminOnly: A },
      { to: '/journeys',            label: 'Journey Log',        icon: Navigation, adminOnly: A },
      { to: '/vehicle-checkinout',  label: 'Vehicle Check In/Out', icon: ArrowLeftRight, adminOnly: A },
      { to: '/combinations',        label: 'Combinations',       icon: Combine, adminOnly: A },
      { to: '/dispatch',            label: 'Dispatch Planning',  icon: Truck, adminOnly: A },
      { to: '/batteries',           label: 'Battery Lifecycle',  icon: BatteryCharging, adminOnly: A },
      { to: '/telematics-devices',  label: 'Telematics Devices', icon: Router, adminOnly: A },
      { to: '/shifts',              label: 'Shift Scheduling',   icon: CalendarClock, adminOnly: A },
      { to: '/speed-limiter',       label: 'Speed Limiter',      icon: Gauge, adminOnly: A },
      { to: '/engine-hours',        label: 'Engine Hours',       icon: Gauge, adminOnly: A },
      { to: '/odometer-logs',       label: 'Odometer Logs',      icon: Activity, adminOnly: A },
      { to: '/trips',               label: 'Trip History',       icon: MapPin, adminOnly: A },
      { to: '/route-optimization',  label: 'Route Optimization', icon: Navigation, adminOnly: A },
      { to: '/charging-sessions',   label: 'EV Charging',        icon: Zap, adminOnly: A },
      { to: '/load-planning',       label: 'Load Planning',      icon: Package, adminOnly: A },
      { to: '/toll-transactions',   label: 'Toll Transactions',  icon: Receipt, adminOnly: A },
      { to: '/gps-tracking',        label: 'GPS Tracking',       icon: Satellite, adminOnly: A },
      { to: '/reservations',        label: 'Vehicle Reservations', icon: BookMarked, adminOnly: A },
      { to: '/weighbridge',         label: 'Weighbridge',        icon: Scale, adminOnly: A },
      { to: '/proof-of-delivery',   label: 'Proof of Delivery',  icon: PackageCheck, adminOnly: A },
      { to: '/handovers',           label: 'Vehicle Handover',   icon: KeyRound, adminOnly: A },
      { to: '/action-center',       label: 'Action Center',      icon: ListTodo, adminOnly: A },
      { to: '/fleet-groups',        label: 'Fleet Groups',       icon: Network, adminOnly: A },
      { to: '/trip-replay',         label: 'Trip Replay',        icon: Play, adminOnly: A },
      { to: '/fleet-health',        label: 'Fleet Health Board', icon: HeartPulse, adminOnly: A },
    ],
  },
  {
    label: 'Tyre Performance',
    items: [
      { to: '/analytics',    label: 'Analytics',          icon: BarChart2,      roles: ANALYTICS_ROLES },
      { to: '/brand-perf',   label: 'Brand Performance',  icon: Shield,         roles: ANALYTICS_ROLES },
      { to: '/site-comp',    label: 'Site Comparison',    icon: Layers,         roles: ANALYTICS_ROLES },
      { to: '/fleet',        label: 'Fleet Analytics',    icon: GitBranch,      roles: ANALYTICS_ROLES },
      { to: '/kpi',          label: 'KPI Center',         icon: ClipboardCheck, roles: ANALYTICS_ROLES },
      { to: '/kpi-engine',   label: 'Engineering KPI',    icon: Gauge,          roles: ANALYTICS_ROLES },
      { to: '/kpi-command',  label: 'KPI Command Center', icon: Target,         roles: ANALYTICS_ROLES },
      { to: '/country-comp', label: 'Country Comparison', icon: Globe,          roles: ANALYTICS_ROLES },
      { to: '/comparison',   label: 'Comparison',         icon: GitCompare,     roles: ANALYTICS_ROLES },
      { to: '/position-intelligence',  label: 'Position Intelligence',  icon: MapPin, adminOnly: A },
      { to: '/pressure-intel',         label: 'Pressure Intelligence',  icon: PsiGaugeIc, adminOnly: A },
      { to: '/predictive-maintenance', label: 'Predictive Maintenance', icon: ServiceCalendarIc, adminOnly: A },
      { to: '/benchmark',              label: 'Performance Benchmark',  icon: Target, adminOnly: A },
      { to: '/tyre-size',              label: 'Size Optimizer',         icon: Layers, adminOnly: A },
      { to: '/tyre-lifecycle',         label: 'Tyre Lifecycle',         icon: RefreshCw, adminOnly: A },
      { to: '/tyre-exchange',          label: 'Tyre Exchange',          icon: TyreSwapIc, adminOnly: A },
      { to: '/tyre-specs',             label: 'Tyre Specifications',    icon: PlyRatingIc, adminOnly: A },
      { to: '/tyre-age-compliance',    label: 'Tyre Age Compliance',    icon: ShieldCheck, roles: ANALYTICS_ROLES },
      { to: '/tyre-passport',          label: 'Tyre Passport',          icon: ScanLine },
      { to: '/fleet-risk-score',       label: 'Fleet Risk Score',       icon: ShieldAlert, roles: ANALYTICS_ROLES },
      { to: '/rotation-optimizer',     label: 'Rotation Optimizer',     icon: RotateCcw, roles: ANALYTICS_ROLES },
      { to: '/carbon-tracker',         label: 'Carbon Tracker',         icon: Leaf, roles: ANALYTICS_ROLES },
      { to: '/digital-twin',           label: 'Digital Twin',           icon: Cpu, roles: ANALYTICS_ROLES },
      { to: '/tyre-service-events',    label: 'Tyre Service Events',    icon: Activity, roles: ANALYTICS_ROLES },
      { to: '/heat-intelligence',      label: 'Heat Intelligence',      icon: Thermometer, roles: ANALYTICS_ROLES },
      { to: '/fleet-optimizer',        label: 'Fleet Optimizer',        icon: SlidersHorizontal, adminOnly: A },
      { to: '/rotation',               label: 'Rotation Schedule',      icon: TyreRotationIc, adminOnly: A },
      { to: '/ai',                     label: 'Smart Analytics',        icon: Sparkles, adminOnly: A },
      { to: '/advanced-analytics',     label: 'Advanced Analytics',     icon: BarChartBig, roles: ANALYTICS_ROLES },
      { to: '/fleet-intelligence',     label: 'Fleet Intelligence',     icon: Brain, roles: ANALYTICS_ROLES },
      { to: '/root-cause',             label: 'Root Cause Engine',      icon: Microscope, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Workshop & Downtime',
    items: [
      { to: '/work-orders',     label: 'Work Orders',        icon: WorkOrderIc },
      { to: '/workshop-live',   label: 'Live Control',       icon: Activity, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/workshop-absence', label: 'Absence & Attendance', icon: CalendarCheck2, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/workshop-analytics', label: 'Workshop Analytics', icon: TrendingUp, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/workshop-settings', label: 'Workshop Settings', icon: SlidersHorizontal, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/parts-requests', label: 'Parts Requests', icon: Boxes, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/gate-pass',       label: 'Gate Pass',          icon: GatePassIc },
      { to: '/workshop',        label: 'Workshop Management', icon: WorkshopIc, adminOnly: A },
      { to: '/technician-scorecard', label: 'Technician Scorecard', icon: Award, adminOnly: A },
      { to: '/pm-programs',     label: 'Preventive Maintenance', icon: CalendarClock, adminOnly: A },
      { to: '/vehicle-washing', label: 'Vehicle Washing',    icon: Droplet },
      { to: '/dtc',             label: 'DTC Diagnostics',    icon: Cpu, adminOnly: A },
      { to: '/fuel-cards',      label: 'Fuel Cards',         icon: CreditCard, adminOnly: A },
      { to: '/fuel-delivery',   label: 'Fuel Delivery',      icon: Fuel, adminOnly: A },
      { to: '/equipment',       label: 'Tool & Equipment',   icon: Wrench, adminOnly: A },
      { to: '/downtime',        label: 'Downtime Tracker',   icon: Clock, adminOnly: A },
      { to: '/fuel-efficiency', label: 'Fuel Efficiency',    icon: FuelPumpIc, adminOnly: A },
      { to: '/service-requests', label: 'Service Requests',   icon: LifeBuoy, adminOnly: A },
      { to: '/breakdowns',      label: 'Breakdown Callouts', icon: PhoneCall, adminOnly: A },
      { to: '/bay-scheduling',  label: 'Bay Scheduling',     icon: CalendarRange, adminOnly: A },
    ],
  },
  {
    label: 'Stock & Procurement',
    items: [
      { to: '/stock',               label: 'Stock',               icon: StockBoxIc },
      { to: '/stock-replenishment', label: 'Stock Replenishment', icon: PackagePlus },
      { to: '/scrap',               label: 'Scrap Management',    icon: ScrapBinIc },
      { to: '/tyre-pool',           label: 'Tyre Pool',           icon: PackageCheck },
      { to: '/parts-catalog',       label: 'Parts Catalog',       icon: Boxes },
      { to: '/requisitions',        label: 'Requisitions',        icon: ClipboardList },
      { to: '/goods-receipt',       label: 'Goods Receipt',       icon: PackageCheck },
      { to: '/cost-scenario-planner', label: 'Cost Scenario Planner', icon: SlidersHorizontal, roles: ANALYTICS_ROLES },
      { to: '/contracts',           label: 'Contracts',           icon: FileText },
      { to: '/budgets',             label: 'Budgets & Cost',      icon: DollarSign },
      { to: '/procurement',         label: 'Procurement',         icon: PurchaseOrderIc, adminOnly: A },
      { to: '/suppliers',           label: 'Supplier Management', icon: SupplierTruckIc, adminOnly: A },
      { to: '/vendor-intelligence', label: 'Vendor Intelligence', icon: Trophy, adminOnly: A },
      { to: '/forecasting',         label: 'Forecasting Engine',  icon: ForecastTrendIc, adminOnly: A },
      { to: '/ifta-reporting',      label: 'IFTA Fuel Tax',       icon: Landmark, adminOnly: A },
      { to: '/materials',           label: 'Materials',           icon: Layers, adminOnly: A },
      { to: '/marketplace',         label: 'Supplier Marketplace', icon: Store, adminOnly: A },
      { to: '/cost-center',         label: 'Cost Center',         icon: Wallet, roles: ANALYTICS_ROLES },
      { to: '/budget-planner',      label: 'Budget Planner',      icon: Calculator, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Safety & Compliance',
    items: [
      { to: '/inspections',            label: 'Inspections',         icon: ClipboardCheck },
      { to: '/fitment-validation',     label: 'Fitment Validation',  icon: ShieldCheck, roles: ANALYTICS_ROLES },
      { to: '/tpms',                   label: 'TPMS',                icon: Radio, adminOnly: A },
      { to: '/certifications',         label: 'Certifications',      icon: BadgeCheck },
      { to: '/policies',               label: 'Policy Management',    icon: ScrollText, adminOnly: A },
      { to: '/cold-chain',             label: 'Cold-Chain Monitor',  icon: Snowflake, adminOnly: A },
      { to: '/retread-claims',         label: 'Retread Claims',      icon: Recycle, adminOnly: A },
      { to: '/driver-documents',       label: 'Driver Documents',    icon: FileCheck, adminOnly: A },
      { to: '/driver-expenses',        label: 'Driver Expenses',     icon: Wallet, adminOnly: A },
      { to: '/dvir',                   label: 'DVIR Reports',        icon: ClipboardCheck, adminOnly: A },
      { to: '/checklists',             label: 'Checklists',          icon: ListChecks },
      { to: '/my-checklists',          label: 'My Checklists',       icon: ClipboardList },
      { to: '/checklist-schedules',    label: 'Checklist Schedules', icon: Calendar, adminOnly: A },
      { to: '/checklist-insights',     label: 'Checklist Insights',  icon: ClipboardCheck, adminOnly: A },
      { to: '/inspection-planner',     label: 'Inspection Planner',  icon: CalendarClock },
      { to: '/inspection-intelligence', label: 'Inspection Intelligence', icon: Activity, adminOnly: A },
      { to: '/safety-compliance',      label: 'Safety & Compliance', icon: ShieldCheck, adminOnly: A },
      { to: '/compliance',             label: 'Compliance Dashboard', icon: Shield, adminOnly: A },
      { to: '/alerts',                 label: 'Alerts',              icon: Bell, adminOnly: A },
      { to: '/alert-thresholds',       label: 'Alert Thresholds',    icon: BellRing, adminOnly: A },
      { to: '/driver-management',      label: 'Driver Intelligence', icon: Users, adminOnly: A },
      { to: '/driver-safety',          label: 'Driver Safety',       icon: ShieldAlert, adminOnly: A },
      { to: '/video-telematics',       label: 'Video Telematics',    icon: Video, adminOnly: A },
      { to: '/hours-of-service',       label: 'Hours of Service',    icon: Clock, adminOnly: A },
      { to: '/emissions',              label: 'Emissions Tests',     icon: Leaf, adminOnly: A },
      { to: '/driver-training',        label: 'Driver Training',     icon: GraduationCap, adminOnly: A },
      { to: '/tachograph',             label: 'Tachograph',          icon: FileClock, adminOnly: A },
      { to: '/fuel-theft',             label: 'Fuel Theft Alerts',   icon: Droplet, adminOnly: A },
      { to: '/driver-coaching',        label: 'Driver Coaching',     icon: Award, adminOnly: A },
      { to: '/retread',                label: 'Retread Management',  icon: Recycle, adminOnly: A },
    ],
  },
  {
    label: 'Accident & Insurance',
    items: [
      { to: '/accidents',      label: 'Accidents',       icon: AlertOctagon },
      { to: '/claims-summary', label: 'Claims Summary',  icon: BarChart2 },
      { to: '/warranty',       label: 'Warranty Tracker', icon: ShieldCheck },
      { to: '/insurance-claims', label: 'Insurance Claims', icon: ShieldAlert },
      { to: '/incidents',        label: 'Incident Reports', icon: FileWarning },
      { to: '/recall-tracker', label: 'Recall Tracker',  icon: AlertCircle, adminOnly: A },
      { to: '/accident-workflow-settings', label: 'Accident Workflow', icon: GitBranch, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Reports & Executive',
    items: [
      { to: '/board-overview',    label: 'Board Overview',    icon: BarChartBig, roles: ANALYTICS_ROLES },
      { to: '/tyre-failure-cpk',  label: 'Tyre Failure & CPK', icon: AlertTriangle, roles: ANALYTICS_ROLES },
      { to: '/maintenance-cost-board', label: 'Maintenance Cost & Tasks', icon: Wrench, roles: ANALYTICS_ROLES },
      { to: '/reports',           label: 'Reports',           icon: FileText },
      { to: '/dashboard-builder', label: 'Dashboard Builder', icon: LayoutGrid },
      { to: '/scheduled-reports', label: 'Scheduled Reports', icon: CalendarCheck2 },
      { to: '/executive-report',  label: 'Executive Report',  icon: BookOpen, adminOnly: A },
      { to: '/roi-calculator',    label: 'ROI Calculator',    icon: DollarSign, roles: ANALYTICS_ROLES },
      { to: '/fleet-renewal',     label: 'Fleet Renewal',     icon: Truck, roles: ANALYTICS_ROLES },
      { to: '/tco-calculator',    label: 'TCO Calculator',    icon: Calculator, roles: ANALYTICS_ROLES },
      { to: '/sla-dashboard',     label: 'SLA Dashboard',     icon: Target, adminOnly: A },
      { to: '/taas',              label: 'Tyre-as-a-Service', icon: Repeat, adminOnly: A },
      { to: '/ops-intelligence',  label: 'Ops Intelligence',  icon: Siren, adminOnly: A },
      { to: '/report-sharing',    label: 'Report Sharing',    icon: Share2, roles: ANALYTICS_ROLES },
      { to: '/display',           label: 'TV Display Mode',   icon: Radio, adminOnly: A },
      { to: '/ai-command-center', label: 'AI Command Center', icon: Bot, adminOnly: A },
      { to: '/knowledge-base',    label: 'Knowledge Base',    icon: Brain, adminOnly: A },
      { to: '/ai-cost-monitor',   label: 'AI Cost Monitor',   icon: BarChart, adminOnly: A },
      { to: '/continuous-improvement', label: 'Continuous Improvement', icon: Zap, adminOnly: A },
      { to: '/executive-analytics', label: 'Executive Analytics', icon: TrendingUp, roles: ANALYTICS_ROLES },
      { to: '/report-center',     label: 'Report Center',     icon: ScrollText, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/approvals',         label: 'Approvals',          icon: CheckSquare, roles: ANALYTICS_ROLES, flag: 'automation_platform' },
      { to: '/events',            label: 'Event Stream',       icon: Radio, adminOnly: A, flag: 'automation_platform' },
      { to: '/workflow-settings', label: 'Approval Workflows', icon: GitBranch, adminOnly: A, flag: 'automation_platform' },
      { to: '/approval-delegations', label: 'Approval Delegations', icon: ArrowLeftRight, flag: 'automation_platform' },
      { to: '/automation-rules',  label: 'Automation Rules',   icon: Zap, adminOnly: A, flag: 'automation_platform' },
      { to: '/integrations',      label: 'API & Webhooks',     icon: Webhook, adminOnly: A, flag: 'automation_platform' },
    ],
  },
  {
    label: 'Administration & Data',
    items: [
      { to: '/cleaning',         label: 'Data Cleaning',      icon: Wand2, roles: CLEANING_ROLES },
      { to: '/data-reconciliation', label: 'Data Reconciliation', icon: GitCompare, adminOnly: true },
      { to: '/data-intake',      label: 'Data Intake Center', icon: Database },
      { to: '/erp-import',       label: 'ERP Data Import',    icon: Upload, roles: ANALYTICS_ROLES },
      { to: '/upload-approvals', label: 'Upload Approvals',   icon: ClipboardList, roles: UPLOAD_ROLES },
      { to: '/custom-data',      label: 'Custom Data',        icon: Database },
      { to: '/audit',            label: 'Audit Trail',        icon: ClipboardList, roles: AUDIT_ROLES },
      { to: '/system-health',    label: 'System Health',      icon: HeartPulse, adminOnly: true },
      { to: '/tenant-health',    label: 'Usage & Adoption',   icon: BarChart, adminOnly: true },
      { to: '/billing',          label: 'Billing & Subscription', icon: CreditCard, adminOnly: true, flag: 'billing' },
      { to: '/brand-assets',     label: 'Brand Assets',       icon: Palette, adminOnly: true },
      { to: '/customers',        label: 'Customers',          icon: Building2, adminOnly: A },
      { to: '/customer-portal',  label: 'Customer Portal',    icon: Building2, adminOnly: A },
      { to: '/advanced-search',  label: 'Advanced Search',    icon: Search },
      { to: '/ocr-scanner',      label: 'OCR Scanner',        icon: ScanLine, adminOnly: A },
      { to: '/onboarding-wizard', label: 'Onboarding Wizard', icon: Rocket, adminOnly: true },
      { to: '/developer-portal', label: 'Developer Portal',   icon: Code, adminOnly: true },
      { to: '/help',             label: 'Help & Support',     icon: LifeBuoy },
      { to: '/settings',         label: 'Settings',           icon: Settings },
    ],
  },
]

// Lightweight, icon-free descriptor of the built-in nav (group key = its label,
// item key = its route) for the super-admin Navigation Customizer console page.
// Single source of truth: derived from NAV_GROUPS so the editor can never drift
// from the real sidebar. NAV_GROUPS itself stays the applied definition.
export const NAV_CATALOG = NAV_GROUPS.map((g) => ({
  key: g.label,
  label: g.label,
  items: g.items.map((it) => ({ key: it.to, label: it.label })),
}))

function shouldShowGroup(group, profile) {
  if (!group.groupRoles) return true
  return group.groupRoles.includes(profile?.role)
}

function shouldShowNavItem(item, profile, isFlagEnabled, hasPermission, grantedModules, isSuperAdmin) {
  // Feature-flag gate first: a disabled capability is hidden entirely, so its
  // nav item never renders (not just redirected at the route).
  if (item.flag && isFlagEnabled && !isFlagEnabled(item.flag)) return false
  // Additive per-user grant override: a built-in-role user explicitly GRANTED
  // this module's access sees the nav item even if the role rules below would
  // reject it. (Revoke is enforced by hasPermission/route guards; this only
  // opens visibility, so we do not hide here.)
  const grantKey = NAV_MODULE_KEY[item.to]
  if (grantKey && grantedModules && grantedModules.has(grantKey)) return true
  if (profile?.role === 'Inspector') {
    return item.to === '/inspections' || item.to === '/settings'
  }
  // Data Monitor Officer — accident monitoring + own settings only.
  if (profile?.role === 'Data Monitor Officer') {
    return item.to === '/accidents' || item.to === '/settings'
  }
  // Admin-defined custom roles: sidebar derived from granted module access.
  if (isCustomNavRole(profile?.role)) {
    return navItemAllowedForCustomRole(item.to, hasPermission)
  }
  // Checklist-only role (Maintenance Supervisor): sidebar shows only checklists.
  if (isChecklistOnlyRole(profile?.role)) {
    return isChecklistPathAllowed(item.to)
  }
  // If this nav item maps to a module, its visibility follows the access matrix +
  // per-user grants/revokes via hasPermission - so an admin turning a module OFF for
  // a role (or revoking a user) actually HIDES it from the sidebar, and turning it
  // on / granting shows it. Admin + Super Admin always resolve true inside hasPermission.
  if (grantKey) return hasPermission(grantKey)
  if (item.adminOnly) return profile?.role === 'Admin' || isSuperAdmin === true
  if (item.roles) return item.roles.includes(profile?.role)
  return true
}

function roleBadgeClass(role) {
  switch (role) {
    case 'Admin':     return 'bg-red-900/40 text-red-300 border border-red-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Manager':   return 'bg-orange-900/40 text-orange-300 border border-orange-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Inspector': return 'bg-purple-900/40 text-purple-300 border border-purple-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Director':  return 'bg-blue-900/40 text-blue-300 border border-blue-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Tyre Man':  return 'bg-teal-900/40 text-teal-300 border border-teal-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Integration Admin': return 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Data Engineer':     return 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Automation':        return 'bg-indigo-900/40 text-indigo-300 border border-indigo-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    default:          return 'bg-gray-800/60 text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-semibold'
  }
}

// Mirrors the mobile app's tyre_man tab bar (Inspect · Records · Work Orders ·
// Scan · Profile). Alerts moves to a header bell so the bottom bar stays at the
// five primary field actions, matching the native inspector experience.
const TYRE_MAN_TABS = [
  { to: '/inspections', tk: 'inspect', label: 'Inspect',   icon: ClipboardCheck, end: false },
  { to: '/tyres',       tk: 'records', label: 'Records',   icon: Layers },
  { to: '/work-orders', tk: 'work',    label: 'Work',      icon: Wrench },
  { to: '/scan',        tk: 'scan',    label: 'Scan',      icon: ScanLine },
  { to: '/settings',    tk: 'profile', label: 'Profile',   icon: User },
]

function TyreManShell({ children, alertCount, appIcon, customAppIcon }) {
  const { signOut, profile } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock()
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount]   = useState(0)
  const [retrying, setRetrying]         = useState(false)

  // Force light theme for the TyreMan mobile shell
  useEffect(() => {
    const prev = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    return () => {
      // Restore previous theme when TyreMan shell unmounts (e.g. logout)
      const saved = localStorage.getItem('tyrepulse-theme') || prev
      document.documentElement.classList.remove('dark', 'light')
      document.documentElement.classList.add(saved)
    }
  }, [])

  // Acquire wake lock while on inspections checklist
  useEffect(() => {
    const onInspections = location.pathname === '/inspections'
    if (onInspections) {
      acquireWakeLock()
    } else {
      releaseWakeLock()
    }
    return () => releaseWakeLock()
  }, [location.pathname, acquireWakeLock, releaseWakeLock])

  // Sync offline queue when coming back online
  useEffect(() => {
    async function syncAndCount() {
      if (navigator.onLine) {
        await syncPendingInspections(supabase)
      }
      const [pending, failed] = await Promise.all([getPendingCount(), getFailedCount()])
      setPendingCount(pending)
      setFailedCount(failed)
    }
    syncAndCount()
    window.addEventListener('online', syncAndCount)
    return () => window.removeEventListener('online', syncAndCount)
  }, [])

  // Requeue dead-lettered inspections (exhausted their auto-retries) and flush.
  const retryFailedSyncs = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    try {
      const failed = await getFailedInspections()
      await Promise.all(failed.map(f => retryFailedInspection(f._queueId)))
      if (navigator.onLine) await syncPendingInspections(supabase)
      const [pending, stillFailed] = await Promise.all([getPendingCount(), getFailedCount()])
      setPendingCount(pending)
      setFailedCount(stillFailed)
    } finally {
      setRetrying(false)
    }
  }, [retrying])

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#f0f5f1' }}
    >
      {/* Fixed top header - light */}
      <header
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4"
        style={{
          height: 'calc(52px + env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
          background: 'rgba(255,255,255,0.97)',
          borderBottom: '1px solid rgba(22,163,74,0.15)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 1px 12px rgba(0,0,0,0.06)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.22)' }}
          >
            <BrandIcon src={appIcon} custom={!!customAppIcon} size={16} />
          </div>
          <span
            className="font-extrabold text-sm tracking-tight"
            style={{ color: '#166534' }}
          >
            TyrePulse
          </span>
        </div>

        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span
              className="text-[9px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
              title={`${pendingCount} inspection${pendingCount !== 1 ? 's' : ''} queued offline`}
            >
              ⏳ {pendingCount}
            </span>
          )}
          {failedCount > 0 && (
            <button
              type="button"
              onClick={retryFailedSyncs}
              disabled={retrying}
              className="text-[9px] font-bold px-2 py-0.5 rounded-full disabled:opacity-60"
              style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}
              title={`${failedCount} inspection${failedCount !== 1 ? 's' : ''} failed to sync, tap to retry`}
            >
              {retrying ? '…' : `⚠ ${failedCount}`}
            </button>
          )}
          <LanguageSwitcher />
          <ThemeToggle
            size={15}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-green-600 transition-colors hover:bg-green-500/10"
          />
          <NavLink
            to="/alerts"
            className="relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: '#6b7280' }}
            aria-label={`Alerts${alertCount > 0 ? ` (${alertCount})` : ''}`}
          >
            <Bell size={15} />
            {alertCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-bold bg-red-500 text-white rounded-full px-0.5"
                style={{ boxShadow: '0 0 5px rgba(239,68,68,0.5)' }}
              >
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </NavLink>
          <span className="text-xs max-w-[84px] truncate" style={{ color: '#6b7280' }}>
            {profile?.full_name}
          </span>
          <button
            onClick={signOut}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: '#9ca3af' }}
            aria-label="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* Role-based first-run onboarding (field light theme) */}
      <OnboardingWizard />

      {/* Scrollable content */}
      <main
        className="flex-1 overflow-auto px-3"
        style={{
          paddingTop: 'calc(52px + env(safe-area-inset-top))',
          paddingBottom: 'calc(66px + env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </main>

      {/* Fixed bottom tab bar - light */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30"
        aria-label="Tyre Man navigation"
        style={{
          background: 'rgba(255,255,255,0.97)',
          borderTop: '1px solid rgba(22,163,74,0.15)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -2px 16px rgba(0,0,0,0.06)',
        }}
      >
        <div className="flex items-stretch h-[54px]">
          {TYRE_MAN_TABS.map(({ to, label, tk, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                color: isActive ? '#16a34a' : '#9ca3af',
              })}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 active:opacity-60"
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.7} />
                    {to === '/alerts' && alertCount > 0 && (
                      <span
                        className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-0.5"
                        style={{ boxShadow: '0 0 6px rgba(239,68,68,0.5)' }}
                      >
                        {alertCount > 9 ? '9+' : alertCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[9.5px] font-semibold tracking-wide">{tk ? t(`shell.tabs.${tk}`) : label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

const SEARCH_TABLES = [
  { table: 'tyre_records',       fields: ['serial_no','asset_no','brand','site','description'],  label: 'Tyre',   route: '/tyres' },
  { table: 'corrective_actions', fields: ['title','site','assigned_to','asset_no'],              label: 'Action', route: '/actions' },
  { table: 'rca_records',        fields: ['asset_no','tyre_serial','brand','site','root_cause'], label: 'RCA',    route: '/rca' },
  { table: 'stock_records',      fields: ['site','description'],                                  label: 'Stock',  route: '/stock' },
]

const SIDEBAR_EXPANDED = 240
const SIDEBAR_COLLAPSED = 54

export default function Layout({ children }) {
  useRealtimeSync()

  const { profile, signOut, hasPermission, grantedModules, isSuperAdmin } = useAuth()
  const { t }                               = useLanguage()
  const { branding }                        = useTenant()
  // Org-assigned app icon (V120); falls back to the built-in mark so an
  // unbranded org renders exactly as before. A custom (usually navy/coloured)
  // logo is framed on a light chip via <BrandIcon> so it stays legible on the
  // dark/green badges.
  const customAppIcon = resolveBrandLogo(branding, 'app_icon')
  const appIcon = customAppIcon || TpLogo
  const { activeCountry, setActiveCountry } = useSettings()
  const navigate     = useNavigate()
  const location     = useLocation()

  const { setOpen: setCmdOpen } = useCommandPalette()
  const { isEnabled: isFlagEnabled } = useFeatureFlags()

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  )
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  )
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [searchOpen, setSearchOpen]           = useState(false)
  const [query, setQuery]                     = useState('')
  const [results, setResults]                 = useState([])
  const [searching, setSearching]             = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [alertCount, setAlertCount]           = useState(0)
  const [hoveredItem, setHoveredItem]         = useState(null)
  // Org-wide sidebar customization (super-admin Navigation Customizer). Loaded
  // once, best-effort; {} → applyNavLayout returns the built-in defaults, so this
  // is a no-op when no layout is configured. Applied BEFORE role/flag filtering
  // below, so gating still runs on the reordered/regrouped set.
  const [navLayout, setNavLayout]             = useState({})

  useEffect(() => {
    let alive = true
    getNavLayout().then((layout) => { if (alive) setNavLayout(layout || {}) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const effectiveGroups = useMemo(() => applyNavLayout(NAV_GROUPS, navLayout), [navLayout])

  // App version label (system_config.app_version). Read from the primed config
  // cache (SettingsContext primes it for authed pages); empty when unset.
  const appVersion = configStr('app_version', '')

  function toggleGroup(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  // Responsive breakpoint tracking
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = e => {
      setIsMobile(e.matches)
      setSidebarOpen(!e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isMobile, sidebarOpen])

  // On mobile, close sidebar on route change; on desktop, re-open ≥1024px
  useEffect(() => {
    if (isMobile) setSidebarOpen(false)
    else if (window.innerWidth >= 1024) setSidebarOpen(true)
  }, [location.pathname, isMobile])

  useEffect(() => {
    async function fetchAlertCount() {
      try {
        const country = activeCountry !== 'All' ? activeCountry : null
        const found   = await detectAlerts(supabase, country)
        const dismissed = (() => {
          try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
          catch { return new Set() }
        })()
        const counts = countAlertsBySeverity(found.filter(a => !dismissed.has(a.id)))
        setAlertCount(counts.critical + counts.high)
      } catch { /* ignore */ }
    }
    fetchAlertCount()
    const iv = setInterval(fetchAlertCount, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [activeCountry])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(v => !v) }
      if (e.key === 'Escape') { setGlobalSearchOpen(false); setSearchOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setCmdOpen])

  useEffect(() => {
    if (searchOpen && searchRef.current) setTimeout(() => searchRef.current?.focus(), 50)
  }, [searchOpen])

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return }
    setSearching(true)
    const allResults = []
    await Promise.all(SEARCH_TABLES.map(async ({ table, fields, label, route }) => {
      const orClause = fields.map(f => `${f}.ilike.%${q}%`).join(',')
      const { data } = await supabase.from(table).select(fields.join(',') + ',id').or(orClause).limit(5)
      if (data) {
        data.forEach(row => {
          const primary   = row[fields[0]] || row[fields[1]] || 'Unknown'
          const secondary = fields.slice(1, 3).map(f => row[f]).filter(Boolean).join(' · ')
          allResults.push({ id: row.id, label, table, primary, secondary, route })
        })
      }
    }))
    setResults(allResults.slice(0, 15))
    setSearching(false)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  async function handleSignOut() { await signOut(); navigate('/login') }

  const pillClass = (c) =>
    `flex-1 py-1 text-[10px] font-bold rounded-md transition-all duration-200 ${
      activeCountry === c
        ? 'text-white shadow-sm'
        : 'text-gray-600 hover:text-gray-400'
    }`
  const pillStyle = (c) => activeCountry === c
    ? { background: 'linear-gradient(135deg, #15803d, #16a34a)', boxShadow: '0 0 12px rgba(22,163,74,0.35)' }
    : {}

  if (profile?.role === 'Tyre Man') {
    return <TyreManShell alertCount={alertCount} appIcon={appIcon} customAppIcon={customAppIcon}>{children}</TyreManShell>
  }

  const navItemVariants = {
    hidden: { opacity: 0, x: -8 },
    visible: { opacity: 1, x: 0 },
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'transparent' }}>

      {/* ── Mobile backdrop ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isMobile && sidebarOpen && (
          <motion.div
            key="mobile-backdrop"
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <motion.aside
        className={`flex-shrink-0 flex flex-col ${isMobile ? 'fixed top-0 left-0 h-full z-50' : 'relative z-20'}`}
        animate={
          isMobile
            ? { x: sidebarOpen ? 0 : -SIDEBAR_EXPANDED, width: SIDEBAR_EXPANDED }
            : { width: sidebarOpen ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED, x: 0 }
        }
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: 'hidden' }}
      >
        {/* subtle inner glow at bottom of sidebar */}
        <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
          style={{ background: 'linear-gradient(0deg, rgba(22,163,74,0.04) 0%, transparent 100%)' }} />

        {/* ── Logo row ──────────────────────────────────────────────────────── */}
        <div
          className={`flex items-center h-[52px] px-3 flex-shrink-0 ${!sidebarOpen ? 'justify-center' : ''}`}
          style={{ borderBottom: '1px solid rgba(22,163,74,0.1)' }}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {/* logo mark */}
            <div
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center relative"
              style={{
                background: 'linear-gradient(135deg, rgba(22,163,74,0.18) 0%, rgba(22,163,74,0.08) 100%)',
                border: '1px solid rgba(22,163,74,0.3)',
                boxShadow: '0 0 20px rgba(22,163,74,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <BrandIcon src={appIcon} custom={!!customAppIcon} size={18} />
              {/* pulse ring */}
              <div className="absolute inset-0 rounded-xl animate-ping-green opacity-0 group-hover:opacity-100"
                style={{ background: 'rgba(22,163,74,0.15)' }} />
            </div>

            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="min-w-0"
                >
                  <span
                    className="font-extrabold text-[15px] tracking-tight whitespace-nowrap leading-none block"
                    style={{
                      background: 'linear-gradient(135deg, #ffffff 25%, #86efac 75%, #4ade80 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    TyrePulse
                  </span>
                  <span className="text-[9px] text-gray-600 tracking-[0.12em] uppercase font-medium">
                    Fleet Intelligence
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-gray-600 hover:text-green-400 transition-all duration-200 hover:bg-green-400/10"
          >
            <motion.div animate={{ rotate: sidebarOpen ? 0 : 180 }} transition={{ duration: 0.22 }}>
              {sidebarOpen ? <X size={13} /> : <Menu size={13} />}
            </motion.div>
          </button>
        </div>

        {/* ── Search + Country ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              {/* Search */}
              <div className="px-2.5 pt-3 pb-1">
                <button
                  onClick={() => setCmdOpen(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-gray-500 hover:text-green-400 transition-all duration-200 text-xs group"
                  style={{
                    background: 'rgba(22,163,74,0.04)',
                    border: '1px solid rgba(22,163,74,0.1)',
                  }}
                >
                  <Search size={11} className="flex-shrink-0 group-hover:text-green-400 transition-colors" />
                  <span className="flex-1 text-left font-medium">Search...</span>
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded-md font-mono text-gray-600"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    ⌘K
                  </kbd>
                </button>
              </div>

              {/* Country selector */}
              {(profile?.role === 'Admin' || !profile?.country || profile.country.length === 0) && (
                <div className="px-2.5 pb-1">
                  <p className="nav-section px-0.5 pt-2 pb-1.5">{t('shell.country')}</p>
                  <div className="flex gap-0.5 rounded-xl p-0.5"
                    style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.09)' }}>
                    <button className={pillClass('All')} style={pillStyle('All')} onClick={() => setActiveCountry('All')}>{t('common.all')}</button>
                    {COUNTRIES.map(c => (
                      <button key={c} className={pillClass(c)} style={pillStyle(c)} onClick={() => setActiveCountry(c)}>
                        {COUNTRY_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Language selector */}
              <div className="px-2.5 pb-2">
                <p className="nav-section px-0.5 pt-2 pb-1.5">{t('common.language')}</p>
                <LanguageSwitcher className="w-full justify-between" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Nav ────────────────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-1.5 px-2" style={{ scrollbarWidth: 'thin' }}>
          {effectiveGroups.map((group) => {
            const { items } = group
            // Stable identity = the group's default key (survives renames) for the
            // React key, collapse state, and translation lookup.
            const groupId = group.key || group.label
            if (!shouldShowGroup(group, profile)) return null
            const visibleItems = items.filter(item => shouldShowNavItem(item, profile, isFlagEnabled, hasPermission, grantedModules, isSuperAdmin))
            if (visibleItems.length === 0) return null
            const isCollapsed = collapsedGroups.has(groupId)
            const _grpKey = `nav.groups.${groupId}`
            const _grpRaw = t(_grpKey)
            const renamed = group.label && group.label !== groupId
            // A super-admin rename wins; otherwise use the translation (fallback to label).
            const groupHeading = renamed
              ? group.label
              : ((!_grpRaw || _grpRaw === _grpKey) ? group.label : _grpRaw)
            return (
              <div key={groupId} className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup(groupId)}
                    className="w-full flex items-center justify-between px-2.5 pt-3 pb-1.5 group/sec cursor-pointer"
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-gray-700 group-hover/sec:text-gray-500 transition-colors">
                      {groupHeading}
                    </span>
                    <motion.div
                      animate={{ rotate: isCollapsed ? -90 : 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <ChevronDown size={9} className="text-gray-700 group-hover/sec:text-gray-500 transition-colors" />
                    </motion.div>
                  </button>
                )}

                <AnimatePresence initial={false}>
                  {(!isCollapsed || !sidebarOpen) && (
                    <motion.div
                      key={groupId + '-items'}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {visibleItems.map(({ to, label: lbl, icon: Icon, end }) => {
                        const _navKey = `nav.items.${to}`
                        const _navRaw = t(_navKey)
                        const navLabel = (!_navRaw || _navRaw === _navKey) ? lbl : _navRaw
                        return (
                        <NavLink
                          key={to}
                          to={to}
                          end={end}
                          title={!sidebarOpen ? navLabel : undefined}
                          onMouseEnter={() => setHoveredItem(to)}
                          onMouseLeave={() => setHoveredItem(null)}
                          className={({ isActive }) =>
                            `relative flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-xl text-[12.5px] font-medium
                             transition-all duration-150 mb-px group
                             ${!sidebarOpen ? 'justify-center' : ''}
                             ${isActive ? 'text-green-300' : 'text-gray-600 hover:text-gray-200'}`
                          }
                          style={({ isActive }) => isActive ? {
                            background: 'linear-gradient(135deg, rgba(22,163,74,0.16) 0%, rgba(22,163,74,0.07) 100%)',
                            border: '1px solid rgba(22,163,74,0.24)',
                            boxShadow: '0 0 18px rgba(22,163,74,0.1), inset 0 1px 0 rgba(22,163,74,0.05)',
                          } : {
                            border: '1px solid transparent',
                          }}
                        >
                          {({ isActive }) => (
                            <>
                              {/* active indicator bar */}
                              {isActive && (
                                <motion.span
                                  layoutId="activeBar"
                                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[52%] rounded-r-full"
                                  style={{
                                    background: 'linear-gradient(180deg, #86efac, #22c55e, #15803d)',
                                    boxShadow: '0 0 10px rgba(74,222,128,0.8)',
                                  }}
                                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                />
                              )}

                              <Icon
                                size={13.5}
                                strokeWidth={isActive ? 2.2 : 1.8}
                                className={`flex-shrink-0 transition-colors duration-150 ${
                                  isActive
                                    ? 'text-green-400'
                                    : 'text-gray-600 group-hover:text-gray-300'
                                }`}
                              />

                              {sidebarOpen && (
                                <span className="truncate leading-none">{navLabel}</span>
                              )}

                              {to === '/alerts' && alertCount > 0 && (
                                <span
                                  className={`${sidebarOpen ? 'ml-auto' : 'absolute -top-0.5 -right-0.5'} text-[9.5px] font-bold bg-red-600 text-white rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1`}
                                  style={{ boxShadow: '0 0 10px rgba(239,68,68,0.7)' }}
                                >
                                  {alertCount > 9 ? '9+' : alertCount}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}

          {/* System Console entry (super-admins only) - single doorway to the
              isolated /console admin + access-control surface. */}
          {isSuperAdmin === true && (() => {
            const adminCollapsed = collapsedGroups.has('Admin')
            return (
              <div className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup('Admin')}
                    className="w-full flex items-center justify-between px-2.5 pt-3 pb-1.5 group/sec cursor-pointer"
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-gray-700 group-hover/sec:text-gray-500 transition-colors">
                      {t('nav.groups.Admin')}
                    </span>
                    <motion.div animate={{ rotate: adminCollapsed ? -90 : 0 }} transition={{ duration: 0.18 }}>
                      <ChevronDown size={9} className="text-gray-700 group-hover/sec:text-gray-500 transition-colors" />
                    </motion.div>
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {(!adminCollapsed || !sidebarOpen) && (
                    <motion.div
                      key="admin-items"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <NavLink
                        to="/console"
                        title={!sidebarOpen ? 'System Console' : undefined}
                        className={({ isActive }) =>
                          `relative flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-xl text-[12.5px] font-medium
                           transition-all duration-150 mb-px group
                           ${!sidebarOpen ? 'justify-center' : ''}
                           ${isActive ? 'text-green-300' : 'text-gray-600 hover:text-gray-200'}`
                        }
                        style={({ isActive }) => isActive ? {
                          background: 'linear-gradient(135deg, rgba(22,163,74,0.16) 0%, rgba(22,163,74,0.07) 100%)',
                          border: '1px solid rgba(22,163,74,0.24)',
                          boxShadow: '0 0 18px rgba(22,163,74,0.1)',
                        } : { border: '1px solid transparent' }}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[52%] rounded-r-full"
                                style={{ background: 'linear-gradient(180deg,#86efac,#22c55e)', boxShadow: '0 0 10px rgba(74,222,128,0.8)' }} />
                            )}
                            <Shield size={13.5} strokeWidth={isActive ? 2.2 : 1.8}
                              className={`flex-shrink-0 ${isActive ? 'text-green-400' : 'text-gray-600 group-hover:text-gray-300'}`} />
                            {sidebarOpen && <span className="truncate">System Console</span>}
                          </>
                        )}
                      </NavLink>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })()}
        </nav>

        {/* ── User footer ────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 p-2.5"
          style={{ borderTop: '1px solid rgba(22,163,74,0.09)' }}
        >
          <div className={`flex items-center gap-2 ${!sidebarOpen ? 'flex-col' : ''}`}>
            {/* avatar */}
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0 cursor-default"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                boxShadow: '0 0 14px rgba(22,163,74,0.45)',
                border: '1px solid rgba(22,163,74,0.4)',
              }}
            >
              {profile?.full_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? 'U'}
            </div>

            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  className="flex-1 min-w-0"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <p className="text-[11.5px] font-semibold text-gray-300 truncate leading-none">
                      {profile?.full_name ?? profile?.username ?? 'User'}
                    </p>
                    {profile?.role && (
                      <span className={`flex-shrink-0 leading-none ${roleBadgeClass(profile.role)}`}>
                        {t(`roles.${profile.role}`)}
                      </span>
                    )}
                  </div>
                  {/* App version (system_config.app_version). Rendered only when set. */}
                  {appVersion && (
                    <p className="text-[9.5px] font-medium text-gray-600 truncate leading-none mt-1">
                      v{appVersion}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <ThemeToggle
                size={13}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-green-400 transition-all duration-200 hover:bg-green-400/10"
              />
              <NotificationCenter />
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 transition-all duration-200 hover:bg-red-400/10"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* ── Mobile top header ────────────────────────────────────────────────── */}
      {isMobile && (
        <div
          className="fixed top-0 left-0 right-0 z-30 flex items-center gap-2 px-3"
          style={{
            height: 52,
            background: 'var(--panel-deep)',
            borderBottom: '1px solid rgba(22,163,74,0.12)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 1px 20px rgba(0,0,0,0.4)',
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 active:text-green-400 transition-colors flex-shrink-0"
            style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)' }}
            aria-label={t('shell.openMenu')}
          >
            <Menu size={16} />
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BrandIcon src={appIcon} custom={!!customAppIcon} size={20} className="flex-shrink-0" />
            <span
              className="font-extrabold text-sm tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #ffffff 25%, #86efac 75%, #4ade80 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              TyrePulse
            </span>
          </div>

          <button
            onClick={() => setGlobalSearchOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 active:text-green-400 transition-colors"
            aria-label="Search"
          >
            <Search size={16} />
          </button>

          <ThemeToggle
            size={16}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 active:text-green-400 hover:text-green-400 transition-colors"
          />

          <button
            onClick={() => navigate('/alerts')}
            className="relative w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 active:text-green-400 transition-colors"
            aria-label="Alerts"
          >
            <Bell size={16} />
            {alertCount > 0 && (
              <span
                className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 flex items-center justify-center text-[9px] font-bold bg-red-600 text-white rounded-full px-0.5"
                style={{ boxShadow: '0 0 6px rgba(239,68,68,0.7)' }}
              >
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-y-auto"
        style={{
          scrollbarWidth: 'thin',
          paddingTop: isMobile ? 52 : 0,
          paddingBottom: isMobile ? 'calc(54px + env(safe-area-inset-bottom))' : 0,
        }}
      >
        {/* ── Wayfinding bar: single global Back + breadcrumbs ────────────────
            The ONE canonical "Back to previous page" control for the whole app
            shell, so every routed page (including the many that do not use
            PageHeader) gets exactly one, consistently placed. Hidden on the
            top-level home/dashboard; the Back button itself is also hidden when
            there is no history to go back to (deep link / first page). */}
        {location.pathname !== '/' && location.pathname !== '/dashboard' && (
          <div className="w-full max-w-[1800px] mx-auto px-4 pt-4 sm:px-6 xl:px-8 2xl:px-10">
            <div className="flex items-center gap-2 min-w-0">
              {typeof window !== 'undefined' && window.history.length > 1 && (
                <button
                  onClick={() => navigate(-1)}
                  title="Back to previous page"
                  aria-label="Back to previous page"
                  className="flex-shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-[12px] font-medium transition-colors hover:text-green-400"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'rgba(22,163,74,0.05)',
                    border: '1px solid rgba(22,163,74,0.12)',
                  }}
                >
                  <ArrowLeft size={13} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Back</span>
                </button>
              )}
              <Breadcrumbs navGroups={NAV_GROUPS} t={t} className="min-w-0 flex-1" />
            </div>
          </div>
        )}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 1, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="px-4 py-5 sm:px-6 xl:px-8 2xl:px-10 max-w-[1800px] mx-auto"
        >
          {children}
        </motion.div>
      </main>

      {/* PWA */}
      <InstallPwaPrompt />

      {/* Mobile bottom navigation */}
      {isMobile && (
        <MobileBottomNav
          alertCount={alertCount}
          onMenuOpen={() => setSidebarOpen(true)}
        />
      )}

      {/* Global search */}
      <GlobalSearch isOpen={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />

      {/* Command palette - Ctrl/Cmd+K */}
      <CommandPalette />

      {/* Role-based first-run onboarding */}
      <OnboardingWizard />

      {/* ── Search palette ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => { setSearchOpen(false); setQuery('') }}
          >
            <motion.div
              className="w-full max-w-xl overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, rgba(6,13,8,0.99) 0%, var(--panel-deep) 100%)',
                border: '1px solid rgba(22,163,74,0.28)',
                borderRadius: 20,
                boxShadow: '0 0 80px rgba(22,163,74,0.16), 0 32px 100px rgba(0,0,0,0.85)',
              }}
              initial={{ scale: 0.95, y: -16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
            >
              {/* top glow line */}
              <div className="h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(22,163,74,0.65) 40%,rgba(74,222,128,0.8) 50%,rgba(22,163,74,0.65) 60%,transparent)' }} />

              {/* input */}
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid rgba(22,163,74,0.1)' }}>
                <Search size={14} className="text-green-600 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="flex-1 bg-transparent text-white placeholder-gray-600 focus:outline-none text-sm font-medium"
                  placeholder="Search tyres, actions, RCA, stock..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                {searching && <span className="text-[11px] text-gray-600 animate-pulse font-medium">Searching</span>}
                <kbd
                  className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded-md cursor-pointer font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onClick={() => { setSearchOpen(false); setQuery('') }}
                >ESC</kbd>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {query.length >= 2 && results.length === 0 && !searching && (
                  <p className="text-gray-600 text-sm text-center py-10">No results for &ldquo;{query}&rdquo;</p>
                )}
                {query.length < 2 && (
                  <p className="text-gray-700 text-xs text-center py-7 font-medium">Type at least 2 characters to search</p>
                )}
                {results.map((r, i) => (
                  <motion.button
                    key={`${r.id}-${i}`}
                    onClick={() => { navigate(r.route); setSearchOpen(false); setQuery('') }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{ borderBottom: '1px solid rgba(22,163,74,0.05)' }}
                    whileHover={{ background: 'rgba(22,163,74,0.06)' }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025 }}
                  >
                    <span className="text-[10px] font-bold rounded-lg px-2 py-0.5 flex-shrink-0 min-w-[44px] text-center"
                      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.22)', color: '#4ade80' }}>
                      {r.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{r.primary}</p>
                      {r.secondary && <p className="text-gray-600 text-xs truncate mt-0.5">{r.secondary}</p>}
                    </div>
                  </motion.button>
                ))}
              </div>

              <div className="px-4 py-2.5 flex gap-4 text-[10px] text-gray-700 font-medium" style={{ borderTop: '1px solid rgba(22,163,74,0.06)' }}>
                <span>↩ navigate</span>
                <span>Esc close</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
