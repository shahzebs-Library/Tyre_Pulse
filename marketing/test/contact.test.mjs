import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL('../app/api/contact/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function handler(env, fetch) {
  const compiledModule = { exports: {} };
  const dependencies = name => name === 'next/server'
    ? { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } }
    : require(name);
  new Function('require', 'exports', 'process', 'fetch', source)(dependencies, compiledModule.exports, { env }, fetch);
  return compiledModule.exports.POST;
}
const input = { name: 'Test User', email: 'test@example.invalid', company: 'Example', country: 'Saudi Arabia', fleetSize: '26 to 100 assets' };
const request = value => ({ json: async () => value });
const configured = { RESEND_API_KEY: 'test-only', CONTACT_TO_EMAIL: 'sales@example.invalid', CONTACT_FROM_EMAIL: 'site@example.invalid' };

test('unconfigured contact delivery returns unavailable without calling a provider', async () => {
  const post = handler({}, () => { throw new Error('must not send'); });
  assert.equal((await post(request(input))).status, 503);
});

test('contact validation rejects malformed and honeypot submissions before delivery', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  assert.equal((await post(request({ ...input, email: 'invalid' }))).status, 400);
  const trap = await post(request({ ...input, website: 'spam' }));
  assert.equal(trap.status, 200, 'a honeypot hit looks like success to the bot');
});

test('oversized bodies are refused before they are read', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  const res = await post({ headers: new Map([['content-length', String(64 * 1024)]]), json: async () => { throw new Error('must not read'); } });
  assert.equal(res.status, 413);
});

test('line breaks in single-line fields cannot forge extra email lines', async () => {
  const post = handler(configured, async (_url, options) => {
    const text = JSON.parse(options.body).text;
    assert.ok(text.includes('Company: Example Fleet: 1'));
    assert.equal(text.split('\n').filter(l => l.startsWith('Fleet size:')).length, 1);
    return { ok: true, json: async () => ({ id: 'mock-delivery-id' }) };
  });
  assert.equal((await post(request({ ...input, company: 'Example\nFleet: 1' }))).status, 200);
});

test('malformed JSON is a client error and never attempts delivery', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  assert.equal((await post({ json: async () => { throw new SyntaxError('invalid JSON'); } })).status, 400);
});

test('email whitespace is normalized before validation and delivery', async () => {
  const post = handler(configured, async (_url, options) => {
    assert.equal(JSON.parse(options.body).reply_to, input.email);
    return { ok: true, json: async () => ({ id: 'mock-delivery-id' }) };
  });
  assert.equal((await post(request({ ...input, email: ` ${input.email} ` }))).status, 200);
});

test('success requires provider acceptance and uses configured sender and recipient', async () => {
  let calls = 0;
  const post = handler(configured, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(options.body);
    assert.equal(body.from, configured.CONTACT_FROM_EMAIL);
    assert.deepEqual(body.to, [configured.CONTACT_TO_EMAIL]);
    assert.equal(body.reply_to, input.email);
    assert.ok(body.text.includes(input.company));
    return { ok: true, json: async () => ({ id: 'mock-delivery-id' }) };
  });
  assert.equal((await post(request(input))).status, 200);
  assert.equal(calls, 1);
});

test('provider rejection, missing receipt and network failures never report success', async () => {
  for (const response of [{ ok: false, json: async () => ({ message: 'rejected' }) }, { ok: true, json: async () => ({}) }]) {
    assert.equal((await handler(configured, async () => response)(request(input))).status, 502);
  }
  assert.equal((await handler(configured, async () => { throw new Error('network'); })(request(input))).status, 500);
});

