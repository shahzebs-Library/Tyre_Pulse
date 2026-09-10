import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } })
  const pending = new Set()
  page.on('request', request => pending.add(request.url()))
  page.on('requestfinished', request => pending.delete(request.url()))
  page.on('requestfailed', request => pending.delete(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(120000)
  const js = body => ({ contentType: 'application/javascript', body })
  await page.route(/^http:\/\/127\.0\.0\.1:5182\/(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: `<html><head><title>Approval Matrix fixture</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/audit/approval-matrix-entry.jsx"></script></body></html>` }))
  await page.route('**/src/main.jsx*', route => route.fulfill(js("import '/audit/approval-matrix-entry.jsx';")))
  await page.route('**/src/contexts/AuthContext*', route => route.fulfill(js("export const useAuth=()=>({profile:{id:'publisher',org_id:'test-org',role:'Admin'}});")))
  await page.route('**/src/contexts/SettingsContext*', route => route.fulfill(js("export const useSettings=()=>({activeCountry:'KSA'}); export const COUNTRIES=['KSA','UAE'];")))
  await page.route('**/src/contexts/LanguageContext*', route => route.fulfill(js("export const useLanguage=()=>({language:new URLSearchParams(location.search).get('language')||'en',isRTL:location.search.includes('ar'),t:k=>k});")))
  await page.route('**/src/lib/api/sites*', route => route.fulfill(js("export const listSites=async()=>[{id:'test-site',name:'Test site',country:'KSA'}];")))
  await page.route('**/src/lib/api/approvalMatrix*', route => route.fulfill(js(`
    const policies=[];
    export const listApprovalPolicies=async()=>policies;
    export const listApprovalPeople=async()=>[{id:'reviewer',full_name:'Test reviewer',role:'PMV Manager',countries:['KSA'],sites:['Test site']}];
    export const listApprovalRoles=async()=>['Admin','PMV Manager'];
    export const saveApprovalPolicy=async policy=>{const row={...policy,id:'test-policy',state:'draft',version:1,created_by:'author',updated_at:new Date().toISOString()};policies.push(row);return row;};
    export const publishApprovalPolicy=async p=>({...p,state:'published',updated_at:new Date().toISOString()});
    export const retireApprovalPolicy=async p=>({...p,state:'retired',updated_at:new Date().toISOString()});
    export const simulateApprovalPolicy=async()=>({mode:'legacy',status:'no_route',policy:null,candidates:[]});
    export const listApprovalPolicyEvents=async()=>[];
  `)))
  try { await page.goto('http://127.0.0.1:5182/', { waitUntil: 'domcontentloaded', timeout: 120000 }) } catch (error) { console.log(JSON.stringify({ errors, pending: [...pending] })); throw error }
  await page.getByRole('button', { name: 'New policy', exact: true }).click()
  await page.getByLabel('Policy name', { exact: true }).fill('Test site safety review')
  await page.getByLabel('Stage name', { exact: true }).fill('Supervisor review')
  await page.getByLabel('Reviewer role', { exact: true }).selectOption('PMV Manager')
  await page.getByLabel('Change reason', { exact: true }).fill('Isolated browser verification')
  await page.screenshot({ path: 'audit/approval-matrix-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'audit/approval-matrix-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('Draft saved. Review and simulate before publishing.').waitFor()
  await page.goto('http://127.0.0.1:5182/?language=ar', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByRole('heading', { name: 'مصفوفة الموافقات' }).waitFor()
  await page.screenshot({ path: 'audit/approval-matrix-arabic.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  console.log(JSON.stringify({ title: await page.title(), errors }))
  assert.deepEqual(errors, [])
} finally {
  console.log(JSON.stringify({ errors }))
  await browser.close()
}
