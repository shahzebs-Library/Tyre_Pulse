// ─────────────────────────────────────────────────────────────────────────────
// server.js — Express app exposing the report engine.
//
//   GET  /health          liveness probe
//   POST /reports/pdf     ReportDefinition JSON → application/pdf
//
// Security hardening via env:
//   REPORT_API_KEY     required in production; requests must send X-Report-Key.
//                      If unset in production, all non-/health routes return 503
//                      (fail closed) rather than serving unauthenticated.
//   ALLOWED_ORIGIN     CORS allow-list (comma-separated). No wildcard default —
//                      when unset the service is same-origin only (no
//                      Access-Control-Allow-Origin header is sent).
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { parseReportDefinition } from './reportSchema.js'
import { renderPdf } from './renderer.js'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

export function createServer() {
  const app = express()
  app.use(express.json({ limit: process.env.REPORT_BODY_LIMIT || '12mb' }))

  // CORS — explicit allow-list only. When ALLOWED_ORIGIN is unset we send no
  // Access-Control-Allow-Origin header at all (same-origin only); we never fall
  // back to a '*' wildcard.
  const allowed = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Report-Key')
    res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // API-key gate — FAIL CLOSED. /health is always open.
  //  • Key set   → require a matching X-Report-Key header.
  //  • Key unset + production → 503 for every non-/health route (never serve
  //    unauthenticated in production).
  //  • Key unset + non-production → allow (local development convenience).
  app.use((req, res, next) => {
    if (req.path === '/health') return next()
    const key = process.env.REPORT_API_KEY
    if (!key) {
      if (IS_PRODUCTION) {
        return res.status(503).json({ error: 'service unavailable: REPORT_API_KEY not configured' })
      }
      return next()
    }
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
