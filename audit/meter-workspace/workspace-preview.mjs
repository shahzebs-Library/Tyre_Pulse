import { chromium } from 'playwright';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1365,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/main.jsx*',r=>r.fulfill({contentType:'application/javascript',body:"import '/audit/meter-workspace/workspace-entry.jsx';"}));
  await page.route('**/src/contexts/AuthContext*',r=>r.fulfill({contentType:'application/javascript',body:"const allowed=new Set(['vehicle_washing','fleet_master','odometer_logs','engine_hours']); const profile={id:'preview',role:'Fleet Supervisor'}; export const useAuth=()=>({profile,hasPermission:key=>allowed.has(key),moduleStatus:()=> 'live'});"}));
  await page.route('**/src/contexts/SettingsContext*',r=>r.fulfill({contentType:'application/javascript',body:"export const useSettings=()=>({activeCountry:'KSA'}); export const COUNTRIES=['KSA','UAE','Egypt'];"}));
  await page.route('**/src/lib/api/workspace*',r=>r.fulfill({contentType:'application/javascript',body:"export async function loadWorkspaceCount(){throw new Error('Dashboard is off: no queries allowed');}"}));
  await page.goto('http://127.0.0.1:5178/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'My Workspace'}).waitFor();
  await page.screenshot({path:'audit/meter-workspace/workspace-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'audit/meter-workspace/workspace-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(errors.length||overflow) throw new Error(JSON.stringify({errors,overflow}));
  console.log('Workspace desktop and mobile rendered; no page errors or horizontal overflow.');
} finally { await browser.close(); }
