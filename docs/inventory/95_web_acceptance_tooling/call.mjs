// node call.mjs <user|anon> <METHOD> <path> [jsonBody]  -> prints status + body (direct PostgREST calls through the proxy)
import { ANON, session } from './jwt.mjs'
const [who, method, path, body] = process.argv.slice(2)
const tok = who === 'anon' ? ANON : session(who).access_token
const r = await fetch('http://127.0.0.1:54321/rest/v1' + path, {
  method, headers: { apikey: ANON, authorization: 'Bearer ' + tok, 'content-type': 'application/json', prefer: 'return=representation' },
  body: body || undefined,
})
console.log(r.status, (await r.text()).slice(0, 600))
