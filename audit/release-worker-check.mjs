import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const asset=fs.readdirSync('dist').find(x=>x.startsWith('release-notes-'));
if(!fs.readFileSync('dist/sw.js','utf8').includes(asset)) throw new Error('Worker does not import release notes');
let phase=0;
const server=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/worker.js'){res.setHeader('Content-Type','application/javascript');res.end(phase?`importScripts('/${asset}');`:`self.addEventListener('message',e=>{if(e.ports[0]) e.ports[0].postMessage({buildId:'old'});});`);}
 else if(req.url===`/${asset}`){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join('dist',asset)));}
 else res.end('<!doctype html><title>Release worker verification</title>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/worker.js');await navigator.serviceWorker.ready;});
 await page.reload();
 if(!await page.evaluate(()=>!!navigator.serviceWorker.controller)) throw new Error('Initial page is not controlled');
 phase=1;
 const result=await page.evaluate(async()=>{
  const reg=await navigator.serviceWorker.getRegistration();await reg.update();
  const until=Date.now()+15000;while(!reg.waiting&&Date.now()<until) await new Promise(r=>setTimeout(r,100));
  if(!reg.waiting) throw new Error('No waiting update');
  return await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('No release response')),3000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};reg.waiting.postMessage({type:'TP_RELEASE_NOTES'},[channel.port2]);});
 });
 if(result.schema!==1||result.releases[0].id!=='2026.09.10.4') throw new Error('Incorrect waiting release');
 console.log('Real waiting service worker returned the exact built release notes; installed worker remained active.');
} finally {await browser.close();server.close();}
