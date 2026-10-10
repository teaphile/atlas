// Real providers; no observation/model fixture data is injected into this browser run.
import {chromium,firefox,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const base=process.env.ATLAS_PREVIEW_URL||'http://127.0.0.1:7860';
const dir='../docs/v2';await fs.mkdir(dir+'/screenshots',{recursive:true});
const requested=process.env.ATLAS_BROWSERS?.split(',')||['chromium','firefox','webkit'];
const viewportSizes=[[320,568],[360,800],[390,844],[430,932],[768,1024],[1024,768],[1280,800],[1440,960],[1920,1080],[2560,1440],[844,390],[1024,600]];
const output={started:new Date().toISOString(),base,browsers:[],checks:[],failures:[],screens:[],accessibility:[]};
async function check(name,fn){try{await fn();output.checks.push({name,status:'passed'});console.log('PASS',name);}catch(e){output.checks.push({name,status:'failed',error:String(e)});output.failures.push({name,error:String(e)});console.log('FAIL',name,String(e));}}
async function a11y(page,name){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();const violations=r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));output.accessibility.push({name,violations,incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length}))});if(violations.length)output.failures.push({name:'Accessibility '+name,violations});console.log('AXE',name,violations.length);}
async function measure(page,name,w,h){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const m=await page.evaluate(()=>{const rect=s=>{const e=document.querySelector(s);if(!e||getComputedStyle(e).display==='none')return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth};};return {viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,header:rect('.topbar'),workspace:rect('.workspace-main'),page:rect('.workspace-page'),content:rect('.workspace-content'),map:rect('.map-stage'),canvas:rect('.map-canvas'),label:rect('.map-location-tag'),chart:rect('.chart-card'),footer:rect('.statusbar')};});
 const issues=[];if(m.documentWidth>w+1||m.bodyWidth>w+1)issues.push('document horizontal overflow');for(const k of ['header','workspace','page','content'])if(m[k]&&(m[k].right>w+1||m[k].x< -1||m[k].scroll>m[k].client+2))issues.push(k+' overflow');if(m.map&&(m.map.height<100||m.map.width<150))issues.push('map collapsed');if(m.map&&m.canvas&&Math.abs(m.canvas.height-m.map.height)>2)issues.push('map canvas/container height mismatch');if(m.label&&m.label.height>100)issues.push('stretched map label');
 output.screens.push({name,...m,issues});if(issues.length)output.failures.push({name,issues,metrics:m});
 if((w===390&&h===844)||(w===1440&&h===960))await page.screenshot({path:`${dir}/screenshots/${name.replace(/[^a-z0-9-]/gi,'-')}.png`});
 console.log('VIEW',name,`${w}×${h}`,issues.length?issues.join(','):'OK');
}
for(const name of requested){const engine={chromium,firefox,webkit}[name];let browser;
 try{
  browser=await engine.launch({headless:name!=="firefox"||!process.env.DISPLAY,...(name==='chromium'?{args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']} :name==='firefox'?{firefoxUserPrefs:{'webgl.force-enabled':true,'webgl.disabled':false,'webgl.disable-fail-if-major-performance-caveat':true,'gfx.webrender.all':true}}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});const page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[],http=[];page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)http.push({status:r.status(),url:r.url()});});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('.map-stage').waitFor();await page.waitForFunction(()=>document.querySelector('[data-map-ready="true"]')||document.querySelector('.map-fallback'),undefined,{timeout:40000});
  const fallback=await page.locator('.map-fallback').count();output.browsers.push({name,version:browser.version(),mode:name==='firefox'&&process.env.DISPLAY?'headed virtual display':'headless',map:fallback?'WebGL fallback':'rendered',errors,httpFailures:http});
  for(const [w,h] of viewportSizes)await measure(page,name+'-overview-'+w+'x'+h,w,h);
  await page.setViewportSize({width:1440,height:960});if(name==='chromium')await a11y(page,name+' overview');
  await page.getByRole('button',{name:'Intelligence',exact:true}).click();await page.getByRole('button',{name:'Signal Lab',exact:true}).click();
  await page.locator('.derived-metrics').waitFor({timeout:45000});
  for(const [w,h] of viewportSizes)await measure(page,name+'-signals-'+w+'x'+h,w,h);
  await page.setViewportSize({width:1440,height:960});
  await check(name+' chart keyboard inspection, table and baseline toggle',async()=>{
   const first=page.locator('.time-chart').first();await first.scrollIntoViewIfNeeded();
   const slider=page.getByRole('slider',{name:'Thermal profile & dew point: inspect time'});await slider.focus();await slider.press('ArrowRight');await expect(page.locator('.chart-readout').first()).toContainText('UTC');
   await page.getByRole('button',{name:'Show data table',exact:true}).first().click();await expect(page.locator('.chart-data-table').first()).toBeVisible();
   await page.getByRole('button',{name:'Hide data table',exact:true}).first().click();
   await page.getByRole('button',{name:'7-day baseline',exact:true}).click();await expect(page.getByRole('button',{name:'7-day baseline',exact:true})).toHaveAttribute('aria-pressed','true');
   await page.getByRole('button',{name:'72-hour outlook',exact:true}).click();
  });
  if(name==='chromium'){
   await page.locator('.workspace-page').evaluate(e=>e.scrollTop=0);await a11y(page,'chromium Signal Lab');
   await check('Scientific CSV includes location, source clocks and canonical units',async()=>{
    const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV',exact:true}).click()]);const text=await fs.readFile(await dl.path(),'utf8');expect(text).toContain('requested_latitude');expect(text).toContain('weather_model_time_utc');expect(text).toContain('reference_et0_mm');expect(text.split('\r\n')).toHaveLength(242);
   });
   await check('Thermal sandbox recalculation preserves explicit parameters',async()=>{
    await page.getByLabel('Base (°C)',{exact:true}).fill('12');const [r]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/v1/insights?')&&r.url().includes('base_c=12')),page.getByRole('button',{name:'Recalculate',exact:true}).click()]);expect((await r.json()).thermal_parameters.base_c).toBe(12);await page.locator('.derived-metrics').waitFor();
   });
   await check('Two/three-place comparison uses a shared UTC window',async()=>{
    await page.getByRole('button',{name:'Compare places',exact:true}).click();const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/compare')),page.locator('.compare-picker').getByRole('button',{name:'Compare places',exact:true}).click()]);const d=await r.json();expect(d.reports).toHaveLength(3);expect(new Set(d.reports.map(r=>r.forecast_start)).size).toBe(1);await expect(page.locator('.comparison-table')).toBeVisible();
    await page.getByRole('button',{name:'72 h',exact:true}).click();await expect(page.locator('.comparison-table caption')).toContainText('72-hour');
   });
   await a11y(page,'chromium comparison');await page.locator('.workspace-page').evaluate(e=>e.scrollTop=0);await page.screenshot({path:dir+'/screenshots/comparison-desktop.png'});
   await page.getByRole('button',{name:'Record explorer',exact:true}).click();await check('Record explorer search, empty state and pagination',async()=>{const input=page.getByRole('textbox',{name:'Filter underlying records'});await input.fill('NO_SUCH_RECORD_QA');await expect(page.getByText('No matching records. Missing coverage is not an all-clear.')).toBeVisible();await input.fill('');await expect(page.locator('.record-kpis')).toBeVisible();});await a11y(page,'chromium record explorer');
   await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Data sources/}).click();await a11y(page,'chromium source registry');
   await check('Workspace settings and portable JSON contain no credentials',async()=>{
    await page.getByRole('button',{name:'Workspace settings',exact:true}).first().click();await page.getByLabel('Motion',{exact:true}).selectOption('reduce');const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export workspace',exact:true}).click()]);const d=JSON.parse(await fs.readFile(await dl.path(),'utf8'));expect(d.schema).toBe('atlas-workspace');expect(d.preferences.motion).toBe('reduce');expect(JSON.stringify(d)).not.toMatch(/api_key|accessKey|X-Atlas-Key/);
    await page.getByLabel('Import workspace JSON',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":1}')});await expect(page.getByText('Expected an ATLAS version 2 workspace')).toBeVisible();
    d.filters.kinds=[];await page.getByLabel('Import workspace JSON',{exact:true}).setInputFiles({name:'workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});await expect(page.getByText('Workspace imported. Access keys and historical snapshots are never imported.')).toBeVisible();
   });await a11y(page,'chromium settings');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   await page.getByRole('button',{name:'Overview',exact:true}).click();await page.waitForSelector('[data-map-ready="true"]',{timeout:40000});
   await check('GeoJSON import honors empty layer filters, validates topology and exports',async()=>{
    await page.getByRole('button',{name:'Import GeoJSON polygon',exact:true}).click();await page.getByLabel('Polygon GeoJSON',{exact:true}).fill(JSON.stringify({type:'Polygon',coordinates:[[[77,26],[79,26],[79,28],[77,28],[77,26]]]}));
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/aoi')),page.getByRole('button',{name:'Validate & analyze polygon',exact:true}).click()]);const d=await r.json();expect(d.event_count).toBe(0);expect(d.filters.kinds).toEqual([]);await expect(page.getByText('Your area, in evidence.')).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   });
   await check('Active polygon survives workspace export and saved-view restoration',async()=>{
    const expected={type:'Polygon',coordinates:[[[77,26],[79,26],[79,28],[77,28],[77,26]]]};
    await page.getByRole('button',{name:'Save selected location',exact:true}).click();await page.getByRole('textbox',{name:'VIEW NAME'}).fill('QA polygon view');await page.getByRole('button',{name:'Save location view',exact:true}).click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('atlas.views.v1')));expect(saved.at(-1).geometry).toEqual(expected);
    await page.getByRole('button',{name:'Clear polygon',exact:true}).click();await expect(page.getByRole('button',{name:'Clear polygon',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:/QA polygon view/}).click();await expect(page.getByRole('button',{name:'Clear polygon',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Workspace settings',exact:true}).first().click();const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export workspace',exact:true}).click()]);const data=JSON.parse(await fs.readFile(await dl.path(),'utf8'));expect(data.geometry).toEqual(expected);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   });
   await check('Polygon drawing, undo, finish and cancellation',async()=>{
    await page.getByRole('button',{name:'Draw analysis polygon',exact:true}).click();const box=await page.locator('.map-canvas').boundingBox();const x=box.x+box.width*.5,y=box.y+box.height*.55;
    await page.mouse.click(x,y);await page.mouse.click(x+55,y);await page.mouse.click(x+55,y+55);await page.mouse.click(x,y+55);
    await expect(page.getByText('4 vertices · tap map')).toBeVisible();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByText('3 vertices · tap map')).toBeVisible();
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/aoi')),page.getByRole('button',{name:'Finish',exact:true}).click()]);expect(r.status()).toBe(200);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Draw analysis polygon',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('.drawing-toolbar')).toHaveCount(0);
   });
   await page.setViewportSize({width:390,height:844});await check('Phone layer drawer, dismissal, dialog and reduced-motion preference',async()=>{
    await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('.sidebar-wrapper.mobile-open')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.sidebar-wrapper.mobile-open')).toHaveCount(0);await page.getByRole('button',{name:'Workspace settings',exact:true}).click();await expect(page.getByLabel('Motion',{exact:true})).toHaveValue('reduce');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   });await a11y(page,'chromium phone overview');
   await page.getByRole('button',{name:'Intelligence',exact:true}).click();await page.getByRole('button',{name:'Signal Lab',exact:true}).click();await page.locator('.derived-metrics').waitFor({timeout:45000});await a11y(page,'chromium phone Signal Lab');
   await page.emulateMedia({reducedMotion:'reduce'});await check('Keyboard skip link reaches the main workspace',async()=>{await page.getByRole('link',{name:'Skip to workspace'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#main-workspace')).toBeFocused();});
  }
  if(errors.length||http.length)output.failures.push({name:name+' runtime',errors,http});
  output.browsers.find(b=>b.name===name).errors=errors;output.browsers.find(b=>b.name===name).httpFailures=http;
  await context.close();
 }catch(e){output.failures.push({name:name+' suite',error:String(e)});console.error('SUITE',name,String(e));}
 finally{await browser?.close();await fs.writeFile(dir+'/browser-verification-v2.json',JSON.stringify(output,null,2));}
}
output.finished=new Date().toISOString();await fs.writeFile(dir+'/browser-verification-v2.json',JSON.stringify(output,null,2));console.log('DONE',output.checks.filter(c=>c.status==='passed').length,'checks,',output.screens.length,'viewport/view samples,',output.failures.length,'issues');
process.exitCode=output.failures.length?1:0;
