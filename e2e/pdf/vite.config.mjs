// Vite config for the PDF timing harness. It bundles the REAL generators, renderer hook,
// cache service and diagram components, and swaps only src/lib/supabase.js for an
// in-memory stand-in (e2e/pdf/fakeSupabase.js). Nothing here can reach a real project.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const out = process.env.PDF_HARNESS_OUT
if (!out) throw new Error('Set PDF_HARNESS_OUT to a folder outside the repository')
const realSupabase = path.join(root, 'src/lib/supabase.js')
const photos = path.join(out, 'photos')

const swapSupabase = {
  name: 'pdf-harness-fake-supabase',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !/supabase(\.js)?$/.test(source)) return null
    const r = await this.resolve(source, importer, { ...options, skipSelf: true })
    return r && r.id.split('?')[0] === realSupabase ? path.join(here, 'fakeSupabase.js') : null
  },
}
const servePhotos = {
  name: 'pdf-harness-photos',
  configurePreviewServer(server) {
    server.middlewares.use('/photos', (req, res, next) => {
      const f = path.join(photos, path.basename(decodeURIComponent(req.url.split('?')[0])))
      if (!fs.existsSync(f)) return next()
      res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'no-store')
      fs.createReadStream(f).pipe(res)
    })
  },
}

export default defineConfig({
  root: here,
  publicDir: path.join(root, 'public'),
  plugins: [swapSupabase, react(), servePhotos],
  css: { postcss: root },
  build: { outDir: path.join(out, 'dist'), emptyOutDir: true, copyPublicDir: false, chunkSizeWarningLimit: 5000 },
  preview: { port: Number(process.env.PDF_HARNESS_PORT || 5197), host: '127.0.0.1', strictPort: true },
})
