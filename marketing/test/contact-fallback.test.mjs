import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../lib/contactFallback.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', js)(mod.exports);
const { buildFallbackLinks, contactSummary, fallbackMessage, shouldOfferFallback } = mod.exports;

const fields = { name: 'Test User', email: 'test@example.invalid', phone: '', company: 'Example & Sons', country: 'Saudi Arabia', fleetSize: '26 to 100 assets', industry: '', message: 'Tyre cost?\nSecond line' };

test('the fallback is offered when delivery is down, rate limited or unreachable', () => {
  for (const status of [500, 502, 503, 429, null]) assert.equal(shouldOfferFallback(status), true, String(status));
  for (const status of [200, 400, 403, 413, 415]) assert.equal(shouldOfferFallback(status), false, String(status));
});

test('a rate limit gets its own message, and every outcome points at the alternative', () => {
  assert.match(fallbackMessage(429), /paused for a few minutes/);
  assert.notEqual(fallbackMessage(429), fallbackMessage(503));
  for (const status of [429, 503, null]) assert.match(fallbackMessage(status), /Send the same details in one tap instead:$/);
});

test('the WhatsApp link carries exactly one text parameter with the whole request', () => {
  const summary = contactSummary(fields);
  const { wa } = buildFallbackLinks(summary, { whatsappNumber: '+971 56 672 6276', email: 'info@example.invalid' });
  const url = new URL(wa);
  assert.equal(url.origin + url.pathname, 'https://wa.me/971566726276');
  assert.equal(wa.split('?text=').length, 2, 'one ?text= only');
  assert.equal([...url.searchParams.keys()].join(','), 'text');
  assert.equal(url.searchParams.get('text'), summary);
});

test('the email link is prefilled and the summary omits empty optional lines', () => {
  const summary = contactSummary(fields);
  assert.ok(!summary.includes('Phone:'));
  assert.ok(!summary.includes('Industry:'));
  assert.ok(summary.includes('Company: Example & Sons'));
  const { mail } = buildFallbackLinks(summary, { whatsappNumber: null, email: 'info@example.invalid' });
  assert.ok(mail.startsWith('mailto:info@example.invalid?subject='));
  assert.equal(decodeURIComponent(mail.split('&body=')[1]), summary);
});

test('no WhatsApp number means no WhatsApp link, and the email link still works', () => {
  const links = buildFallbackLinks('x', { whatsappNumber: null, email: 'info@example.invalid' });
  assert.equal(links.wa, null);
  assert.ok(links.mail.includes('mailto:'));
});

test('the contact page uses the shared fallback for 429 as well as 5xx', () => {
  const page = readFileSync(new URL('../app/contact/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /shouldOfferFallback\(res\.status\)/);
  assert.doesNotMatch(page, /WHATSAPP_URL\}\?text=/, 'never append a second ?text= to WHATSAPP_URL');
});
