import fs from 'node:fs';
import {chromium} from 'playwright';
const images=JSON.parse(fs.readFileSync('audit/wash-pdf-review/extracted.json'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/src/main.jsx*',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await page.goto('http://127.0.0.1:5178/');
 const result=await page.evaluate(async images=>{
  const {exportVehicleWashPdf}=await import('/src/lib/washReportPdf.js');
  const row={id:'56069f71-b68c-4fce-a24e-f3ec12d85c99',asset_no:'TM335',country:'KSA',site:'AMAALA',vehicle_type:'TR-MIXER',wash_date:'2026-09-10',wash_time:'15:09',wash_type:'Full',status:'Completed',photos:['1','2','3']};
  const r=await exportVehicleWashPdf([row],{save:false,branding:{logo_url:images[0].data,footer_text:'confidinetial'},filters:{assetNo:'TM335'},loadPhoto:async ref=>images[Number(ref)]});
  return {pages:r.doc.internal.getNumberOfPages(),data:r.doc.output('datauristring').split(',')[1]};
 },images);
 fs.writeFileSync('audit/wash-pdf-review/TM335-improved.pdf',Buffer.from(result.data,'base64'));console.log('Generated PDF pages:',result.pages);
} finally {await browser.close();}
