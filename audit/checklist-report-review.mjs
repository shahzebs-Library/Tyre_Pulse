import fs from 'node:fs';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
fs.mkdirSync('audit/checklist-report-review',{recursive:true});
for(const [tag,name] of [['inspection','Inspection Daily Tyre Inspection AMAALA 2026 09.pdf'],['fleet','Fleet Transit Mixer Checklist FTM-BH006-2026-0001 2026-08-19.pdf'],['workshop','Workshop Daily Checklist WDC-TM660-2026-0001 2026-08-19.pdf']]) {
 const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('C:/Users/Tyre_Engineer/Downloads/'+name)),standardFontDataUrl:process.cwd().replaceAll('\\','/')+'/node_modules/pdfjs-dist/standard_fonts/'}).promise;
 let text='PAGES: '+pdf.numPages+'\n';
 for(let n=1;n<=pdf.numPages;n++) {const p=await pdf.getPage(n);const tc=await p.getTextContent();text+='\nPAGE '+n+'\n'+tc.items.map(x=>x.str).join(' | ')+'\n';const v=p.getViewport({scale:1.25});const c=createCanvas(Math.ceil(v.width),Math.ceil(v.height));await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;fs.writeFileSync(`audit/checklist-report-review/${tag}-${n}.png`,c.toBuffer('image/png'));}
 fs.writeFileSync(`audit/checklist-report-review/${tag}.txt`,text);console.log(tag,text);
}
