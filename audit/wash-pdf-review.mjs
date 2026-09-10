import fs from 'node:fs';
import {createCanvas, DOMMatrix, ImageData, Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
fs.mkdirSync('audit/wash-pdf-review',{recursive:true});
for(const [tag,name] of [['all','Vehicle Washing Log 10 Sep 2026 (1).pdf'],['vehicle','Vehicle Washing TM335 10 Sep 2026.pdf']]) {
 const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('C:/Users/Tyre_Engineer/Downloads/'+name)),useSystemFonts:false,standardFontDataUrl:process.cwd().replaceAll("\\","/")+"/node_modules/pdfjs-dist/standard_fonts/"}).promise;
 console.log(tag,'PAGES',pdf.numPages);
 for(let n=1;n<=pdf.numPages;n++) {
  const p=await pdf.getPage(n); const tc=await p.getTextContent();
  console.log('PAGE',n,tc.items.map(x=>x.str).join(' | '));
  const v=p.getViewport({scale:1.4});const c=createCanvas(Math.ceil(v.width),Math.ceil(v.height));
  await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
  fs.writeFileSync(`audit/wash-pdf-review/${tag}-${n}.png`,c.toBuffer('image/png'));
 }
}
