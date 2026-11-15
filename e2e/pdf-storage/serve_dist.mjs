// Serves the production build with single-page-app fallback. Test harness only.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root = process.env.E2E_DIST
const port = Number(process.env.WEB_PORT || 5199)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' }
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(root, path.normalize(p))
  if (!file.startsWith(root)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404); return res.end() }
    file = path.join(root, 'index.html')
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`web on http://127.0.0.1:${port}`))
