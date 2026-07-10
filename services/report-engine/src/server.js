// ─────────────────────────────────────────────────────────────────────────────
// server.js — Express app exposing the report engine.
//
//   GET  /health          liveness probe
//   POST /reports/pdf     ReportDefinition JSON → application/pdf
//
// Optional hardening via env:
//   REPORT_API_KEY     when set, requests must send X-Report-Key: <key>
//   ALLOWED_ORIGIN     CORS allow-list (comma-separated); '*' by default
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { parseReportDefinition } from './reportSchema.js'
import { renderPdf } from './renderer.js'

export function createServer() {
  const app = express()
  app.use(express.json({ limit: process.env.REPORT_BODY_LIMIT || '12mb' }))

  // CORS
  const allowed = (process.env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*')
    else if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Report-Key')
    res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // Optional API-key gate
  app.use((req, res, next) => {
    const key = process.env.REPORT_API_KEY
    if (!key || req.path === '/health') return next()
    if (req.headers['x-report-key'] === key) return next()
    return res.status(401).json({ error: 'unauthorized' })
  })

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'report-engine' }))

  app.post('/reports/pdf', async (req, res) => {
    let def
    try {
      def = parseReportDefinition(req.body)
    } catch (err) {
      return res.status(400).json({ error: 'invalid report definition', details: err.errors || String(err) })
    }
    try {
      const pdf = await renderPdf(def)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${sanitize(def.fileName)}.pdf"`)
      return res.send(pdf)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('render failed', err)
      return res.status(500).json({ error: 'render failed' })
    }
  })

  return app
}

function sanitize(name) {
  return String(name || 'report').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80) || 'report'
}
