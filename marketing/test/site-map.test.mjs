import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Load a dependency-free TypeScript module from lib/ by transpiling it in place. */
function load(path, deps = {}) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'exports', 'process', js)((name) => deps[name] ?? require(name), mod.exports, { env: {} });
  return mod.exports;
}

const nav = load('lib/nav.ts');
const sitemapPaths = [...read('app/sitemap.ts').matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
const pagePaths = sitemapPaths.filter((p) => !p.endsWith('.txt'));

test('every route in the navigation is in the sitemap, and the other way round', () => {
  assert.deepEqual([...pagePaths].sort(), [...nav.ALL_ROUTES].sort());
});

test('every listed route has a page file', () => {
  for (const route of nav.ALL_ROUTES) {
    const file = route === '/' ? 'app/page.tsx' : `app${route}/page.tsx`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${route} has no ${file}`);
  }
});

test('every menu link points at a listed route', () => {
  for (const group of nav.MENU_GROUPS) {
    for (const item of group.items) {
      assert.ok(nav.ALL_ROUTES.includes(item.href.split('#')[0]), `${item.href} is not a listed route`);
    }
  }
});

test('llms.txt names every page route', () => {
  const llms = read('app/llms.txt/route.ts');
  for (const route of nav.ALL_ROUTES) {
    if (route === '/') continue;
    assert.ok(llms.includes(`\${SITE_URL}${route})`), `llms.txt does not list ${route}`);
  }
});

test('the app host is defined once and is the host that serves the app', () => {
  const site = load('lib/site.ts');
  assert.equal(site.APP_URL, 'https://app.tyrepulse.app');
  assert.equal(site.SITE_URL, 'https://www.tyrepulse.app');
  for (const link of site.LEGAL_LINKS) assert.ok(link.href.startsWith(`${site.APP_URL}/`));
  for (const file of ['components/Header.tsx', 'components/Footer.tsx', 'next.config.ts', 'app/schema.tsx']) {
    assert.doesNotMatch(read(file), /https:\/\/(app|www)\.tyrepulse\.app/, `${file} hardcodes a host`);
  }
});

test('iOS is stated one way: planned, with no App Store link', () => {
  const site = load('lib/site.ts');
  assert.equal(site.IOS_STATUS, 'planned');
  assert.match(read('app/schema.tsx'), /APP_STORE_URL: string \| null = null/);
  assert.doesNotMatch(read('components/StoreBadges.tsx') + read('components/Footer.tsx'), /apps\.apple\.com/);
  for (const file of ['app/llms.txt/route.ts', 'app/llms-full.txt/route.ts', 'app/schema.tsx', 'components/Footer.tsx', 'app/about/page.tsx']) {
    assert.match(read(file), /IOS_STATEMENT/, `${file} does not use the shared iOS statement`);
  }
});

test('marketing copy carries no em or en dashes', () => {
  for (const file of ['app/page.tsx', 'app/about/page.tsx', 'app/faq/page.tsx', 'app/security/page.tsx', 'app/platform/tyre-lifecycle/page.tsx', 'app/platform/reports/page.tsx', 'app/industries/page.tsx', 'lib/faqs.ts', 'lib/nav.ts', 'lib/roles.ts', 'components/product/ProductStory.tsx', 'components/product/StoryScreens.tsx', 'components/product/ProductScene.tsx']) {
    assert.doesNotMatch(read(file), /[–—]/, `${file} contains a dash`);
  }
});
