// ─────────────────────────────────────────────────────────────────────────────
// reportSchema.js — the report-definition contract.
//
// This is the SAME payload the client engine (src/lib/report/*) builds from the
// live table state. Keeping one schema means the server reproduces exactly what
// the user saw on screen — same columns, order, rows, KPIs and charts — with no
// re-query. Validated with zod so malformed requests fail fast with clear errors.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const reportColumn = z.object({
  key: z.string().min(1),
  header: z.string().default(''),
  align: z.enum(['left', 'center', 'right']).optional(),
})

export const reportKpi = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  sub: z.string().optional(),
})

export const reportChart = z.object({
  title: z.string().optional(),
  // PNG data URL captured from the on-screen ECharts/Chart.js canvas.
  image: z.string().regex(/^data:image\/(png|jpeg);base64,/, 'chart.image must be a PNG/JPEG data URL'),
})

export const reportBranding = z.object({
  primary_color: z.string().optional(),
  accent_color: z.string().optional(),
  logo_url: z.string().url().optional(),
  logo_data: z.string().optional(), // data URL alternative to a fetchable URL
  footer_text: z.string().optional(),
}).partial()

export const reportDefinitionSchema = z.object({
  reportType: z.string().default('table'),
  title: z.string().default('Report'),
  company: z.string().default(''),
  locale: z.enum(['en', 'ar']).default('en'),
  currency: z.string().default('SAR'),
  dateRange: z.string().optional(),
  exportMode: z.enum(['current', 'filtered', 'selected']).default('filtered'),
  // Human-readable snapshot of the active filters/search/sort ({label: value}).
  filtersSummary: z.record(z.string()).optional(),
  columns: z.array(reportColumn).min(1),
  rows: z.array(z.record(cellValue)).default([]),
  kpis: z.array(reportKpi).optional(),
  charts: z.array(reportChart).optional(),
  branding: reportBranding.optional(),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fileName: z.string().default('report'),
})

/** @typedef {z.infer<typeof reportDefinitionSchema>} ReportDefinition */

export function parseReportDefinition(input) {
  return reportDefinitionSchema.parse(input)
}
