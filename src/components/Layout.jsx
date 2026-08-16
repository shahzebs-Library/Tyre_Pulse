import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { isChecklistOnlyRole, isChecklistPathAllowed } from '../lib/checklistAccess'
import { navItemAllowedForCustomRole, NAV_MODULE_KEY, governingModuleKey } from '../lib/navAccess'
import { ACCESS_ROLES } from '../lib/moduleCatalog'
import { applyNavLayout } from '../lib/navLayout'
import { getNavLayout } from '../lib/api/navLayout'
import TopBar from './shell/TopBar'

// Built-in roles have hardcoded sidebar rules below; any other (non-empty) role
// is an admin-defined CUSTOM role whose sidebar is derived from its module grants.
const BUILTIN_NAV_ROLES = new Set([...ACCESS_ROLES, 'Maintenance Supervisor', 'Store Keeper'])
const isCustomNavRole = (role) => !!role && !BUILTIN_NAV_ROLES.has(role)
import { useSettings } from '../contexts/SettingsContext'
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
  Megaphone,
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
import { detectAlertBadgeCount } from '../lib/alertEngine'
import { syncPendingInspections, getPendingCount, getFailedCount, getFailedInspections, retryFailedInspection } from '../lib/offlineQueue'
import { useWakeLock } from '../hooks/useWakeLock'
import { useRealtimeSync } from '../hooks/useRealtime'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import TpLogo from '../assets/logo.svg'
import { getCompanyLogo } from '../lib/api/brandLogo'
import { useTenant } from '../contexts/TenantContext'
import { resolveBrandLogo } from '../lib/brand/library'
import BrandIcon from './ui/BrandIcon'
import InstallPwaPrompt from './InstallPwaPrompt'
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
      { to: '/action-center',       label: 'Action Center',      icon: ListTodo, adminOnly: A },
      { to: '/approvals',         label: 'Approvals',          icon: CheckSquare, roles: ANALYTICS_ROLES, flag: 'automation_platform' },
      { to: '/my-checklists',          label: 'My Checklists',       icon: ClipboardList },
      { to: '/broadcast',            label: 'Message the Team',   icon: Megaphone, adminOnly: A },
    ],
  },
  {
    label: 'Fleet & Assets',
    items: [
      { to: '/fleet-master',        label: 'Fleet Master', parent: 'Registry',       icon: TruckIc },
      { to: '/assets',              label: 'Asset Management', parent: 'Registry',   icon: LayoutGrid },
      { to: '/sites',               label: 'Site Management', parent: 'Registry',    icon: MapPin },
      { to: '/fleet-groups',        label: 'Fleet Groups', parent: 'Registry',       icon: Network, adminOnly: A },
      { to: '/combinations',        label: 'Combinations', parent: 'Registry',       icon: Combine, adminOnly: A },
      { to: '/customers',        label: 'Customers', parent: 'Registry',          icon: Building2, adminOnly: A },
      { to: '/vehicle-history',     label: 'Vehicle History', parent: 'Lifecycle',    icon: OdometerIc, adminOnly: A },
      { to: '/asset-disposals',     label: 'Asset Disposal', parent: 'Lifecycle',     icon: Recycle, roles: ANALYTICS_ROLES },
      { to: '/fleet-renewal',     label: 'Fleet Renewal', parent: 'Lifecycle',     icon: Truck, roles: ANALYTICS_ROLES },
      { to: '/batteries',           label: 'Battery Lifecycle', parent: 'Lifecycle',  icon: BatteryCharging, adminOnly: A },
      { to: '/qr-labels',           label: 'QR Labels', parent: 'Identification',          icon: QrCode, adminOnly: A },
      { to: '/rfid',                label: 'RFID Registry', parent: 'Identification',      icon: Radio, adminOnly: A },
      { to: '/engine-hours',        label: 'Engine Hours', parent: 'Meters',       icon: Gauge, adminOnly: A },
      { to: '/odometer-logs',       label: 'Odometer Logs', parent: 'Meters',      icon: Activity, adminOnly: A },
      { to: '/fleet-utilization',   label: 'Fleet Utilization', parent: 'Meters',  icon: Gauge, roles: ANALYTICS_ROLES },
      { to: '/vehicle-checkinout',  label: 'Vehicle Check In/Out', parent: 'Movement', icon: ArrowLeftRight, adminOnly: A },
      { to: '/handovers',           label: 'Vehicle Handover', parent: 'Movement',   icon: KeyRound, adminOnly: A },
      { to: '/reservations',        label: 'Vehicle Reservations', parent: 'Movement', icon: BookMarked, adminOnly: A },
      { to: '/gate-pass',       label: 'Gate Pass', parent: 'Movement',          icon: GatePassIc },
    ],
  },
  {
    label: 'Tyre Management',
    items: [
      { to: '/tyres', label: 'Tyre Records', parent: 'Records', icon: TyreIc },
      { to: '/serial-tracker',      label: 'Serial Tracker', parent: 'Records',     icon: BarcodeScanIc, adminOnly: A },
      { to: '/tyre-passport',          label: 'Tyre Passport', parent: 'Records',          icon: ScanLine },
      { to: '/tyre-specs',             label: 'Tyre Specifications', parent: 'Records',    icon: PlyRatingIc, adminOnly: A },
      { to: '/tyre-exchange',          label: 'Tyre Exchange', parent: 'Fitment & Rotation',          icon: TyreSwapIc, adminOnly: A },
      { to: '/rotation',               label: 'Rotation Schedule', parent: 'Fitment & Rotation',      icon: TyreRotationIc, adminOnly: A },
      { to: '/rotation-optimizer',     label: 'Rotation Optimizer', parent: 'Fitment & Rotation',     icon: RotateCcw, roles: ANALYTICS_ROLES },
      { to: '/fitment-validation',     label: 'Fitment Validation', parent: 'Fitment & Rotation',  icon: ShieldCheck, roles: ANALYTICS_ROLES },
      { to: '/tyre-size',              label: 'Size Optimizer', parent: 'Fitment & Rotation',         icon: Layers, adminOnly: A },
      { to: '/pressure-intel',         label: 'Pressure Intelligence', parent: 'Condition',  icon: PsiGaugeIc, adminOnly: A },
      { to: '/tpms',                   label: 'TPMS', parent: 'Condition',                icon: Radio, adminOnly: A },
      { to: '/position-intelligence',  label: 'Position Intelligence', parent: 'Condition',  icon: MapPin, adminOnly: A },
      { to: '/tyre-age-compliance',    label: 'Tyre Age Compliance', parent: 'Condition',    icon: ShieldCheck, roles: ANALYTICS_ROLES },
      { to: '/heat-intelligence',      label: 'Heat Intelligence', parent: 'Condition',      icon: Thermometer, roles: ANALYTICS_ROLES },
      { to: '/tyre-lifecycle',         label: 'Tyre Lifecycle', parent: 'Lifecycle',         icon: RefreshCw, adminOnly: A },
      { to: '/tyre-service-events',    label: 'Tyre Service Events', parent: 'Lifecycle',    icon: Activity, roles: ANALYTICS_ROLES },
      { to: '/tyre-pool',           label: 'Tyre Pool', parent: 'Lifecycle',           icon: PackageCheck },
      { to: '/scrap',               label: 'Scrap Management', parent: 'Lifecycle',    icon: ScrapBinIc },
      { to: '/retread',                label: 'Retread Management', parent: 'Lifecycle',  icon: Recycle, adminOnly: A },
      { to: '/retread-claims',         label: 'Retread Claims', parent: 'Lifecycle',      icon: Recycle, adminOnly: A },
      { to: '/warranty',       label: 'Warranty Tracker', parent: 'Lifecycle', icon: ShieldCheck },
      { to: '/brand-perf',   label: 'Brand Performance', parent: 'Performance',  icon: Shield,         roles: ANALYTICS_ROLES },
      { to: '/tyre-failure-cpk',  label: 'Tyre Failure & CPK', parent: 'Performance', icon: AlertTriangle, roles: ANALYTICS_ROLES },
      { to: '/cpk-intelligence',  label: 'CPK Intelligence', parent: 'Performance',  icon: Gauge,      roles: ANALYTICS_ROLES },
      { to: '/fleet-risk-score',       label: 'Fleet Risk Score', parent: 'Performance',       icon: ShieldAlert, roles: ANALYTICS_ROLES },
      { to: '/digital-twin',           label: 'Digital Twin', parent: 'Performance',           icon: Cpu, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Workshop & Maintenance',
    items: [
      { to: '/work-orders',     label: 'Work Orders', parent: 'Jobs',        icon: WorkOrderIc },
      { to: '/workshop',        label: 'Workshop Management', parent: 'Jobs', icon: WorkshopIc, adminOnly: A },
      { to: '/workshop-live',   label: 'Live Control', parent: 'Jobs',       icon: Activity, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/bay-scheduling',  label: 'Bay Scheduling', parent: 'Jobs',     icon: CalendarRange, adminOnly: A },
      { to: '/service-requests', label: 'Service Requests', parent: 'Jobs',   icon: LifeBuoy, adminOnly: A },
      { to: '/breakdowns',      label: 'Breakdown Callouts', parent: 'Jobs', icon: PhoneCall, adminOnly: A },
      { to: '/asset-breakdowns',    label: 'Breakdown Register', parent: 'Jobs', icon: Wrench, roles: ANALYTICS_ROLES },
      { to: '/pm-programs',     label: 'Preventive Maintenance', parent: 'Maintenance', icon: CalendarClock, adminOnly: A },
      { to: '/maintenance-calendar', label: 'Maintenance Calendar', parent: 'Maintenance', icon: Calendar, adminOnly: A },
      { to: '/predictive-maintenance', label: 'Predictive Maintenance', parent: 'Maintenance', icon: ServiceCalendarIc, adminOnly: A },
      { to: '/downtime',        label: 'Downtime Tracker', parent: 'Maintenance',   icon: Clock, adminOnly: A },
      { to: '/dtc',             label: 'DTC Diagnostics', parent: 'Maintenance',    icon: Cpu, adminOnly: A },
      { to: '/vehicle-washing', label: 'Vehicle Washing', parent: 'Maintenance',    icon: Droplet },
      { to: '/workshop-absence', label: 'Absence & Attendance', parent: 'People', icon: CalendarCheck2, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/technician-scorecard', label: 'Technician Scorecard', parent: 'People', icon: Award, adminOnly: A },
      { to: '/shifts',              label: 'Shift Scheduling', parent: 'People',   icon: CalendarClock, adminOnly: A },
      { to: '/parts-requests', label: 'Parts Requests', parent: 'Parts & Tools', icon: Boxes, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/equipment',       label: 'Tool & Equipment', parent: 'Parts & Tools',   icon: Wrench, adminOnly: A },
      { to: '/workshop-analytics', label: 'Workshop Analytics', parent: 'Analysis', icon: TrendingUp, roles: ['Admin', 'Manager', 'Director'] },
      { to: '/maintenance-cost-board', label: 'Maintenance Cost & Tasks', parent: 'Analysis', icon: Wrench, roles: ANALYTICS_ROLES },
      { to: '/workshop-settings', label: 'Workshop Settings', parent: 'Analysis', icon: SlidersHorizontal, roles: ['Admin', 'Manager', 'Director'] },
    ],
  },
  {
    label: 'Inspections & Compliance',
    items: [
      { to: '/inspections',            label: 'Inspections', parent: 'Inspections',         icon: ClipboardCheck },
      { to: '/inspection-planner',     label: 'Inspection Planner', parent: 'Inspections',  icon: CalendarClock },
      { to: '/inspection-intelligence', label: 'Inspection Intelligence', parent: 'Inspections', icon: Activity, adminOnly: A },
      { to: '/dvir',                   label: 'DVIR Reports', parent: 'Inspections',        icon: ClipboardCheck, adminOnly: A },
      { to: '/checklists',             label: 'Checklists', parent: 'Checklists',          icon: ListChecks },
      { to: '/checklist-schedules',    label: 'Checklist Schedules', parent: 'Checklists', icon: Calendar, adminOnly: A },
      { to: '/checklist-insights',     label: 'Checklist Insights', parent: 'Checklists',  icon: ClipboardCheck, adminOnly: A },
      { to: '/actions',             label: 'Corrective Actions', parent: 'Findings', icon: ClipboardList },
      { to: '/rca',                 label: 'Root Cause', parent: 'Findings',         icon: Search },
      { to: '/root-cause',             label: 'Root Cause Engine', parent: 'Findings',      icon: Microscope, roles: ANALYTICS_ROLES },
      { to: '/anomalies',           label: 'Anomaly Scan', parent: 'Findings',       icon: AnomalyScanIc, adminOnly: A },
      { to: '/compliance',             label: 'Compliance Dashboard', parent: 'Compliance', icon: Shield, adminOnly: A },
      { to: '/safety-compliance',      label: 'Safety & Compliance', parent: 'Compliance', icon: ShieldCheck, adminOnly: A },
      { to: '/certifications',         label: 'Certifications', parent: 'Compliance',      icon: BadgeCheck },
      { to: '/policies',               label: 'Policy Management', parent: 'Compliance',    icon: ScrollText, adminOnly: A },
      { to: '/emissions',              label: 'Emissions Tests', parent: 'Compliance',     icon: Leaf, adminOnly: A },
      { to: '/hours-of-service',       label: 'Hours of Service', parent: 'Compliance',    icon: Clock, adminOnly: A },
      { to: '/tachograph',             label: 'Tachograph', parent: 'Compliance',          icon: FileClock, adminOnly: A },
      { to: '/speed-limiter',       label: 'Speed Limiter', parent: 'Compliance',      icon: Gauge, adminOnly: A },
      { to: '/alerts',                 label: 'Alerts', parent: 'Alerts',              icon: Bell, adminOnly: A },
      { to: '/alert-thresholds',       label: 'Alert Thresholds', parent: 'Alerts',    icon: BellRing, adminOnly: A },
    ],
  },
  {
    label: 'Drivers & Safety',
    items: [
      { to: '/driver-management',      label: 'Driver Intelligence', icon: Users, adminOnly: A },
      { to: '/driver-safety',          label: 'Driver Safety',       icon: ShieldAlert, adminOnly: A },
      { to: '/driver-training',        label: 'Driver Training',     icon: GraduationCap, adminOnly: A },
      { to: '/driver-coaching',        label: 'Driver Coaching',     icon: Award, adminOnly: A },
      { to: '/driver-documents',       label: 'Driver Documents',    icon: FileCheck, adminOnly: A },
      { to: '/driver-expenses',        label: 'Driver Expenses',     icon: Wallet, adminOnly: A },
      { to: '/video-telematics',       label: 'Video Telematics',    icon: Video, adminOnly: A },
      { to: '/fuel-theft',             label: 'Fuel Theft Alerts',   icon: Droplet, adminOnly: A },
    ],
  },
  {
    label: 'Monitoring & Logistics',
    items: [
      { to: '/live-fleet',          label: 'Live Fleet Status', parent: 'Live',  icon: Radio, adminOnly: A },
      { to: '/daily-ops',           label: 'Daily Ops', parent: 'Live',          icon: Coffee, adminOnly: A },
      { to: '/gps-tracking',        label: 'GPS Tracking', parent: 'Live',       icon: Satellite, adminOnly: A },
      { to: '/fleet-health',        label: 'Fleet Health Board', parent: 'Live', icon: HeartPulse, adminOnly: A },
      { to: '/trip-replay',         label: 'Trip Replay', parent: 'Live',        icon: Play, adminOnly: A },
      { to: '/trips',               label: 'Trip History', parent: 'Journeys',       icon: MapPin, adminOnly: A },
      { to: '/journeys',            label: 'Journey Log', parent: 'Journeys',        icon: Navigation, adminOnly: A },
      { to: '/route-optimization',  label: 'Route Optimization', parent: 'Journeys', icon: Navigation, adminOnly: A },
      { to: '/geofencing',          label: 'Geofencing', parent: 'Journeys',         icon: MapPin, adminOnly: A },
      { to: '/dispatch',            label: 'Dispatch Planning', parent: 'Journeys',  icon: Truck, adminOnly: A },
      { to: '/load-planning',       label: 'Load Planning', parent: 'Journeys',      icon: Package, adminOnly: A },
      { to: '/telematics-devices',  label: 'Telematics Devices', parent: 'Devices', icon: Router, adminOnly: A },
      { to: '/cold-chain',             label: 'Cold-Chain Monitor', parent: 'Devices',  icon: Snowflake, adminOnly: A },
      { to: '/weighbridge',         label: 'Weighbridge', parent: 'Logistics',        icon: Scale, adminOnly: A },
      { to: '/proof-of-delivery',   label: 'Proof of Delivery', parent: 'Logistics',  icon: PackageCheck, adminOnly: A },
      { to: '/toll-transactions',   label: 'Toll Transactions', parent: 'Logistics',  icon: Receipt, adminOnly: A },
      { to: '/fuel-cards',      label: 'Fuel Cards', parent: 'Fuel & Energy',         icon: CreditCard, adminOnly: A },
      { to: '/fuel-delivery',   label: 'Fuel Delivery', parent: 'Fuel & Energy',      icon: Fuel, adminOnly: A },
      { to: '/fuel-efficiency', label: 'Fuel Efficiency', parent: 'Fuel & Energy',    icon: FuelPumpIc, adminOnly: A },
      { to: '/charging-sessions',   label: 'EV Charging', parent: 'Fuel & Energy',        icon: Zap, adminOnly: A },
      { to: '/ifta-reporting',      label: 'IFTA Fuel Tax', parent: 'Fuel & Energy',       icon: Landmark, adminOnly: A },
    ],
  },
  {
    label: 'Inventory & Procurement',
    items: [
      { to: '/stock',               label: 'Stock', parent: 'Stock',               icon: StockBoxIc },
      { to: '/stock-replenishment', label: 'Stock Replenishment', parent: 'Stock', icon: PackagePlus },
      { to: '/parts-catalog',       label: 'Parts Catalog', parent: 'Stock',       icon: Boxes },
      { to: '/materials',           label: 'Materials', parent: 'Stock',           icon: Layers, adminOnly: A },
      { to: '/goods-receipt',       label: 'Goods Receipt', parent: 'Stock',       icon: PackageCheck },
      { to: '/procurement',         label: 'Procurement', parent: 'Purchasing',         icon: PurchaseOrderIc, adminOnly: A },
      { to: '/requisitions',        label: 'Requisitions', parent: 'Purchasing',        icon: ClipboardList },
      { to: '/suppliers',           label: 'Supplier Management', parent: 'Purchasing', icon: SupplierTruckIc, adminOnly: A },
      { to: '/vendor-intelligence', label: 'Vendor Intelligence', parent: 'Purchasing', icon: Trophy, adminOnly: A },
      { to: '/marketplace',         label: 'Supplier Marketplace', parent: 'Purchasing', icon: Store, adminOnly: A },
      { to: '/contracts',           label: 'Contracts', parent: 'Purchasing',           icon: FileText },
    ],
  },
  {
    label: 'Accidents & Claims',
    items: [
      { to: '/accidents',      label: 'Accidents',       icon: AlertOctagon },
      { to: '/accident-cases', label: 'Accident Cases',  icon: Layers, roles: ANALYTICS_ROLES },
      { to: '/incidents',        label: 'Incident Reports', icon: FileWarning },
      { to: '/claims-summary', label: 'Claims Summary',  icon: BarChart2 },
      { to: '/insurance-claims', label: 'Insurance Claims', icon: ShieldAlert },
      { to: '/insurance-policies', label: 'Insurance Policies', icon: Shield, adminOnly: A },
      { to: '/recall-tracker', label: 'Recall Tracker',  icon: AlertCircle, adminOnly: A },
      { to: '/accident-workflow-settings', label: 'Accident Workflow', icon: GitBranch, roles: ANALYTICS_ROLES },
    ],
  },
  {
    label: 'Finance & Commercial',
    items: [
      { to: '/cost-center',         label: 'Cost Center', parent: 'Cost',         icon: Wallet, roles: ANALYTICS_ROLES },
      { to: '/budgets',             label: 'Budgets & Cost', parent: 'Cost',      icon: DollarSign },
      { to: '/budget-planner',      label: 'Budget Planner', parent: 'Cost',      icon: Calculator, roles: ANALYTICS_ROLES },
      { to: '/expense-report',    label: 'Expenses & CPK', parent: 'Cost',    icon: Wallet, roles: ANALYTICS_ROLES },
      { to: '/expense-trends',    label: 'Expense Trends', parent: 'Cost',    icon: TrendingUp, roles: ANALYTICS_ROLES },
      { to: '/cost-scenario-planner', label: 'Cost Scenario Planner', parent: 'Cost', icon: SlidersHorizontal, roles: ANALYTICS_ROLES },
      { to: '/cost-per-m3',       label: 'Cost per M3', parent: 'Production & Vendor',       icon: Layers,     roles: ANALYTICS_ROLES },
      { to: '/production-m3',     label: 'Production (M3)', parent: 'Production & Vendor',    icon: Boxes,      roles: ANALYTICS_ROLES },
      { to: '/sco-costs',         label: 'SCO Cost', parent: 'Production & Vendor',          icon: Receipt,    roles: ANALYTICS_ROLES },
      { to: '/sany-invoices',     label: 'SANY Invoices', parent: 'Production & Vendor',     icon: FileText,   roles: ANALYTICS_ROLES },
      { to: '/sany-delay-penalty', label: 'SANY Delay Penalty', parent: 'Production & Vendor', icon: Clock,     roles: ANALYTICS_ROLES },
      { to: '/roi-calculator',    label: 'ROI Calculator', parent: 'Modelling',    icon: DollarSign, roles: ANALYTICS_ROLES },
      { to: '/tco-calculator',    label: 'TCO Calculator', parent: 'Modelling',    icon: Calculator, roles: ANALYTICS_ROLES },
      { to: '/taas',              label: 'Tyre-as-a-Service', parent: 'Modelling', icon: Repeat, adminOnly: A },
      { to: '/customer-portal',  label: 'Customer Portal', parent: 'Commercial',    icon: Building2, adminOnly: A },
      { to: '/billing',          label: 'Billing & Subscription', parent: 'Commercial', icon: CreditCard, adminOnly: true, flag: 'billing' },
    ],
  },
  {
    label: 'Analytics & Reports',
    items: [
      { to: '/board-overview',    label: 'Board Overview', parent: 'Dashboards',    icon: BarChartBig, roles: ANALYTICS_ROLES },
      { to: '/executive-report',  label: 'Executive Report', parent: 'Dashboards',  icon: BookOpen, adminOnly: A },
      { to: '/executive-analytics', label: 'Executive Analytics', parent: 'Dashboards', icon: TrendingUp, roles: ANALYTICS_ROLES },
      { to: '/analytics',    label: 'Analytics', parent: 'Dashboards',          icon: BarChart2,      roles: ANALYTICS_ROLES },
      { to: '/advanced-analytics',     label: 'Advanced Analytics', parent: 'Dashboards',     icon: BarChartBig, roles: ANALYTICS_ROLES },
      { to: '/kpi',          label: 'KPI Center', parent: 'KPIs',         icon: ClipboardCheck, roles: ANALYTICS_ROLES },
      { to: '/kpi-engine',   label: 'Engineering KPI', parent: 'KPIs',    icon: Gauge,          roles: ANALYTICS_ROLES },
      { to: '/kpi-command',  label: 'KPI Command Center', parent: 'KPIs', icon: Target,         roles: ANALYTICS_ROLES },
      { to: '/benchmark',              label: 'Performance Benchmark', parent: 'KPIs',  icon: Target, adminOnly: A },
      { to: '/sla-dashboard',     label: 'SLA Dashboard', parent: 'KPIs',     icon: Target, adminOnly: A },
      { to: '/site-comp',    label: 'Site Comparison', parent: 'Comparison',    icon: Layers,         roles: ANALYTICS_ROLES },
      { to: '/country-comp', label: 'Country Comparison', parent: 'Comparison', icon: Globe,          roles: ANALYTICS_ROLES },
      { to: '/comparison',   label: 'Comparison', parent: 'Comparison',         icon: GitCompare,     roles: ANALYTICS_ROLES },
      { to: '/fleet',        label: 'Fleet Analytics', parent: 'Comparison',    icon: GitBranch,      roles: ANALYTICS_ROLES },
      { to: '/fleet-intelligence',     label: 'Fleet Intelligence', parent: 'Intelligence',     icon: Brain, roles: ANALYTICS_ROLES },
      { to: '/ops-intelligence',  label: 'Ops Intelligence', parent: 'Intelligence',  icon: Siren, adminOnly: A },
      { to: '/forecasting',         label: 'Forecasting Engine', parent: 'Intelligence',  icon: ForecastTrendIc, adminOnly: A },
      { to: '/fleet-optimizer',        label: 'Fleet Optimizer', parent: 'Intelligence',        icon: SlidersHorizontal, adminOnly: A },
      { to: '/carbon-tracker',         label: 'Carbon Tracker', parent: 'Intelligence',         icon: Leaf, roles: ANALYTICS_ROLES },
      { to: '/continuous-improvement', label: 'Continuous Improvement', parent: 'Intelligence', icon: Zap, adminOnly: A },
      { to: '/reports',           label: 'Reports', parent: 'Reporting',           icon: FileText },
      { to: '/report-center',     label: 'Report Center', parent: 'Reporting',     icon: ScrollText, roles: ANALYTICS_ROLES },
      { to: '/report-sharing',    label: 'Report Sharing', parent: 'Reporting',    icon: Share2, roles: ANALYTICS_ROLES },
      { to: '/scheduled-reports', label: 'Scheduled Reports', parent: 'Reporting', icon: CalendarCheck2 },
      { to: '/dashboard-builder', label: 'Dashboard Builder', parent: 'Reporting', icon: LayoutGrid },
      { to: '/display',           label: 'TV Display Mode', parent: 'Reporting',   icon: Radio, adminOnly: A },
      { to: '/ai-command-center', label: 'Smart Analytics (AI)', parent: 'AI', icon: Sparkles, adminOnly: A },
      { to: '/knowledge-base',    label: 'Knowledge Base', parent: 'AI',    icon: Brain, adminOnly: A },
      { to: '/ai-cost-monitor',   label: 'AI Cost Monitor', parent: 'AI',   icon: BarChart, adminOnly: A },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/events',            label: 'Event Stream',       icon: Radio, adminOnly: A, flag: 'automation_platform' },
      { to: '/workflow-settings', label: 'Approval Workflows', icon: GitBranch, adminOnly: A, flag: 'automation_platform' },
      { to: '/approval-delegations', label: 'Approval Delegations', icon: ArrowLeftRight, flag: 'automation_platform' },
      { to: '/approval-matrix', label: 'Approval Matrix', icon: ShieldCheck, adminOnly: true },
      { to: '/automation-rules',  label: 'Automation Rules',   icon: Zap, adminOnly: A, flag: 'automation_platform' },
      { to: '/integrations',      label: 'API & Webhooks',     icon: Webhook, adminOnly: A, flag: 'automation_platform' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/data-intake',      label: 'Data Intake Center', parent: 'Data', icon: Database },
      { to: '/erp-import',       label: 'ERP Data Import', parent: 'Data',    icon: Upload, roles: ANALYTICS_ROLES },
      { to: '/erp-intake',       label: 'Data Intake (ERP)', parent: 'Data', icon: Layers, roles: ANALYTICS_ROLES },
      { to: '/expense-import',   label: 'Expense Import', parent: 'Data',     icon: Receipt, roles: ANALYTICS_ROLES },
      { to: '/upload-approvals', label: 'Upload Approvals', parent: 'Data',   icon: ClipboardList, roles: UPLOAD_ROLES },
      { to: '/cleaning',         label: 'Data Cleaning', parent: 'Data',      icon: Wand2, roles: CLEANING_ROLES },
      { to: '/data-reconciliation', label: 'Data Reconciliation', parent: 'Data', icon: GitCompare, adminOnly: true },
      { to: '/custom-data',      label: 'Custom Data', parent: 'Data',        icon: Database },
      { to: '/erp-sync',            label: 'ERP Sync', parent: 'Data',           icon: Database, roles: ERP_ROLES },
      { to: '/ocr-scanner',      label: 'OCR Scanner', parent: 'Data',        icon: ScanLine, adminOnly: A },
      { to: '/advanced-search',  label: 'Advanced Search', parent: 'Data',    icon: Search },
      { to: '/brand-assets',     label: 'Brand Assets', parent: 'Organisation',       icon: Palette, adminOnly: true },
      { to: '/onboarding-wizard', label: 'Onboarding Wizard', parent: 'Organisation', icon: Rocket, adminOnly: true },
      { to: '/audit',            label: 'Audit Trail', parent: 'System',        icon: ClipboardList, roles: AUDIT_ROLES },
      { to: '/system-health',    label: 'System Health', parent: 'System',      icon: HeartPulse, adminOnly: true },
      { to: '/tenant-health',    label: 'Usage & Adoption', parent: 'System',   icon: BarChart, adminOnly: true },
      { to: '/developer-portal', label: 'Developer Portal', parent: 'System',   icon: Code, adminOnly: true },
      { to: '/settings',         label: 'Settings', parent: 'System',           icon: Settings },
      { to: '/help',             label: 'Help & Support', parent: 'System',     icon: LifeBuoy },
    ],
  },
]

// Sub-headings ("parents") that legitimately belong to each group, derived from
// NAV_GROUPS so it cannot drift. Used as a GUARD at render: a super-admin can move
// an item to a different group in the Navigation Customizer, which would leave its
// `parent` naming a heading that belongs elsewhere. Such an item renders directly
// under its new group instead of inventing a stray heading.
const GROUP_PARENTS = new Map(
  NAV_GROUPS.map((g) => [g.label, new Set(g.items.map((i) => i.parent).filter(Boolean))]),
)

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
  // The GRANT check uses the same key the route guard resolves (NAV_MODULE_KEY,
  // else the route slug), so a page that has no NAV_MODULE_KEY entry - e.g.
  // /serial-tracker -> 'serial_tracker' - still becomes visible once an admin
  // grants it. The matrix check below deliberately stays NAV_MODULE_KEY-only:
  // widening it to the slug would make permissive built-in roles (Manager,
  // Director) SEE admin-only items they would then be denied at the route.
  const routeGrantKey = governingModuleKey(item.to)
  if (routeGrantKey && grantedModules && grantedModules.has(routeGrantKey)) return true
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

// Translated role label; a CUSTOM role has no i18n entry, so the raw key
// ("roles.Fleet Supervisor") would leak to the UI - show the plain name instead.
function roleLabel(t, role) {
  if (!role) return ''
  const key = `roles.${role}`
  const v = t(key)
  return v === key ? role : v
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
  const hasCustomIcon = Boolean(customAppIcon)
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
            <BrandIcon src={appIcon} custom={hasCustomIcon} size={16} />
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

const SIDEBAR_EXPANDED = 240
const SIDEBAR_COLLAPSED = 54
// Mobile drawer: min(86vw, MOBILE_DRAWER_MAX) so it fits a 360px phone and does
// not sprawl on a tablet. Was a flat 240px on every device.
const MOBILE_DRAWER_MAX = 360

export default function Layout({ children }) {
  useRealtimeSync()

  const { profile, hasPermission, grantedModules, isSuperAdmin } = useAuth()
  const { t }                               = useLanguage()
  const { branding }                        = useTenant()
  // Org-assigned app icon (V120); falls back to the built-in mark so an
  // unbranded org renders exactly as before. A custom (usually navy/coloured)
  // logo is framed on a light chip via <BrandIcon> so it stays legible on the
  // dark/green badges.
  const customAppIcon = resolveBrandLogo(branding, 'app_icon')
  // Second fallback: the Console -> Report Colors company logo (same chain the
  // PDF reports use), so the org's real mark shows in the header without a
  // separate app-icon upload. Best-effort; the built-in mark still closes the chain.
  const [companyLogo, setCompanyLogo] = useState('')
  useEffect(() => {
    if (customAppIcon) return
    let on = true
    getCompanyLogo().then((url) => { if (on && url) setCompanyLogo(url) }).catch(() => {})
    return () => { on = false }
  }, [customAppIcon])
  const appIcon = customAppIcon || companyLogo || TpLogo
  const hasCustomIcon = Boolean(customAppIcon || companyLogo)
  // `contextKey` changes whenever the working context (country/region/site)
  // changes. It is folded into the routed content's React key below so pages
  // REMOUNT on a context switch. Without it a stale in-flight response can land
  // after the switch and paint the previous country's rows under the new label:
  // 0 pages use react-query and 188 of 247 have no cancellation guard, so this
  // one key is the honest fix rather than retrofitting every page.
  const { activeCountry, contextKey } = useSettings()
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
  const [alertCount, setAlertCount]           = useState(0)
  // NOTE: there was a `hoveredItem` state here, set by onMouseEnter/onMouseLeave
  // on every nav link and READ BY NOTHING. Moving the mouse across the sidebar
  // therefore re-rendered this whole component, which re-ran the permission
  // filter over ~186 nav items on every frame of the movement. Deleted rather
  // than memoised: dead state is not worth keeping fast. If a hover effect is
  // ever wanted, do it in CSS (:hover) or inside the leaf NavLink, so it cannot
  // re-render the nav tree again.
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

  function toggleGroup(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }


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

  // Mobile drawer width. The drawer used to be a fixed 240px on every handset,
  // which is cramped on a 360px phone and wasteful on a tablet. Sized from the
  // viewport instead (min(86vw, 360px)), computed as a NUMBER because framer
  // animates the width and a CSS min() string would not tween. Tracked on
  // resize/orientation change so a rotation does not leave a stale width.
  const [viewportW, setViewportW] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : SIDEBAR_EXPANDED),
  )
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  const drawerWidth = Math.min(Math.round(viewportW * 0.86), MOBILE_DRAWER_MAX)

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
    let cancelled = false
    async function fetchAlertCount() {
      // A hidden tab is a TV left on or a background window; refreshing a badge
      // nobody can see is pure cost. The visibility listener below catches up the
      // moment it is looked at again, so nothing goes stale in front of a user.
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const country = activeCountry !== 'All' ? activeCountry : null
        const dismissed = (() => {
          try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
          catch { return new Set() }
        })()
        const count = await detectAlertBadgeCount(supabase, country, dismissed)
        if (!cancelled) setAlertCount(count)
      } catch { /* ignore */ }
    }
    // Deferred off the cold-load path. The badge is a background number that no
    // one reads in the first second, and firing it during mount put its queries
    // in contention with the queries of the page the user actually opened.
    const kick = setTimeout(fetchAlertCount, 3000)
    const iv = setInterval(fetchAlertCount, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', fetchAlertCount)
    return () => {
      cancelled = true
      clearTimeout(kick)
      clearInterval(iv)
      document.removeEventListener('visibilitychange', fetchAlertCount)
    }
  }, [activeCountry])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(v => !v) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setCmdOpen])



  if (profile?.role === 'Tyre Man') {
    return <TyreManShell alertCount={alertCount} appIcon={appIcon} customAppIcon={hasCustomIcon ? appIcon : null}>{children}</TyreManShell>
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
            ? { x: sidebarOpen ? 0 : -drawerWidth, width: drawerWidth }
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
              <BrandIcon src={appIcon} custom={hasCustomIcon} size={18} />
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
                  <span className="tp-wordmark font-extrabold text-[15px] tracking-tight whitespace-nowrap leading-none block">
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

        {/* Search, working context and language used to live here. They are
            global controls, not navigation, so they now sit in <TopBar>. The
            sidebar is navigation only. The old hardcoded All/KSA/UAE/EGY pill
            row is gone: it could not scale past three countries and it mixed an
            aggregation mode into everyday operations. See WorkingContextSelector
            (operations) and ReportingScopeBar (analytics). */}

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
                      {visibleItems.map(({ to, label: lbl, icon: Icon, end, parent }, _i) => {
                        const _navKey = `nav.items.${to}`
                        const _navRaw = t(_navKey)
                        const navLabel = (!_navRaw || _navRaw === _navKey) ? lbl : _navRaw
                        // Items arrive already ordered by parent, so a sub-heading is
                        // drawn when the parent changes. Guarded by GROUP_PARENTS so a
                        // regrouped item cannot render a heading from another group.
                        const _prevParent = _i > 0 ? visibleItems[_i - 1].parent : null
                        const _showParent = sidebarOpen && parent && parent !== _prevParent
                          && GROUP_PARENTS.get(groupId)?.has(parent)
                        return (
                        <Fragment key={to}>
                        {_showParent && (
                          <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.09em]"
                             style={{ color: 'var(--text-dim)' }}>
                            {(() => {
                              // Same fallback contract as the group/item labels: an
                              // untranslated key renders the plain English heading
                              // rather than leaking "nav.parents.Registry".
                              const k = `nav.parents.${parent}`
                              const raw = t(k)
                              return (!raw || raw === k) ? parent : raw
                            })()}
                          </p>
                        )}
                        <NavLink
                          to={to}
                          end={end}
                          title={!sidebarOpen ? navLabel : undefined}
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
                        </Fragment>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}

          {/* NO System Console entry here - by explicit instruction the main
              app frontend never surfaces the console, not even to admins or
              super admins. The console is reached ONLY by opening /console
              directly, in its own tab, behind its own sign-in (see App.jsx
              ConsoleSurfaceGate). Do not re-add a console link to this nav. */}
        </nav>

        {/* The user footer (avatar, role, app version, theme, notifications,
            sign-out) moved into <ProfileMenu> in the top bar, so each of those
            controls exists exactly once in the shell. */}

      </motion.aside>

      {/* ── Top bar + main content ───────────────────────────────────────────
          The desktop app previously had NO top bar at all: search, country,
          language, theme, notifications, profile, version and sign-out were all
          inside the 240px sidebar, which also carries the whole nav. TopBar now
          owns the global controls (desktop AND mobile, replacing the old fixed
          52px mobile header), leaving the sidebar for navigation only. It sits
          as a sibling ABOVE <main> in a flex column, so it stays visible without
          needing position:fixed or a matching paddingTop on the scroll area. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          onToggleSidebar={() => setSidebarOpen(v => !v)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
          alertCount={alertCount}
          appIcon={appIcon}
          hasCustomIcon={hasCustomIcon}
        />

        <main
          className="flex-1 overflow-y-auto"
          style={{
            scrollbarWidth: 'thin',
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
            // Route AND working context. Changing the context remounts the page
            // so a response that was already in flight cannot resolve into the
            // new context and paint the previous country's rows under the new
            // label. The route half is unchanged, so switching context keeps you
            // on the same module rather than bouncing you to the dashboard.
            key={`${location.pathname}|${contextKey ?? ''}`}
            initial={{ opacity: 1, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="px-4 py-5 sm:px-6 xl:px-8 2xl:px-10 max-w-[1800px] mx-auto"
          >
            {children}
          </motion.div>
        </main>
      </div>


      {/* PWA */}
      <InstallPwaPrompt />

      {/* Mobile bottom navigation */}
      {isMobile && (
        <MobileBottomNav
          alertCount={alertCount}
          onMenuOpen={() => setSidebarOpen(true)}
        />
      )}


      {/* Command palette - Ctrl/Cmd+K */}
      <CommandPalette />

      {/* Role-based first-run onboarding */}
      <OnboardingWizard />

      {/* An inline search palette used to live here. It was ALREADY dead code
          on main: nothing ever set `searchOpen` to true. Removed along with
          the orphaned <GlobalSearch> mount so the shell has exactly ONE
          search surface, <CommandPalette>, which is the only one that reads
          the shared permission-gated RECORD_SOURCES. */}
    </div>
  )
}
