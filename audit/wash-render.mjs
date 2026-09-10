import fs from 'node:fs';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('audit/wash-pdf-review/TM335-improved.pdf')),standardFontDataUrl:process.cwd().replaceAll('\\','/')+'/node_modules/pdfjs-dist/standard_fonts/'}).promise;
const p=await pdf.getPage(1),v=p.getViewport({scale:1.5}),c=createCanvas(Math.ceil(v.width),Math.ceil(v.height));
await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
fs.writeFileSync('audit/wash-pdf-review/improved.png',c.toBuffer('image/png'));
