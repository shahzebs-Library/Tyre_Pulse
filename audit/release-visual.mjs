import {chromium} from 'playwright';
const entry=await (await fetch('http://127.0.0.1:5178/audit/meter-workspace/release-entry.jsx')).text();
const reactPath=entry.match(/\/node_modules\/\.vite\/deps\/react\.js[^"]*/)[0];
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1365,height:950}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/main.jsx*',r=>r.fulfill({contentType:'application/javascript',body:"import '/audit/meter-workspace/release-entry.jsx';"}));
 await page.route('**/src/contexts/AuthContext*',r=>r.fulfill({contentType:'application/javascript',body:"export const useAuth=()=>({profile:{id:'preview',role:'Fleet Supervisor'},hasPermission:key=>key==='vehicle_washing',moduleStatus:()=> 'live'});"}));
 await page.route(/virtual:pwa-register/,r=>r.fulfill({contentType:'application/javascript',body:`import React from '${reactPath}'; const {useEffect,useState}=React; const waiting={postMessage:(message,ports)=>ports[0].postMessage({schema:1,buildId:'preview-next',releases:[{id:'Preview next release',date:'2026-09-10',changes:[{modules:['vehicle_washing'],text:{en:'Washing PDFs show larger photos and clearer vehicle details.',ar:'تعرض تقارير الغسيل صوراً أكبر وتفاصيل أوضح للمركبة.'}}]}]})}; export function useRegisterSW(options){const [refresh,setRefresh]=useState(true);useEffect(()=>options.onRegisteredSW('/preview-worker.js',{waiting,update:()=>Promise.resolve()}),[]);return {needRefresh:[refresh,setRefresh],offlineReady:[false,()=>{}],updateServiceWorker:()=>Promise.resolve()}}` }));
 await page.goto('http://127.0.0.1:5178/',{waitUntil:'domcontentloaded'});
 console.log('errors',errors); console.log((await page.locator('body').innerText()).slice(0,2000)); await page.screenshot({path:'audit/release-debug.png'}); await page.getByText('Washing PDFs show larger photos and clearer vehicle details.').waitFor({timeout:5000});
 await page.screenshot({path:'audit/release-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'audit/release-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(errors.length||overflow) throw new Error(JSON.stringify({errors,overflow}));
 await page.evaluate(()=>localStorage.setItem('tp_language','ar')); await page.reload({waitUntil:'domcontentloaded'}); await page.getByText('سجل التحديثات',{exact:true}).first().waitFor(); await page.screenshot({path:'audit/release-arabic.png',fullPage:true}); console.log('English desktop/mobile and Arabic history and update notice verified.');
} finally {await browser.close();}
