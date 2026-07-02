# TyrePulse Export Guide - PDF | Excel | PowerPoint

**Last Updated:** 2026-07-02  
**Version:** 2.0.0  
**Language Composition:** 83% JavaScript, 11.6% TypeScript, 4.4% PL/pgSQL

---

## Table of Contents

1. [Overview](#overview)
2. [PDF Export Best Practices](#pdf-export-best-practices)
3. [Excel Export Best Practices](#excel-export-best-practices)
4. [PowerPoint Export Best Practices](#powerpoint-export-best-practices)
5. [Implementation Architecture](#implementation-architecture)
6. [Configuration & Customization](#configuration--customization)
7. [Performance Optimization](#performance-optimization)
8. [Troubleshooting](#troubleshooting)

---

## Overview

TyrePulse provides **three enterprise-grade export formats** for flexible reporting across all business functions:

| Format | Use Case | Max Records | Generation Time |
|--------|----------|-------------|-----------------|
| **PDF** | Operational detail, inspections, compliance | 10,000 | 200-500ms |
| **Excel** | Data analysis, multi-sheet workbooks, filtering | 100,000 | 300-800ms |
| **PowerPoint** | Executive presentations, board meetings, stakeholder communication | 5,000 | 500-1200ms |

### Core Export Functions (`src/lib/exportUtils.js`)

```javascript
// PDF: data tables + KPI summaries + auto-generated insights
export function exportToPdf(rows, columns, title, filename, orientation, company, opts)

// Excel: multi-sheet workbooks with summary + auto-filters
export function exportToExcel(rows, columns, headers, filename, sheetName, opts)

// PowerPoint: presentation decks with charts, tables, and narrative slides
export async function exportToPptx(data, filename)

// Specialized: inspection detail PDFs with tyre diagrams
export async function exportInspectionDetailPdf(row, opts)

// Executive: daily operations report with KPI dashboards
export function exportDailyExecutivePdf(data, filename)
```

---

## PDF Export Best Practices

### 1. **Core Architecture**

**Library Stack:**
- `jsPDF` (v4.2.1) - document generation
- `jspdf-autotable` (v3.8.1) - table layout engine
- `SVG-to-PNG capture` - vector diagram rendering

**Color Palette (Deep Slate + Indigo + Gold):**
```javascript
const P = {
  // Darks
  ink:      [8,   12,  28],   // near-black navy
  slate:    [15,  23,  42],   // header backgrounds
  steel:    [30,  41,  59],   // table headers
  iron:     [51,  65,  85],   // secondary elements

  // Accents
  indigo:   [79,  70,  229],  // primary accent
  violet:   [109, 40,  217],  // secondary accent
  gold:     [245, 158, 11],   // KPI highlights

  // Status (rich, not neon)
  emerald:  [4,   120, 87],   // good
  crimson:  [153, 27,  27],   // critical
  scarlet:  [194, 65,  12],   // high
  ochre:    [120, 53,  15],   // medium

  // Tints & Neutrals
  eCream:   [236, 253, 245],  // good bg
  rCream:   [254, 242, 242],  // critical bg
  white:    [255, 255, 255],
  offWhite: [248, 250, 252],
}
```

### 2. **Multi-Page Layouts**

**Standard Report PDF Structure:**
```
Page 1: Analytical Summary
  ├─ KPI cards (Total Records, Critical, High Risk, Distinct Categories, Total Cost)
  ├─ Category breakdown chart (left)
  ├─ Risk distribution chart (right)
  └─ Auto-generated narrative insights

Pages 2+: Data Table (operational detail)
  ├─ Frozen header row (first row always visible)
  ├─ Risk-level cell styling (colors + bold)
  ├─ Auto-scaled columns (28-50pt width)
  ├─ Page headers/footers (company name, date, page #)
  └─ Page breaks at row boundaries (no orphaned rows)
```

### 3. **Risk-Level Styling**

```javascript
// Auto-apply colors based on risk column
didParseCell: (data) => {
  if (data.section !== 'body' || data.column.index !== riskIdx) return
  const v = String(data.cell.raw ?? '').trim().toLowerCase()
  
  if (v === 'critical') {
    data.cell.styles.fillColor = P.rCream      // [254, 242, 242]
    data.cell.styles.textColor = P.crimson     // [153, 27, 27]
    data.cell.styles.fontStyle = 'bold'
  } else if (v === 'high') {
    data.cell.styles.fillColor = P.oCream      // [255, 247, 237]
    data.cell.styles.textColor = P.scarlet     // [194, 65, 12]
  } else if (v === 'medium') {
    data.cell.styles.fillColor = P.yCream      // [254, 252, 232]
    data.cell.styles.textColor = P.ochre       // [120, 53, 15]
  } else if (v === 'low') {
    data.cell.styles.fillColor = P.eCream      // [236, 253, 245]
    data.cell.styles.textColor = P.emerald     // [4, 120, 87]
  }
}
```

### 4. **Special Report Types**

#### Inspection Detail PDF
- **Purpose:** Vehicle inspection records with tyre diagrams
- **Input:** Single inspection row + vehicle type + tyre conditions
- **Output:** 3-5 page multi-section document

**Sections:**
1. Title card with severity ribbon (color-coded by risk level)
2. Meta grid (2-column: date, site, asset, vehicle type, status, findings)
3. Tyre diagram (captured SVG or programmatic rendering)
4. Tyre condition table (position, pressure, tread, condition, risk, notes)
5. Risk distribution progress bars
6. Findings & observations (free text)
7. Recommended actions (auto-generated or manual)
8. Inspector certification block (signature space)

**Tyre Position Layouts:**
- **Pickup** (4 tyres): FL, FR, RL, RR
- **Dual-rear trucks** (6 tyres): Canter, Bus, Tata, Ashok Leyland
- **Tri-mixer** (12 tyres): Multi-axle concrete mixers
- **Loaders** (4 tyres): Wheel loader, Skid loader

#### Executive Daily Operations PDF
- **Purpose:** C-level strategic report (60-second read)
- **Pages:** 5 total
- **Output:** Landscape A4

**Page Breakdown:**
```
Page 1: Cover
  ├─ Company branding
  ├─ Title + period + date
  └─ 4 KPI tiles (vehicles, tyres, critical, actions)

Page 2: Executive Summary (narrative-first)
  ├─ Fleet status banner (color-coded: crit/warn/good)
  ├─ Situation overview (2 paragraphs)
  ├─ Business insights (6 chips)
  └─ Predictive outlook + priority action

Page 3: KPI Command Center
  ├─ 6 KPI boxes (vehicles, tyres, compliance, inspections, actions, cost)
  ├─ Fleet tyre condition bar (stacked segments: good/warning/critical)
  └─ Financial snapshot (monthly spend, YTD, cost/km, budget variance)

Page 4: Tyre Health & Site Analysis
  ├─ Defect pattern analysis (horizontal bar chart)
  └─ Site performance matrix (table: site, vehicles, alerts, compliance, status)

Page 5: Strategic Insights & Recommendations
  ├─ Operational intelligence (left column)
  └─ Priority action plan (right column, color-coded by priority)
```

### 5. **Key Implementation Notes**

**File Naming Convention:**
```javascript
const safe = (title) => title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`)
// Output: TyrePulse_Fleet_Summary_2026-07-02.pdf
```

**Page Header/Footer Pattern:**
```javascript
function _pageHeader(doc, title, subtitle, company = '') {
  const pw = doc.internal.pageSize.width
  // Deep slate background
  doc.setFillColor(...P.slate)
  doc.rect(0, 0, pw, 20, 'F')
  // Indigo accent stripe
  doc.setFillColor(...P.indigo)
  doc.rect(0, 20, pw, 2.5, 'F')
  // Company name (left), Title (center), Subtitle (right)
  doc.text((company || 'FLEET OPERATIONS').toUpperCase(), 14, 8)
  doc.text(title, 14, 15)
  doc.text(subtitle, pw - 14, 10, { align: 'right' })
  doc.text(formatDate(new Date(), 'All'), pw - 14, 16, { align: 'right' })
}

function _pageFooter(doc, page, total, company = '') {
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  doc.setFillColor(...P.cloud)
  doc.rect(0, ph - 9, pw, 9, 'F')
  doc.text(`${company}  ·  Confidential & Internal`, 14, ph - 3)
  doc.text(`${page}${total ? ` / ${total}` : ''}`, pw - 14, ph - 3, { align: 'right' })
}
```

**Safe Value Handling:**
```javascript
// Always coerce to string; handle null/undefined
function _parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
```

**Auto-Narrative Generation:**
```javascript
function _deriveNarrative(data) {
  const totalT = data.totalTyres || 0
  const crit = data.criticalTyres || 0
  const comp = data.pressureCompliance ?? 0
  
  const tone = crit >= 15 || comp < 70 ? 'crit'
           : crit >= 5 || comp < 85 ? 'warn'
           : 'good'
  
  const status = tone === 'crit' ? 'Requires Immediate Attention'
             : tone === 'warn' ? 'Stable - Monitoring Advised'
             : 'Healthy - Within Target'
  
  return {
    status,
    tone,
    paragraphs: [
      `The fleet ${tone === 'crit' ? 'requires immediate attention' : ...}. Of ${totalT.toLocaleString()} monitored tyre records, ${comp}% sit within safe operating limits...`,
      `${actions} corrective action${actions === 1 ? '' : 's'} ${actions === 1 ? 'is' : 'are'} open...`
    ],
    action: crit > 0 ? `Replace ${crit} critical tyre${crit === 1 ? '' : 's'}...` : `...`
  }
}
```

---

## Excel Export Best Practices

### 1. **Multi-Sheet Architecture**

**Sheet 1: Summary (Analytical)**
```
[Report Title]
Generated | [Date]
Date range | [From-To]
Organisation | [Company Name]
Total records | [N]

Risk Distribution
Level | Count | % of total
Critical | X | Y%
High | X | Y%
...

[Category Breakdown (Top 15)]
[Category] | Count | % of total
...

Numeric Summary
Metric | Total | Average
[Cost] | [Sum] | [Avg]
[Count] | ... | ...
```

**Sheet 2: Data (Frozen Header + Auto-Filter)**
- Frozen first row (stays visible when scrolling)
- Auto-filter enabled on all columns
- Dynamic column width (min 8pt, max 44pt)
- Headers bold + centered

### 2. **Smart Column Detection**

```javascript
const riskKey = columns.find(k => /risk/i.test(k))
const catPriority = ['site', 'branch', 'country', 'brand', 'category', 
                      'type', 'vendor', 'supplier', 'workshop', 'status']
let catKey = columns.find(k => catPriority.some(p => k.toLowerCase().includes(p)))
const numKeys = columns.filter(k => _colIsNumeric(rows, k))

// Numeric columns get auto-summarized (total + avg)
function _colIsNumeric(rows, key) {
  let num = 0, seen = 0
  for (const r of rows.slice(0, 60)) { // sample first 60 rows
    const v = r[key]
    if (v === '' || v == null) continue
    seen++
    if (_parseNum(v) != null) num++
  }
  return seen > 0 && num / seen >= 0.75
}
```

### 3. **Currency & Number Formatting**

```javascript
const isMoney = /cost|amount|price|spend|value|budget|claim|deduct|recover/i.test(key)
const fm = v => isMoney 
  ? `${currency} ${Math.round(v).toLocaleString()}` 
  : Math.round(v * 100) / 100

// Excel output
aoa.push([hdr, fm(tot), fm(tot / rows.length)])
// Output: "Total Cost | SAR 1,234,567 | SAR 12,346"
```

### 4. **Column Width Calculation**

```javascript
ws['!cols'] = headers.map((h) => {
  const maxLen = Math.max(
    h.length,
    ...displayRows.map(r => String(r[h] ?? '').length)
  )
  return { wch: Math.min(maxLen + 2, 44) }  // 2pt padding, 44pt max
})
```

### 5. **Export Options**

```javascript
exportToExcel(rows, columns, headers, filename, sheetName, {
  title: 'Fleet Summary Report',           // Summary sheet title
  currency: 'SAR',                         // For cost formatting
  company: 'Your Company Name',            // Branding
  dateRange: '2026-06-01 to 2026-07-02',  // Filter display
  meta: {                                  // Additional metadata rows
    'Scope': 'All countries',
    'Generated by': 'TyrePulse v2.0'
  }
})
```

### 6. **Data Safety Checks**

```javascript
// Never emit invalid XLSX
function _countBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const v = r[key]
    if (v === '' || v == null) continue
    const s = String(v).trim()
    if (!s) continue
    m.set(s, (m.get(s) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// Filter out empty strings and nulls before processing
rows = Array.isArray(rows) ? rows : []
```

---

## PowerPoint Export Best Practices

### 1. **Core Architecture**

**Library Stack:**
- `pptxgenjs` (v3.12.0) - presentation generation
- Native chart engine - embedded, editable charts
- Light corporate theme - white background, saturated accents

**Color Palette (AA-contrast on white):**
```javascript
const BG     = 'F6F8FC'   // slide background (light blue-gray)
const CARD   = 'FFFFFF'   // panel backgrounds (white)
const PANEL  = 'F1F5F9'   // soft fills
const BORDER = 'E2E8F0'   // divider lines

const INK    = '0F172A'   // primary text (dark navy)
const SUBTLE = '475569'   // secondary text
const MUTED  = '94A3B8'   // tertiary text (lighter)

const INDIGO = '4F46E5'   // primary accent (saturated)
const VIOLET = '7C3AED'   // secondary accent
const GOLD   = 'D97706'   // warm accent
const EMER   = '059669'   // good (emerald)
const CRIM   = 'DC2626'   // critical (red)
const SCAR   = 'EA580C'   // high (orange)
const SKY    = '0284C7'   // sky blue
const TEAL   = '0D9488'   // teal
```

### 2. **Slide Deck Structure (8 slides)**

#### Slide 1: Cover
```
├─ Left panel (navy blue)
│  ├─ Company logo area
│  └─ Gold accent bar
├─ Title: "Fleet Operations Report"
├─ Subtitle: "[Period]" (e.g., "Daily Summary")
├─ Right side KPI tiles (4): Vehicles | Tyres | Critical | Actions
└─ Footer: "CONFIDENTIAL - FOR MANAGEMENT REVIEW"
```

#### Slide 2: Executive Summary (60-second read)
```
├─ Fleet status banner (color-coded by tone: critical/stable/healthy)
├─ Situation overview (bullet points)
├─ Business insights (4 chips with accent colors)
├─ Predictive outlook + priority action (right column)
└─ Footer: page number
```

#### Slide 3: KPI Command Center
```
├─ 5 KPI tiles (Total Tyres | Total Cost | High Risk | Compliance | Open Actions)
├─ Fleet condition doughnut chart (within spec vs. high risk)
├─ Risk distribution bar chart (Critical | High | Medium | Low)
└─ Footer: page number
```

#### Slide 4: Consumption & Trend Analysis (if data available)
```
├─ 4 KPI tiles (Latest Period | Period Average | Trend | Peak Period)
├─ Area chart (Tyre Issues over months)
└─ Footer: page number
```

#### Slide 5: Sites & Category Analysis (if data available)
```
├─ Top sites by consumption (horizontal bar chart, left)
├─ Category mix (doughnut chart, right)
└─ Footer: page number
```

#### Slide 6: Cost & Vendor Performance (if data available)
```
├─ Cost by site (horizontal bar chart, left)
├─ Brand performance (horizontal bar chart, right)
└─ Footer: page number
```

#### Slide 7: Open Corrective Actions (if data available)
```
├─ Table: Action | Site | Priority | Status
├─ Row styling: alternating fill, priority colors
└─ Footer: page number
```

#### Slide 8: Insights & Recommended Actions
```
├─ Operational intelligence (left: 4 insight boxes)
├─ Priority action plan (right: 4 recommendation boxes, color-coded)
└─ Footer: page number
```

### 3. **Chart Safety & Validation**

```javascript
function cleanSeries(series) {
  return (series || []).map(s => {
    const rawLabels = Array.isArray(s.labels) ? s.labels : []
    const rawValues = Array.isArray(s.values) ? s.values : []
    const len = Math.max(rawLabels.length, rawValues.length)
    
    const labels = []
    const values = []
    for (let i = 0; i < len; i++) {
      // PowerPoint OOXML validation: no empty labels, no NaN/Infinity values
      const lbl = rawLabels[i]
      const n = Number(rawValues[i])
      labels.push(lbl == null || String(lbl).trim() === '' ? '-' : String(lbl))
      values.push(Number.isFinite(n) ? n : 0)
    }
    return { ...s, labels, values }
  })
}

function safeChart(slide, type, series, opts) {
  const clean = cleanSeries(series)
  const hasData = clean.some(s => s.values.length && s.values.some(v => v !== 0))
  
  if (!hasData) {
    // Show "no data" message instead of broken chart
    slide.addText('No data available for this period', {
      x: opts.x, y: opts.y, w: opts.w, h: Math.min(opts.h, 0.6),
      fontSize: 11, italic: true, color: MUTED, align: 'center', valign: 'middle'
    })
    return
  }
  
  slide.addChart(type, clean, opts)
}
```

### 4. **Chart Configuration Patterns**

```javascript
const cOpts = (extra = {}) => ({
  showLegend: false,
  showTitle: false,
  chartColors: CHART_COLORS,
  chartColorsOpacity: 95,
  
  // Axis labels
  catAxisLabelColor: SUBTLE,
  catAxisLabelFontSize: 9,
  valAxisLabelColor: MUTED,
  valAxisLabelFontSize: 9,
  
  // Grid
  valGridLine: { color: BORDER, size: 0.5 },
  catGridLine: { style: 'none' },
  
  // Data labels
  dataLabelColor: INK,
  dataLabelFontSize: 9,
  dataLabelFontBold: true,
  
  ...extra  // override specific options
})

// Example: doughnut chart with custom colors
safeChart(s, pptx.ChartType.doughnut,
  [{ name: 'Condition', labels: ['Within Spec', 'High Risk'], values: [good, high] }],
  cOpts({
    x: 0.4, y: 3.75, w: 5.2, h: 3.0,
    holeSize: 62,
    chartColors: [EMER, CRIM],
    showLegend: true,
    legendPos: 'r',
    legendColor: SLATE,
    legendFontSize: 10,
    showValue: true,
    dataLabelFormat: '#,##0'
  })
)
```

### 5. **Text & Styling**

**KPI Tile Pattern:**
```javascript
function kpiTile(slide, x, y, w, label, value, color, sub) {
  // Card background
  slide.addShape(rect, {
    x, y, w, h: 1.55,
    fill: { color: CARD },
    line: { color: BORDER, width: 1 },
    rounding: true,
    shadow: { type: 'outer', color: 'C7D0DE', blur: 7, offset: 2, angle: 90, opacity: 0.45 }
  })
  
  // Top accent bar
  slide.addShape(rect, { x, y, w, h: 0.09, fill: { color } })
  
  // Label
  slide.addText(String(label).toUpperCase(), {
    x: x + 0.18, y: y + 0.2, w: w - 0.36, h: 0.3,
    fontSize: 9, bold: true, color: MUTED, charSpacing: 1
  })
  
  // Value
  slide.addText(String(value ?? '-'), {
    x: x + 0.18, y: y + 0.46, w: w - 0.36, h: 0.62,
    fontSize: 27, bold: true, color
  })
  
  // Sub-text
  if (sub) slide.addText(String(sub), {
    x: x + 0.18, y: y + 1.1, w: w - 0.36, h: 0.35,
    fontSize: 9, color: SUBTLE
  })
}
```

**Insight Box Pattern:**
```javascript
// Operational intelligence box (left column)
slide.addShape(rect, {
  x: 0.4, y, w: 6.1, h: 1.0,
  fill: { color: CARD },
  line: { color: BORDER, width: 1 },
  rounding: true,
  shadow: SHADOW
})
slide.addShape(rect, {
  x: 0.4, y, w: 0.08, h: 1.0,
  fill: { color: INDIGO }  // accent stripe
})
slide.addText(insight, {
  x: 0.62, y: y + 0.1, w: 5.75, h: 0.8,
  fontSize: 10, color: SLATE, valign: 'middle'
})

// Recommendation box (right column, priority-colored)
const priCol = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
slide.addShape(rect, {
  x: 6.9, y, w: 6.05, h: 1.0,
  fill: { color: CARD },
  line: { color: priCol[rec.priority] || INDIGO, width: 1 },
  rounding: true,
  shadow: SHADOW
})
slide.addShape(rect, {
  x: 6.9, y, w: 1.0, h: 0.3,
  fill: { color: priCol[rec.priority] || INDIGO },
  rounding: true
})
slide.addText((rec.priority || 'Medium').toUpperCase(), {
  x: 6.9, y: y + 0.03, w: 1.0, h: 0.25,
  fontSize: 7.5, bold: true, color: 'FFFFFF', align: 'center'
})
slide.addText(rec.text, {
  x: 8.0, y: y + 0.08, w: 4.85, h: 0.85,
  fontSize: 9.5, color: SLATE, valign: 'middle'
})
```

### 6. **File Output**

```javascript
export async function exportToPptx(data, filename = 'TyrePulse_Report') {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'  // 16:9 widescreen
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  
  // Build slides...
  
  // Save to client
  await pptx.writeFile({ fileName: `${filename}.pptx` })
}

// Typical call from Reports.jsx
const handlePptxExport = () => {
  exportToPptx({
    company: appSettings?.company_name || 'Fleet Operations',
    period: dateShortcut || 'Custom Period',
    currency: activeCurrency,
    totalVehicles: kpis.vehicles,
    totalTyres: kpis.tyres,
    criticalTyres: kpis.critical,
    openActions: actions.length,
    // ... 50+ data fields
  }, `TyrePulse_Report_${new Date().toISOString().slice(0, 10)}`)
}
```

---

## Implementation Architecture

### 1. **File Structure**

```
src/
├── lib/
│   └── exportUtils.js (1600+ lines)
│       ├── Color palettes (P, RISK_RGB, etc.)
│       ├── Helper functions (_pageHeader, _kpiBox, _hBarChart, etc.)
│       ├── Data analysis (_colIsNumeric, _countBy, _sumBy, etc.)
│       ├── PDF exports
│       │   ├── exportToPdf() - generic data tables
│       │   ├── exportInspectionDetailPdf() - inspections with diagrams
│       │   └── exportDailyExecutivePdf() - strategic reports
│       ├── Excel exports
│       │   └── exportToExcel() - multi-sheet workbooks
│       └── PowerPoint exports
│           └── exportToPptx() - presentation decks
│
├── pages/
│   ├── Reports.jsx - custom 5-report builder with filters
│   ├── ExecutiveReport.jsx - 7-section strategic report
│   ├── FleetAnalytics.jsx - fleet-level analysis + exports
│   ├── FleetIntelligence.jsx - availability & utilization
│   ├── FuelEfficiency.jsx - pressure & compliance impact
│   ├── BrandPerformance.jsx - vendor analytics
│   ├── Accidents.jsx - incident tracking
│   └── Settings.jsx - scheduled reports (daily/weekly/monthly)
│
└── components/
    └── EmailReportModal.jsx - email scheduling interface
```

### 2. **Data Flow: UI → Export → File**

```
Reports.jsx (config UI)
  ↓
  [filters: date, site, country, asset, brand, risk, inspection type]
  ↓
  runQuery() - fetch from Supabase, apply filters
  ↓
  allRows[] - aggregated & transformed
  ↓
  handleExcel() / handlePdf() / handlePptx()
  ↓
  exportToExcel / exportToPdf / exportToPptx
  ↓
  Generate document in memory
  ↓
  Browser download (TyrePulse_Report_2026-07-02.xlsx/.pdf/.pptx)
```

### 3. **Integration Points**

**Reports Page (5 custom report types):**
- Vehicle History - grouped by asset, brands, high-risk count
- Cost Analysis - grouped by site + brand
- Risk Summary - filtered by risk level (High, Critical)
- Inspection Report - from inspections table
- Tyre Replacement Log - chronological replacement list

**Executive Report:**
- 7-section strategic report
- Auto-generated business insights
- Predictive forecast (spend trend, compliance outlook)

**Scheduled Exports (Settings → Report Schedules):**
- Trigger: cron job (daily 00:15 UTC)
- Formats: PDF, Excel, Both
- Delivery: email via SendGrid or similar
- Frequency: Daily, Weekly (weekday picker), Monthly (date picker)

---

## Configuration & Customization

### 1. **Global Settings**

Edit `src/lib/exportUtils.js` top section:

```javascript
// ── Color Palette ────────────────────────────────────────────
const P = {
  // Update RGB values to match your brand
  indigo:   [79,  70,  229],  // primary accent
  gold:     [245, 158, 11],   // highlights
  // ... (adjust as needed)
}

// ── Page Layout ──────────────────────────────────────────
const MARGINS = { left: 14, right: 14, top: 28, bottom: 12 }  // in mm

// ── Font Sizes ──────────────────────────────────────────
const FONT_SIZES = {
  pageHeader:  11,
  sectionBar:  8,
  tableHeader: 8,
  tableBody:   7.5,
}
```

### 2. **Report Options**

Pass custom options to export functions:

```javascript
// PDF custom options
exportToPdf(rows, columns, 'Report Title', 'filename', 'landscape', 'Company Name', {
  currency: 'USD',            // number formatting
  company: 'Acme Corp',       // header branding
  showSummary: true,          // include analytics page
  includeCharts: true,        // KPI + breakdown charts
  riskStyling: true,          // color-code risk cells
})

// Excel custom options
exportToExcel(rows, columns, headers, 'filename', 'Data', {
  title: 'Custom Report Title',
  currency: 'EUR',
  company: 'Acme Corp',
  dateRange: '2026-06-01 to 2026-07-02',
  meta: {
    'Author': 'Fleet Manager',
    'Scope': 'All sites',
  }
})

// PowerPoint custom options
exportToPptx({
  company: 'Acme Corp',
  period: 'Q2 2026',
  currency: 'GBP',
  // 50+ data fields...
}, 'TyrePulse_Q2_Report')
```

### 3. **Conditional Exports**

Check data availability before exporting:

```javascript
// Only include charts if data exists
if (data.riskBreakdown?.length) {
  safeChart(s, pptx.ChartType.bar, ...)
}

// Only include site analysis if 2+ sites
if (data.topSites?.length > 1) {
  // Add slide 5
}

// Only include trends if 3+ periods
if (trend.length >= 3) {
  // Add consumption trend slide
}
```

---

## Performance Optimization

### 1. **Data Pagination**

**Problem:** Exporting 100k records → OOM crash

**Solution:**
```javascript
// Slice data for export (Excel/PPTX max 5k-10k, PDF max 10k)
const maxRecords = format === 'pptx' ? 5000 : 10000
const exportData = allRows.slice(0, maxRecords)

if (allRows.length > maxRecords) {
  console.warn(`Export limited to ${maxRecords} records. Total: ${allRows.length}`)
  // Show toast: "Exported first 5000 of 142,356 records"
}
```

### 2. **Lazy Chart Rendering**

**Problem:** Rendering 10 charts on one slide → slow generation

**Solution:**
```javascript
// Only generate charts for top-N items (8-15 max)
const topBrands = data.topBrands?.slice(0, 8)
const topSites = data.topSites?.slice(0, 10)

safeChart(s, pptx.ChartType.bar,
  [{ name: 'Tyres', labels: topBrands.map(b => b.brand), values: topBrands.map(b => b.count) }],
  { ... }
)
```

### 3. **Async Generation**

**Problem:** UI freezes during large PDF/PPTX generation

**Solution:**
```javascript
// Use async/await in event handler
const handlePptxExport = async () => {
  setExporting(true)
  try {
    await exportToPptx(data, filename)
    toast.success('PowerPoint downloaded')
  } catch (err) {
    toast.error('Export failed: ' + err.message)
  } finally {
    setExporting(false)
  }
}

// Show progress spinner
{exporting && <Loader2 className="animate-spin" />}
```

### 4. **SVG Diagram Caching**

**Problem:** Converting SVG to PNG for each inspection PDF → slow

**Solution:**
```javascript
// Cache converted images
const svgCache = new Map()

async function getCachedPngUrl(svgEl, scale = 2) {
  const key = svgEl.id || svgEl.outerHTML.slice(0, 100)
  if (svgCache.has(key)) return svgCache.get(key)
  
  const result = await svgToPngDataUrl(svgEl, scale)
  if (result) svgCache.set(key, result)
  return result
}

// Clear cache when navigating away
useEffect(() => {
  return () => svgCache.clear()
}, [])
```

### 5. **Query Optimization**

**Problem:** Fetching 100k rows → slow query + network overhead

**Solution:**
```javascript
// Use specific columns only
q = supabase
  .from('tyre_records')
  .select('issue_date,asset_no,brand,risk_level,cost_per_tyre,qty')  // NOT *
  .gte('issue_date', dateFrom)
  .lte('issue_date', dateTo)

// Apply filters server-side
if (filterRiskLevels.length) q = q.in('risk_level', filterRiskLevels)
if (filterSite) q = q.ilike('site', `%${filterSite}%`)
if (filterCountry) q = q.eq('country', filterCountry)

// Fetch in batches
const { data } = await fetchAllPages(
  (from, to) => q.range(from, to),
  { max: 100000 }
)
```

---

## Troubleshooting

### 1. **PDF Issues**

| Issue | Cause | Solution |
|-------|-------|----------|
| **Blank PDF** | No data rows | Check filter results; add placeholder text if empty |
| **Missing images** | SVG capture failed | Fallback to programmatic tyre diagram (`_drawTyreDiagram`) |
| **Layout overflow** | Text too long for cell | Use `doc.splitTextToSize()` to wrap; reduce font size |
| **Broken page breaks** | autoTable bug | Manually add pages before dense tables; use `startY` parameter |
| **Slow generation** | 10k+ rows | Limit to 5k rows; paginate in report UI |
| **Memory error** | Too many images | Reduce SVG scale; use PNG compression |

### 2. **Excel Issues**

| Issue | Cause | Solution |
|-------|-------|----------|
| **Won't open** | Invalid XLSX (NaN/Infinity) | Use `_parseNum()` to coerce values; test with LibreOffice |
| **Empty cells** | null/undefined values | Use `?? ''` operator; display as `'-'` in preview |
| **Wrong column width** | Dynamic calculation failed | Set manual `wch` values; test with wide/narrow data |
| **Auto-filter broken** | Bad ref range | Recalculate `ref: 'A1:Z100'` after adding rows |
| **Formulas not calculated** | XLSX doesn't evaluate | Pre-calculate in JavaScript; export as values only |

### 3. **PowerPoint Issues**

| Issue | Cause | Solution |
|-------|-------|----------|
| **Won't open** | Invalid OOXML (empty labels) | Use `cleanSeries()` before all charts; test with PPT validator |
| **Broken chart** | Data mismatch (labels ≠ values) | Log series length; use `safeChart()` wrapper |
| **Frozen after import** | Corrupted relationships.xml | Validate presentation structure; use online PPTX validator |
| **Slow generation** | 10+ slides with charts | Reduce chart count; use `max-height` on large tables |
| **Images not embedded** | External image URL | Embed as base64 data URL; include with `pptx.addImage()` |

### 4. **Common Errors & Fixes**

```javascript
// ERROR: "ReferenceError: doc is not defined"
// FIX: Ensure jsPDF is imported
import jsPDF from 'jspdf'
const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

// ERROR: "TypeError: split is not a function"
// FIX: String method called on non-string
const safe = String(data.value ?? '')
const parts = safe.split(',')

// ERROR: "RangeError: Maximum call stack size exceeded"
// FIX: Recursive loop in data transformation
// Use iterative approach instead:
const flattened = []
for (const item of items) {
  flattened.push(...processItem(item))
}

// ERROR: "Cannot read property 'length' of undefined"
// FIX: Check array exists before accessing
const records = data.records ?? []
const count = records.length  // no error if undefined

// ERROR: "PDF output is blank"
// FIX: No rows to export; add fallback content
if (rows.length === 0) {
  doc.text('No data available for this period.', 20, 20)
  doc.save('report.pdf')
  return
}
```

### 5. **Browser Console Debugging**

```javascript
// Log export parameters before generation
console.log('PDF Export:', { rows: rows.length, columns, title, currency })
console.log('Data sample:', rows.slice(0, 3))

// Check for data anomalies
const hasNaN = rows.some(r => Object.values(r).some(v => !Number.isFinite(Number(v)) && v !== ''))
const hasEmpty = rows.some(r => !r.asset_no || !r.cost)
console.warn('Data issues:', { hasNaN, hasEmpty })

// Validate export options
console.assert(filename && filename.trim(), 'Filename required')
console.assert(Array.isArray(rows), 'Rows must be array')
console.assert(columns.every(c => c.key && c.header), 'Invalid columns')
```

---

## Best Practices Checklist

- ✅ **Always use `exportToExcel()` for data analysis** - auto-summary + filtering
- ✅ **Use `exportToPdf()` for operational detail** - compliance-ready styling
- ✅ **Use `exportToPptx()` for executive presentations** - narrative-first layout
- ✅ **Test with 100-1k-10k record datasets** - confirm performance
- ✅ **Color-code risk levels** - visual compliance scanning
- ✅ **Include date range in filename** - audit trail
- ✅ **Add company branding to all exports** - professional appearance
- ✅ **Validate data before export** - use `_parseNum()`, check for nulls
- ✅ **Provide fallback content for empty datasets** - no blank pages
- ✅ **Log export events** - analytics + troubleshooting
- ✅ **Use async/await** - non-blocking UI
- ✅ **Limit large exports to 5k-10k records** - memory safety
- ✅ **Test in all browsers** - Chrome, Firefox, Safari, Edge
- ✅ **Compress large PDFs** - use native viewer preview

---

## Resources & References

### Official Documentation
- **jsPDF:** https://github.com/parallax/jsPDF
- **jsPDF-AutoTable:** https://github.com/simonbengtsson/jsPDF-AutoTable
- **XLSX (SheetJS):** https://docs.sheetjs.com
- **PptxGenJS:** https://gitbrent.github.io/PptxGenJS/

### TyrePulse Export Modules
- `src/lib/exportUtils.js` - all export functions + helpers
- `src/pages/Reports.jsx` - custom report builder
- `src/components/EmailReportModal.jsx` - scheduled delivery
- `src/lib/formatters.js` - currency + date formatting

### Related Guides
- [Data Import Guide](./DATA_IMPORT_GUIDE.md)
- [Security & RLS Policies](../BACKEND_RLS.sql)
- [Database Schema](../SUPABASE_SCHEMA.sql)

---

**Document Version:** 2.0.0  
**Last Updated:** 2026-07-02  
**Maintained By:** TyrePulse Development Team  
**License:** Internal Use Only
