// Optional Chromium benchmark. Baseline: FANGCUN_PERF_BASELINE=1; normal mode also checks invariants.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true });
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const page = await context.newPage(), errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => route.fulfill({json: new URL(route.request().url()).pathname === '/api/auth/session' ? {configured:true,authenticated:true,user:{id:7,username:'member-performance',role:'user'}} : {data:null,revision:0}}));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => document.querySelector('#authGate').classList.contains('hidden') && !syncState.syncing && !syncState.reconciling);
    await page.evaluate(() => {
      document.documentElement.dataset.skin='liquid'; data.semester=defaultSemester();data.timeSlots=defaultTimeSlots();data.courses=[];data.tasks=[];data.projects=[];data.calendarRules=[];data.courseExceptions=[];
      for(let i=0;i<42;i++) data.courses.push({id:'perf-course-'+i,name:'计算机程序设计及数据分析课程 '+i,day:i%7+1,startSection:1+Math.floor(i/7)*2,endSection:2+Math.floor(i/7)*2,weeks:[1,2,3,4],color:['#536db3','#3d8d83','#a56d47'][i%3],location:'E13-201',reminderMinutes:10});
      const start=weekStartDate(1);
      for(let i=0;i<180;i++) data.tasks.push({id:'perf-task-'+i,title:'完成课程任务与报告 '+i,type:'task',quadrant:['q1','q2','q3','q4'][i%4],important:i%2===0,urgent:i%3===0,completed:false,due:localISO(addDays(start,i%21)),dueTime:'23:59',courseId:'perf-course-'+i%42,createdAt:Date.now()-i*1000,repeat:'none'});
      displayedWeek=1;scheduleMode='week';switchView('schedule');renderAll();
      window.perfCounts={listeners:0,selectRects:0,selectClones:0,zoomWrites:0};
      const add=EventTarget.prototype.addEventListener,rects=Element.prototype.getClientRects,clone=Node.prototype.cloneNode,set=Storage.prototype.setItem;
      EventTarget.prototype.addEventListener=function(...args){perfCounts.listeners++;return add.apply(this,args)};
      Element.prototype.getClientRects=function(...args){if(this.classList.contains('liquid-select-trigger'))perfCounts.selectRects++;return rects.apply(this,args)};
      Node.prototype.cloneNode=function(...args){if(this.nodeName==='LABEL')perfCounts.selectClones++;return clone.apply(this,args)};
      Storage.prototype.setItem=function(key,value){if(key.includes('fangcun-calendar-zoom'))perfCounts.zoomWrites++;return set.call(this,key,value)};
    });
    await page.waitForTimeout(300);
    const measured=await page.evaluate(() => {
      const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
      const stats={};
      for(const mode of ['week','year']) {
        scheduleMode=mode;renderAll();void document.body.offsetHeight;
        const hidden=document.querySelector('#q1List');let records=0;
        const observer=new MutationObserver(()=>{});observer.observe(hidden,{childList:true,subtree:true});
        perfCounts.listeners=0;const times=[];
        for(let i=0;i<9;i++){const start=performance.now();renderAll();void document.body.offsetHeight;times.push(performance.now()-start);records+=observer.takeRecords().length;}
        observer.disconnect();stats[mode]={medianMs:median(times),times,hiddenMutations:records,listeners:perfCounts.listeners,domNodes:document.querySelectorAll('*').length};
      }
      scheduleMode='week';renderAll();perfCounts.zoomWrites=0;
      for(let i=0;i<12;i++) updateCalendarPresentation();
      stats.unchangedFitWrites=perfCounts.zoomWrites;
      return stats;
    });
    await page.evaluate(() => { openTaskModal('perf-task-0'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { perfCounts.selectRects=0;perfCounts.selectClones=0; });
    await page.waitForTimeout(1050);
    measured.idleSelect=await page.evaluate(() => ({rects:perfCounts.selectRects,labelClones:perfCounts.selectClones}));
    await page.evaluate(() => {document.querySelector('#taskReminder').value='30';});
    await page.waitForFunction(() => document.querySelector('#taskReminder + .liquid-select-trigger .liquid-select-value').textContent === document.querySelector('#taskReminder').selectedOptions[0].label);
    await page.locator('#taskModal .close-button').click();
    // Hidden view changes must be visible immediately upon navigation.
    if (!process.env.FANGCUN_PERF_BASELINE) {
    await page.evaluate(() => {data.tasks[0].title='后台修改后第一次进入可见';switchView('matrix');});
    assert.match(await page.locator('#q1List').textContent(),/后台修改后第一次进入可见/);
    await page.evaluate(() => {switchView('schedule');data.courses[0].name='更新后的完整课程名称';switchView('today');switchView('schedule');});
    assert.ok(await page.locator('.calendar-week-event[aria-label*="更新后的完整课程名称"]').count());
    }
    const report={fixture:{courses:42,tasks:180,viewport:'390x844',browser:'headless Chromium',skin:'liquid',note:'Synthetic desktop CPU timing; does not establish Android device frame rate.'},...measured,errors};
    const dir=path.join(__dirname,'release','qa');fs.mkdirSync(dir,{recursive:true});
    const baseline=!!process.env.FANGCUN_PERF_BASELINE;
    fs.writeFileSync(path.join(dir,baseline?'runtime-performance-baseline.json':'runtime-performance-after.json'),JSON.stringify(report,null,2)+'\n');
    if(!baseline){
      assert.equal(measured.week.hiddenMutations,0,'日历刷新不可重建隐藏象限');
      assert.equal(measured.year.hiddenMutations,0,'年历刷新不可重建隐藏象限');
      assert.equal(measured.unchangedFitWrites,0,'尺寸不变不可重复写缩放存储');
      assert.equal(measured.idleSelect.labelClones,0,'静止选择器不可反复克隆label与重建菜单');
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify(report,null,2));
    await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
