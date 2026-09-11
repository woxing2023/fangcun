// Touch optics must remain visible and bounded, alongside real app behavior.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.FANGCUN_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const output=path.join(__dirname,'release/qa/touch');fs.mkdirSync(output,{recursive:true});
  const server=http.createServer((req,res)=>{
    const file=path.resolve(__dirname,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;const report=[];
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block',recordVideo:{dir:output,size:{width:390,height:844}}});
    const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/auth/session'?{configured:true,authenticated:true,user:{id:7,username:'member-touch',role:'user'}}:{data:null,revision:0}}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelector('#authGate').classList.contains('hidden')&&!syncState.syncing&&!syncState.reconciling);
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>{
      const colors=['#6289a9','#849770','#aa8065','#8877ac','#9a7692','#64988e','#a39361'];
      data.semester={...defaultSemester(),startDate:localISO(mondayOf(new Date())),showWeekend:true};
      data.timeSlots=defaultTimeSlots();data.courses=[];data.tasks=[];
      for(let day=1;day<=7;day++)for(let j=0;j<3;j++)data.courses.push({id:`touch-${day}-${j}`,name:['程序设计基础 · Python Lab','微积分与空间解析几何','大学物理实验'][j],day,startSection:[1,6,11][j],endSection:[2,7,13][j],weeks:[1],color:colors[(day+j)%7],location:`A${200+day}`});
      data.tasks=Array.from({length:180},(_,i)=>({id:`touch-task-${i}`,title:'程序设计基础 Lab 2 - Python as a Calculator 提交截止',quadrant:['q1','q2','q3','q4'][i%4],important:i%2===0,urgent:i%3===0,due:offsetDate(i%8),completed:false}));
      displayedWeek=1;switchView('schedule');scheduleMode='timetable';renderAll();
    });
    await page.waitForFunction(()=>FangcunTouchMaterial.getStats().renderer!==null);
    const session=await context.newCDPSession(page);
    const stats=()=>page.evaluate(()=>FangcunTouchMaterial.getStats());
    async function finger(selector,{kind='glass',cancel=false,surface=null}={}){
      const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded();
      const hit=await target.boundingBox(), before=surface ? await page.locator(surface).first().boundingBox() : hit;
      const x=hit.x+hit.width*.48,y=hit.y+hit.height*.45;
      await page.evaluate(()=>document.addEventListener('pointerdown',e=>{window.__qaTouchPointer=e.pointerId;},{once:true,capture:true}));
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:6,radiusY:6,force:.6,id:1}]});
      await page.waitForTimeout(100);
      const started=await stats();assert.ok(started.active&&started.enabled&&started.renderer.drawCount>0,JSON.stringify(started));
      const hitDescription=await page.evaluate(({x,y})=>({element:document.elementFromPoint(x,y)?.outerHTML?.slice(0,250),layer:document.querySelector('.touch-material-layer')?.parentElement?.tagName}),{x,y});
      assert.equal(started.kind,kind,JSON.stringify({selector,hit,hitDescription}));
      assert.equal(await page.locator('.touch-material-layer').count(),1);assert.equal(await page.locator('.touch-material-layer canvas').count(),1);
      const layer=await page.locator('.touch-material-layer').boundingBox();
      assert.ok(Math.abs(layer.x-before.x)<2&&Math.abs(layer.y-before.y)<2,'Optics must align with target, including a blurred dialog containing block');
      assert.deepEqual(await target.boundingBox(),hit,'Optics must not deform text or hit areas');
      // Burst samples exercise the controller independently of native pan
      // recognition. They must coalesce without remeasuring the DOM.
      await target.evaluate((el,{x,y})=>{const id=window.__qaTouchPointer;for(let i=0;i<20;i++)el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:id,clientX:x+i*.3,clientY:y+i*.15,isPrimary:true}));},{x,y});
      await page.waitForTimeout(50);const moved=await stats();
      assert.equal(moved.geometryReads,started.geometryReads);assert.ok(moved.uniformUpdates-started.uniformUpdates<=2);
      assert.ok(moved.uniformUpdates>started.uniformUpdates);assert.equal(moved.pointerSamples-started.pointerSamples,20);
      assert.equal(moved.renderer.resizes,started.renderer.resizes);assert.ok(moved.renderer.pixelCount<=1400000);
      if(cancel)await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      else await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      return {started,moved};
    }
    for(const skin of ['classic','liquid'])for(const mode of ['light','dark']){
      await page.evaluate(({skin,mode})=>{document.documentElement.dataset.skin=skin;document.documentElement.dataset.mode=mode;document.body.classList.toggle('dark',mode==='dark');},{skin,mode});
      await page.waitForTimeout(200);
      const painting=await page.evaluate(()=>{const record=getComputedStyle(document.querySelector('.course-block')),paper=getComputedStyle(document.querySelector('.schedule-board-wrap'));return {recordImage:record.backgroundImage,recordShadow:record.boxShadow,recordBlur:record.backdropFilter,paper:paper.backgroundImage};});
      assert.match(painting.recordImage,/gradient/);assert.notEqual(painting.recordShadow,'none');assert.equal(painting.recordBlur,'none');assert.match(painting.paper,/xuan-fibers-mobile\.png/);
      const test=await finger('#calendarZoomFit');
      await page.screenshot({path:path.join(output,`optics-${skin}-${mode}.png`)});
      await page.waitForTimeout(1250);
      const settled=await stats(),draws=settled.renderer.drawCount;
      assert.equal(settled.active,false);assert.equal(settled.renderer.running,false);assert.equal(await page.locator('.touch-material-layer').count(),0);
      await page.waitForTimeout(100);assert.equal((await stats()).renderer.drawCount,draws);
      await page.screenshot({path:path.join(output,`timetable-${skin}-${mode}.png`)});
      report.push({skin,mode,painting,...test,settled});
    }
    // Course actions retain their actual click handler, even with the overlay.
    await page.evaluate(()=>{document.documentElement.dataset.mode='light';document.body.classList.remove('dark');});
    await finger('.course-block');
    assert.equal(await page.locator('#courseModal').evaluate(el=>el.open),true);
    await finger('#courseModal .close-button',{cancel:true});
    assert.equal(await page.locator('.touch-material-layer').count(),0);
    await page.locator('#courseModal .close-button').click();
    // A top-layer select menu keeps the lens above its own surface and still
    // applies the selected option to the underlying form control.
    async function openTaskBeforeAutofocus(){
      const captured=await page.evaluate(()=>{
        const nativeSetTimeout=window.setTimeout;
        window.__qaTaskAutofocus=[];
        // Hold only the modal's scheduled initial focus. This deterministically
        // models a user acting before it fires, without a timing-dependent sleep.
        window.setTimeout=(callback,delay,...args)=>{
          if(delay===40){window.__qaTaskAutofocus.push(()=>callback(...args));return -1;}
          return nativeSetTimeout(callback,delay,...args);
        };
        try{openTaskModal();}finally{window.setTimeout=nativeSetTimeout;}
        return window.__qaTaskAutofocus.length;
      });
      assert.equal(captured,1,'Task modal must schedule exactly one initial focus');
    }
    const flushTaskAutofocus=()=>page.evaluate(()=>{
      const callbacks=window.__qaTaskAutofocus;delete window.__qaTaskAutofocus;
      callbacks.forEach(callback=>callback());
    });
    await openTaskBeforeAutofocus();
    await flushTaskAutofocus();
    assert.equal(await page.locator('#taskTitle').evaluate(el=>document.activeElement===el),true,'Untouched task modal still focuses its title');
    await page.locator('#taskModal .close-button').click();
    await openTaskBeforeAutofocus();
    const taskTypeTrigger=page.locator('#taskType + .liquid-select-trigger');
    await taskTypeTrigger.tap();
    assert.equal(await taskTypeTrigger.getAttribute('aria-expanded'),'true');
    await flushTaskAutofocus();
    assert.equal(await taskTypeTrigger.evaluate(el=>document.activeElement===el),true,'Delayed modal focus must preserve the user-selected control');
    assert.equal(await taskTypeTrigger.getAttribute('aria-expanded'),'true','Quickly opened menu must remain open after delayed autofocus');
    assert.equal(await page.locator('.liquid-select-menu:not([hidden]) [role=option][data-index="1"]').isVisible(),true);
    await finger('.liquid-select-menu:not([hidden]) [role=option][data-index="1"]');
    assert.equal(await page.locator('#taskType').inputValue(),'event');
    assert.equal(await page.locator('.touch-material-layer').count(),0);
    await page.locator('#taskModal .close-button').click();
    // Shared paper has its own soft fingertip lighting without adding clicks.
    await page.evaluate(()=>{data.courses=[]; switchView('today');});await page.waitForTimeout(200);
    await finger('.today-next p',{kind:'paper',surface:'.today-next',cancel:true});
    assert.ok(!requests.some(url=>/three\.(module|core)/.test(url)),'Touch optics must not import a scene engine');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>FangcunTouchMaterial.enabled),false);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.emulateMedia({forcedColors:'active'});assert.equal(await page.locator('.touch-material-layer').count(),0);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,limitation:'Chromium touch emulation and software GPU; not Android device FPS.',scenarios:report,modalFocus:{untouchedTitleFocus:true,userMenuFocusPreserved:true,touchOptionCommitted:true},errors,sceneEngineRequests:requests.filter(u=>/three\.(module|core)/.test(u))},null,2));
    const video=page.video();await context.close();await video.saveAs(path.join(output,'touch-material-demo.webm'));
    console.log('Touch optics passed: two skins/themes, actual touch, preserved actions, isolated shared GPU surface, no geometry reads per move, gesture cancellation and idle stop.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
