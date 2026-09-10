import fs from 'node:fs';
import {createCanvas, DOMMatrix, ImageData, Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('C:/Users/Tyre_Engineer/Downloads/Vehicle Washing TM335 10 Sep 2026.pdf'))}).promise;
const page=await pdf.getPage(2), ops=await page.getOperatorList();const images=[];
for(let i=0;i<ops.fnArray.length;i++) if(ops.fnArray[i]===OPS.paintImageXObject) {
 const img=page.objs.get(ops.argsArray[i][0]);const c=createCanvas(img.width,img.height),ctx=c.getContext('2d');
 const rgba=new Uint8ClampedArray(img.width*img.height*4);
 for(let p=0;p<img.width*img.height;p++){rgba[p*4]=img.data[p*3];rgba[p*4+1]=img.data[p*3+1];rgba[p*4+2]=img.data[p*3+2];rgba[p*4+3]=255;}
 ctx.putImageData(new ImageData(rgba,img.width,img.height),0,0);
 images.push({data:c.toDataURL('image/png'),width:img.width,height:img.height});
}
fs.writeFileSync('audit/wash-pdf-review/extracted.json',JSON.stringify(images));console.log(images.map(i=>[i.width,i.height]));
