import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the public contact URL offers existing customers a sign-in-free support contact', () => {
  const page = readFileSync(new URL('../app/contact/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /Already using Tyre Pulse\?/);
  assert.match(page, /without signing in/);
  assert.match(page, /Contact customer support/);
  assert.match(page, /mailto:\$\{CONTACT_EMAIL\}/);
});
