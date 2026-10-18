// Controlled HTTP error injection only; recovered data comes from real providers.
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
await fs.mkdir("../.artifacts/browser", {recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/insights?*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Controlled transport failure for retry verification'})}));
 await page.goto(process.env.ATLAS_PREVIEW_URL||'http://127.0.0.1:7860');
 await page.getByRole('button',{name:'Intelligence',exact:true}).click();await page.getByRole('button',{name:'Signal Lab',exact:true}).click();
 await expect(page.getByText('Controlled transport failure for retry verification')).toBeVisible();
 await expect(page.locator('.signal-lab').getByRole('button',{name:'CSV',exact:true})).toBeDisabled();await expect(page.locator('.derived-metrics')).toHaveCount(0);
 results.push({name:'HTTP failure is visible; no fabricated metrics or enabled stale export',status:'passed'});
 await page.unroute('**/api/v1/insights?*');await page.locator('.signal-lab').getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.derived-metrics').waitFor({timeout:45000});
 await expect(page.getByText('Controlled transport failure for retry verification')).toHaveCount(0);await expect(page.locator('.signal-lab').getByRole('button',{name:'CSV',exact:true})).toBeEnabled();
 results.push({name:'Retry recovers real analysis and clears obsolete error',status:'passed'});
 await page.locator('.lab-controls select').selectOption('imperial');await expect(page.locator('.chart-unit').first()).toContainText('°F');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.signal-lab').getByRole('button',{name:'CSV',exact:true}).click()]);const text=await fs.readFile(await download.path(),'utf8');expect(text).toContain('temperature_c');expect(text).not.toContain('temperature_f');expect(text).not.toContain('°F');
 results.push({name:'Display-unit switch does not convert canonical scientific exports',status:'passed'});
 expect(errors).toEqual([]);await context.close();
}catch(e){results.push({name:'Fault/recovery suite',status:'failed',error:String(e)});process.exitCode=1;}
finally{await browser.close();await fs.writeFile('../.artifacts/browser/fault-browser-verification.json',JSON.stringify({checked_at:new Date().toISOString(),note:'One deliberate 503 injected; no synthetic weather/incident data.',checks:results},null,2));console.log(JSON.stringify(results,null,2));}
