import { chromium } from 'playwright'
const base = 'http://127.0.0.1:5179'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => { errors.push(e.message); console.error('Browser:', e.message) })
const js = (route, body) => route.fulfill({contentType:'application/javascript',body})
await page.route('**/src/main.jsx*', r => js(r, "import '/audit/planner-visual-entry.jsx'"))
await page.route('**/src/contexts/SettingsContext*', r => js(r, "export const useSettings=()=>({activeCountry:'KSA',appSettings:{}})"))
await page.route('**/src/contexts/AuthContext*', r => js(r, "export const useAuth=()=>({profile:{id:'test',role:'Admin'},loading:false,hasPermission:()=>true,hasCapability:()=>true,moduleStatus:()=> 'live'})"))
await page.route('**/src/contexts/TenantContext*', r => js(r, "export const useTenant=()=>({orgId:'test',branding:null})"))
await page.route('**/src/contexts/LanguageContext*', r => js(r, "export const useLanguage=()=>({language:new URLSearchParams(location.search).get('lang')==='ar'?'ar':'en',isRTL:new URLSearchParams(location.search).get('lang')==='ar',t:k=>k})"))
await page.route('**/src/hooks/useFeatureFlags*', r => js(r, 'export const useFeatureGate=()=>true'))
await page.route('**/src/hooks/useEntityWorkflow*', r => js(r, 'export const useEntityWorkflow=()=>({loading:false,error:null,isActive:false,isLocked:false})'))
await page.route('**/src/components/workflow/EntityApprovalPanel*', r => js(r, 'export default function Panel(){return null}'))
await page.route('**/src/lib/api/inspectionPlanner*', r => js(r, `
 const today=new Date().toISOString().slice(0,10);
 export const loadPlannerData=async()=>({inspections:[{id:'fixture',asset_no:'TEST-001',inspection_date:'2026-01-01',inspector_name:'Test Inspector',country:'KSA',site:'Test site'}],tyreRecords:[{id:'fixture2',asset_no:'TEST-002',country:'KSA',site:'Test site',risk_level:'Low'}],schedule:[{id:'fixture3',asset_no:'TEST-001',inspection_date:today,inspection_time:'08:00',inspector_name:'Test Inspector',country:'KSA',site:'Test site',status:'Scheduled'}],dataError:null,scheduleError:null,truncated:false});
 export const savePlannerSchedules=async()=>{throw new Error('Fixture preview does not save')};
 export const updateScheduleStatus=savePlannerSchedules;export const deletePlannerSchedule=savePlannerSchedules;
 `))
try {
 for (const [name,width,lang] of [['desktop',1440,'en'],['mobile',390,'en'],['arabic',1440,'ar']]) {
  await page.setViewportSize({width,height:1000})
  await page.goto(`${base}/?lang=${lang}`,{waitUntil:'domcontentloaded',timeout:90000})
  await page.getByText('TEST-001',{exact:true}).first().waitFor()
  await page.screenshot({path:`audit/planner-${name}.png`,fullPage:true})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
  if(overflow) throw new Error(`${name} page overflows horizontally`)
  if(lang==='en') {
   for(const tab of ['Agenda','Inspectors','Analytics']) {
    await page.getByRole('button',{name:tab,exact:true}).click()
    await page.screenshot({path:`audit/planner-${name}-${tab.toLowerCase()}.png`,fullPage:true})
   }
   await page.getByRole('button',{name:/Schedule inspection/i}).click()
   await page.getByRole('dialog').waitFor()
   await page.screenshot({path:`audit/planner-${name}-dialog.png`,fullPage:true})
   await page.keyboard.press('Escape')
   await page.getByRole('dialog').waitFor({state:'hidden'})
  }
  console.log(`PASS ${name} layout and navigation`)
 }
 if(errors.length) throw new Error(errors.join('\n'))
} catch(error) {
 await page.screenshot({path:'audit/planner-visual-failure.png',fullPage:true}).catch(()=>{})
 console.error((await page.locator('body').innerText().catch(()=>'' )).slice(0,1200))
 throw error
} finally {await browser.close()}
