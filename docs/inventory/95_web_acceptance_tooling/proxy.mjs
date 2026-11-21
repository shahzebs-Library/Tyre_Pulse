// Local acceptance stack: serves PostgREST under /rest/v1 and a GoTrue stub under /auth/v1.
import http from 'node:http'
import { decode, userObj, session, USERS } from './jwt.mjs'
const cors = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-expose-headers': 'content-range,content-profile,content-location,range-unit,preference-applied',
}
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const u = new URL(req.url, 'http://x')
  if (u.pathname.startsWith('/rest/v1')) {
    const headers = { ...req.headers, host: '127.0.0.1:3300' }
    const path = req.url.replace(/^\/rest\/v1/, '') || '/'
    const p = http.request({ host: '127.0.0.1', port: 3300, path, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res)
    })
    p.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)) })
    return req.pipe(p)
  }
  if (u.pathname.startsWith('/auth/v1')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const tok = (req.headers.authorization || '').replace(/^Bearer /i, '')
      const c = decode(tok)
      const j = (s, o) => { res.writeHead(s, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)) }
      if (u.pathname.endsWith('/user')) return c?.sub ? j(200, userObj(c.sub, c.email)) : j(401, { msg: 'no session' })
      if (u.pathname.endsWith('/token')) {
        try {
          const b = JSON.parse(body || '{}'); const name = String(b.refresh_token || '').slice(3)
          if (USERS[name]) return j(200, session(name))
        } catch { /* fall through */ }
        return j(400, { error: 'invalid_grant', error_description: 'local stub: password sign-in not supported' })
      }
      if (u.pathname.endsWith('/logout')) { res.writeHead(204, cors); return res.end() }
      if (u.pathname.endsWith('/factors')) return j(200, [])
      return j(200, {})
    })
    return
  }
  res.writeHead(404, cors); res.end('not available in local acceptance stack: ' + u.pathname)
}).listen(54321, '127.0.0.1', () => console.log('proxy on 54321'))
