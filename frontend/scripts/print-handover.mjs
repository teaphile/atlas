// Optional documentation tooling; does not contact providers or load external assets.
import {chromium} from '@playwright/test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const input=path.resolve(process.argv[2]||'../docs/HANDOVER.html');
const output=path.resolve(process.argv[3]||'../../ATLAS-2.0-engineering-report.pdf');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext();await context.route(/^https?:/,r=>r.abort());
 const page=await context.newPage();await page.goto(pathToFileURL(input).href,{waitUntil:'load'});await page.emulateMedia({media:'print'});
 await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-family:Arial;font-size:8px;color:#586b68;width:100%;padding:0 45px;display:flex;justify-content:space-between"><span>ATLAS 2.0 · Engineering handover · Research, not certification</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
 console.log(output);
}finally{await browser.close();}