const pageSource = ts.transpileModule(readFileSync(new URL('../app/contact/page.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function contactForm(fetch) {
  const states = [];
  const compiledModule = { exports: {} };
  const dependencies = name => {
    if (name === 'react') return { useState: initial => {
      const index = states.push(initial) - 1;
      return [initial, value => { states[index] = value; }];
    } };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === '@/components/PageFrame') return { PageFrame: 'main' };
    if (name === '@/components/PageTop') return { PageTop: 'header' };
    if (name === '@/lib/site') return { WHATSAPP_URL: null, CONTACT_EMAIL: 'info@tyrepulse.app' };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  class FormDataStub { entries() { return Object.entries(input); } }
  new Function('require', 'exports', 'fetch', 'FormData', pageSource)(dependencies, compiledModule.exports, fetch, FormDataStub);
  function findForm(element) {
    if (element?.type === 'form') return element;
    const children = element?.props?.children;
    return (Array.isArray(children) ? children : [children]).filter(Boolean).map(findForm).find(Boolean);
  }
  return { submit: findForm(compiledModule.exports.default()).props.onSubmit, states };
}

test('contact form resets the captured form after React clears currentTarget', async () => {
  let resets = 0;
  const event = { preventDefault() {}, currentTarget: { reset: () => { resets++; } } };
  const form = contactForm(async () => {
    event.currentTarget = null;
    return { ok: true, json: async () => ({ message: 'Accepted' }) };
  });
  await form.submit(event);
  assert.equal(resets, 1);
  assert.deepEqual(form.states, ['Accepted', 'ok', false, [], null]);
});

test('contact form preserves input and exits sending state on network failure', async () => {
  const form = contactForm(async () => { throw new Error('offline'); });
  await form.submit({ preventDefault() {}, currentTarget: { reset() { throw new Error('must not reset'); } } });
  assert.deepEqual(form.states.slice(0, 4), ['Unable to send the request. Send the same details in one tap instead:', 'error', false, []]);
  // The request is never lost: an email fallback carrying the details is offered.
  assert.equal(form.states[4].wa, null);
  assert.match(form.states[4].mail, /^mailto:info@tyrepulse\.app\?subject=/);
});

test('contact form marks and focuses the fields the server rejected', async () => {
  let focused = '';
  const form = contactForm(async () => ({ ok: false, json: async () => ({ message: 'Please check', fields: ['email', 'company'] }) }));
  await form.submit({ preventDefault() {}, currentTarget: { reset() { throw new Error('must not reset'); }, elements: { namedItem: n => ({ focus: () => { focused = n; } }) } } });
  assert.deepEqual(form.states[3], ['email', 'company']);
  assert.equal(focused, 'email');
});

const withHeaders = (value, headers) => ({ json: async () => value, headers: new Headers(headers) });

test('a cross-site browser post is refused before delivery', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  const res = await post(withHeaders(input, { origin: 'https://evil.example', host: 'tyrepulse.app' }));
  assert.equal(res.status, 403);
});

test('one client is throttled after five requests in the window', async () => {
  const post = handler({}, () => { throw new Error('must not send'); });
  const req = () => withHeaders(input, { 'x-forwarded-for': '203.0.113.9' });
  for (let i = 0; i < 5; i++) assert.equal((await post(req())).status, 503);
  assert.equal((await post(req())).status, 429);
});

test('fleet size is required server-side', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  const rest = { ...input }; delete rest.fleetSize;
  assert.equal((await post(request(rest))).status, 400);
});

const req = (value, headers = {}) => ({ headers: new Map(Object.entries(headers)), json: async () => value, text: async () => JSON.stringify(value) });

test('cross-site browser requests are refused by Fetch Metadata', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  assert.equal((await post(req(input, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await post(req(input, { origin: 'https://evil.example', host: 'tyrepulse.app' }))).status, 403);
});

test('non-JSON content types are refused (blocks HTML form CSRF)', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  assert.equal((await post(req(input, { 'content-type': 'text/plain' }))).status, 415);
});

test('body cap holds without a Content-Length header', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  const big = { ...input, message: 'x'.repeat(20000) };
  assert.equal((await post(req(big, { 'content-type': 'application/json' }))).status, 413);
});

test('validation errors name the fields but never echo values', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  const res = await post(req({ ...input, email: 'bad<script>', company: 'x' }));
  assert.equal(res.status, 400);
  assert.deepEqual([...res.body.fields].sort(), ['company', 'email']);
  assert.ok(!JSON.stringify(res.body).includes('<script>'));
});

test('rate limit keys on the platform IP and ignores invalid attempts', async () => {
  const post = handler(configured, async () => ({ ok: true, json: async () => ({ id: 'id' }) }));
  for (let i = 0; i < 8; i++) await post(req({ ...input, email: 'bad' }, { 'x-real-ip': '9.9.9.9' }));
  for (let i = 0; i < 5; i++) assert.equal((await post(req(input, { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': `1.1.1.${i}` }))).status, 200);
  assert.equal((await post(req(input, { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '2.2.2.2' }))).status, 429);
});

test('a chunked stream is cut off at the cap, not buffered whole', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(4096).fill(120);
  const body = new ReadableStream({
    pull(controller) { pulled += 1; if (pulled > 1000) controller.close(); else controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  const res = await post({ headers: new Map([['content-type', 'application/json']]), body, text: async () => { throw new Error('must not buffer'); } });
  assert.equal(res.status, 413);
  assert.ok(cancelled, 'stream is cancelled once over the cap');
  assert.ok(pulled <= 6, `read stopped early (pulled ${pulled} chunks)`);
});
