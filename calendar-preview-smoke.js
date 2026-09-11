// Validate the generated review from file:// with network access disabled.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.FANGCUN_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1680,height:1200}});
 await context.setOffline(true);
 const page=await context.newPage(),errors=[],network=[];
 page.on('pageerror',error=>errors.push(String(error)));
 page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
 const report={snapshots:[],optics:[],offline:true};
 try{
  await page.goto(pathToFileURL(path.join(__dirname,'release/calendar-review.html')).href);
  const payload=await page.evaluate(()=>({build:preview.build,count:Object.keys(preview.snapshots).length,desktopCoarseMedia:/\(pointer:\s*coarse\)/.test(preview.styles.desktop),touchCoarseMedia:/\(pointer:\s*coarse\)/.test(preview.styles.touch)}));
  assert.equal(payload.build,'20260911-calendar-v3');assert.equal(payload.count,12);
  assert.equal(payload.desktopCoarseMedia,true,'fine snapshot retains original CSS media');
  assert.equal(payload.touchCoarseMedia,false,'touch stylesheet explicitly simulates coarse media');
  for(const orientation of ['desktop','portrait','landscape'])for(const calendar of ['week','timetable'])for(const layout of ['overview','list']){
   await page.locator(`.controls [data-orientation="${orientation}"]`).click();
   await page.locator(`.controls [data-calendar="${calendar}"]`).click();
   await page.locator(`.controls [data-layout="${layout}"]`).click();
   const key=`${orientation}-${calendar}-${layout}`;
   await page.waitForFunction(key=>document.querySelector('iframe').contentDocument?.documentElement.dataset.previewView===key,key);
   const frame=page.frames().find(frame=>frame.parentFrame());
   await frame.waitForFunction(()=>window.FangcunTouchMaterial?.enabled);
   await frame.evaluate(()=>document.fonts.ready);
   const measured=await frame.evaluate(({orientation,calendar,layout})=>{
    const wrap=document.querySelector('.schedule-board-wrap');
    return {orientation,calendar,layout,width:innerWidth,height:innerHeight,material:document.documentElement.dataset.materialPerformance,
      mode:document.getElementById('scheduleView').dataset.mode,layoutAttribute:wrap.dataset.calendarLayout,
      weekVisible:!!document.querySelector('.calendar-week-grid')?.getClientRects().length,
      timetableVisible:!!document.querySelector('#scheduleBoard')?.getClientRects().length,
      listVisible:!!document.querySelector('#courseAgenda')?.getClientRects().length,
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      courseCount:document.querySelectorAll(layout==='list'?'.calendar-list-item':calendar==='week'?'.calendar-week-event':'.course-block').length};
   },{orientation,calendar,layout});
   assert.equal(measured.material,orientation==='desktop'?'dynamic':'touch');
   assert.equal(measured.mode,calendar);assert.equal(measured.layoutAttribute,layout);assert.equal(measured.overflow,false);
   assert.equal(measured.listVisible,layout==='list');
   if(layout==='overview')assert.equal(calendar==='week'?measured.weekVisible:measured.timetableVisible,true);
   assert.equal(measured.courseCount,21,'every snapshot retains the synthetic courses');
   // Theme and skin changes operate on this same DOM, without swapping devices.
   for(const skin of ['classic','liquid'])for(const theme of ['light','dark']){
    await page.locator(`.controls [data-skin="${skin}"]`).click();
    await page.locator(`.controls [data-theme="${theme}"]`).click();
    const selected=await frame.evaluate(()=>({skin:document.documentElement.dataset.skin,theme:document.documentElement.dataset.mode,dark:document.body.classList.contains('dark')}));
    assert.deepEqual(selected,{skin,theme,dark:theme==='dark'});
   }
   report.snapshots.push(measured);
  }
  for(const orientation of ['desktop','portrait','landscape']){
   await page.locator(`.controls [data-orientation="${orientation}"]`).click();
   await page.locator('.controls [data-calendar="week"]').click();
   await page.locator('.controls [data-layout="overview"]').click();
   const key=`${orientation}-week-overview`;
   await page.waitForFunction(key=>document.querySelector('iframe').contentDocument?.documentElement.dataset.previewView===key,key);
   const frame=page.frames().find(frame=>frame.parentFrame());
   await frame.waitForFunction(()=>window.FangcunTouchMaterial?.enabled);
   await frame.evaluate(()=>document.fonts.ready);
   await frame.locator('.calendar-week-event').first().dispatchEvent('pointerdown',{bubbles:true,pointerId:21,isPrimary:true,pointerType:'mouse',clientX:120,clientY:180});
   await frame.waitForFunction(()=>{const state=FangcunTouchMaterial.getStats();return state.active&&state.renderer?.drawCount>0&&!state.fallback;});
   const initial=await frame.evaluate(()=>FangcunTouchMaterial.getStats());
   assert.equal(await frame.locator('.touch-material-layer').count(),1);
   assert.equal(await frame.locator('.touch-material-layer canvas').count(),1,'one shared canvas in the shadow root');
   await frame.locator('#calendarZoomIn').dispatchEvent('pointerdown',{bubbles:true,pointerId:22,isPrimary:true,pointerType:'mouse',clientX:220,clientY:70});
   await frame.waitForFunction(()=>FangcunTouchMaterial.getStats().renderer.mounts>=2);
   assert.equal(await frame.locator('.touch-material-layer canvas').count(),1,'the next target reuses one canvas');
   await frame.locator('#calendarZoomIn').dispatchEvent('pointercancel',{bubbles:true,pointerId:22,isPrimary:true,pointerType:'mouse'});
   assert.equal(await frame.locator('.touch-material-layer').count(),0);
   report.optics.push({orientation,...initial});
  }
  // Internal calendar switches bridge to the outer snapshot controls offline.
  let frame=page.frames().find(frame=>frame.parentFrame());
  await frame.locator('#calendarListBtn').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.documentElement.dataset.previewView==='landscape-week-list');
  frame=page.frames().find(frame=>frame.parentFrame());await frame.locator('#calendarZoomFit').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.documentElement.dataset.previewView==='landscape-week-overview');
  assert.deepEqual(network,[],'the file review must issue no HTTP requests');assert.deepEqual(errors,[]);
  const directory=path.join(__dirname,'release','qa');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'calendar-preview-report.json'),JSON.stringify({passed:true,...report,networkRequests:network.length,errors},null,2)+'\n');
  console.log('calendar-preview-smoke: 12 offline snapshots, 48 skin/theme combinations, fine/coarse CSS and shared desktop/mobile GPU feedback passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
