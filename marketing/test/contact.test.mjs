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
const input = { name: 'Test User', email: 'test@example.invalid', company: 'Example', country: 'Saudi Arabia' };
const request = value => ({ json: async () => value });
const configured = { RESEND_API_KEY: 'test-only', CONTACT_TO_EMAIL: 'sales@example.invalid', CONTACT_FROM_EMAIL: 'site@example.invalid' };

test('unconfigured contact delivery returns unavailable without calling a provider', async () => {
  const post = handler({}, () => { throw new Error('must not send'); });
  assert.equal((await post(request(input))).status, 503);
});

test('contact validation rejects malformed and honeypot submissions before delivery', async () => {
  const post = handler(configured, () => { throw new Error('must not send'); });
  assert.equal((await post(request({ ...input, email: 'invalid' }))).status, 400);
  assert.equal((await post(request({ ...input, website: 'spam' }))).status, 400);
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
  assert.deepEqual(form.states, ['Accepted', false]);
});

test('contact form preserves input and exits sending state on network failure', async () => {
  const form = contactForm(async () => { throw new Error('offline'); });
  await form.submit({ preventDefault() {}, currentTarget: { reset() { throw new Error('must not reset'); } } });
  assert.deepEqual(form.states, ['Unable to send the request. Please try again.', false]);
});
