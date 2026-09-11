// Optional Chromium regression: seven hit tracks, pointer/keyboard creation and course drag/drop.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.FANGCUN_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.join(__dirname,pathname==='/'?'index.html':pathname);
    if(!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.woff2')?'font/woff2':'text/html');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:3824,height:2160},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'?{configured:true,authenticated:true,user:{id:7,username:'member-tracks',role:'user'}}:{data:null,revision:0}}));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>document.querySelector('#authGate').classList.contains('hidden')&&!syncState.syncing&&!syncState.reconciling);
    await page.evaluate(()=>{
      data.semester=defaultSemester();data.timeSlots=defaultTimeSlots();data.courses=[];data.tasks=[];data.projects=[];data.calendarRules=[];data.courseExceptions=[];
      for(let day=1;day<=7;day++)for(let index=0;index<6;index++)data.courses.push({id:`track-course-${day}-${index}`,name:`完整课程名称 · 程序设计与数据分析 ${day}-${index}`,day,startSection:index*2+1,endSection:index*2+2,weeks:[1],color:['#e7edf6','#e6ece4','#fff2e2'][index%3],location:'A-201',reminderMinutes:10});
      const start=weekStartDate(1);
      data.tasks.push({id:'track-early',title:'清晨日程',type:'event',startDate:localISO(start),startTime:'06:30',endTime:'07:00',completed:false},{id:'track-late',title:'最后一分钟截止',due:localISO(addDays(start,6)),dueTime:'23:59',completed:false});
      displayedWeek=1;scheduleMode='week';switchView('schedule');renderAll();
    });
    assert.equal(await page.locator('.calendar-day-track').count(),7,'周历应只有七个空白命中轨道');
    assert.equal(await page.locator('.calendar-time-cell').count(),7,'不可残留逐半小时空按钮');
    assert.equal(await page.locator('.calendar-week-event').count(),44,'轨道简化不可丢课程或早晚事项');
    assert.equal(await page.locator('#calendarFocus').count(),1,'只能有一个焦点条');
    await page.waitForTimeout(100);
    const cache=await page.evaluate(()=>{
      const grid=document.querySelector('.calendar-week-grid'),event=grid.querySelector('.calendar-week-event'),fitText=document.querySelector('#calendarZoomFit').firstChild;
      const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('#scheduleView'),{subtree:true,childList:true,attributes:true,characterData:true});
      for(let index=0;index<3;index++){renderAll();updateCalendarPresentation();}
      const mutations=observer.takeRecords();observer.disconnect();
      return{gridSame:grid===document.querySelector('.calendar-week-grid'),eventSame:event===document.querySelector('.calendar-week-event'),fitTextSame:fitText===document.querySelector('#calendarZoomFit').firstChild,childChanges:mutations.filter(record=>record.type==='childList').length,attributeChanges:mutations.filter(record=>record.type==='attributes').length};
    });
    assert.deepEqual(cache,{gridSame:true,eventSame:true,fitTextSame:true,childChanges:0,attributeChanges:0},'无改动刷新必须保留节点，尺寸回调不得制造DOM写入');
    const invalidation=await page.evaluate(()=>{
      const root=()=>document.querySelector('.calendar-week-grid');let old=root();
      data.courses[0].notes='不参与日历显示的备注';renderAll();const notesStable=old===root();
      data.courses[0].name+=' · 修改';renderAll();const courseChanged=old!==root()&&root().querySelector('[data-course-id="track-course-1-0"]').textContent.includes('修改');old=root();
      data.tasks[0].startTime='05:30';data.tasks[0].title='立即更新的早间任务';renderAll();const taskChanged=old!==root()&&root().querySelector('[data-task-id="track-early"]').getAttribute('aria-label').includes('05:30')&&root().querySelector('[data-calendar-track]').dataset.trackStart==='300';
      data.tasks[0].startTime='06:30';renderAll();
      const day=localISO(addDays(weekStartDate(1),1));data.courseExceptions.push({id:'cache-exception',courseId:'track-course-2-0',date:day,type:'cancel'});renderAll();const exceptionChanged=!root().querySelector('[data-course-id="track-course-2-0"]');
      data.courseExceptions=[];data.calendarRules.push({id:'cache-holiday',date:localISO(addDays(weekStartDate(1),3)),type:'holiday',name:'测试假日'});renderAll();const ruleChanged=!root().querySelector('[data-course-id="track-course-4-0"]');
      data.calendarRules=[];data.timeSlots[0].startTime='07:30';renderAll();const slotChanged=root().querySelector('[data-course-id="track-course-1-0"]').getAttribute('aria-label').startsWith('07:30');
      data.timeSlots[0].startTime='08:00';renderAll();return{notesStable,courseChanged,taskChanged,exceptionChanged,ruleChanged,slotChanged};
    });
    assert.ok(Object.values(invalidation).every(Boolean),'有效输入修改必须立即更新，备注不应重建网格: '+JSON.stringify(invalidation));

    const originalColors=await page.evaluate(()=>data.courses.map(course=>course.color));
    const colors=await page.evaluate(()=>data.courses.map(calendarSemanticColor));
    assert.equal(colors.length,42);assert.ok(colors.every(color=>color.startsWith('hsl(')));
    assert.deepEqual(await page.evaluate(()=>data.courses.map(course=>course.color)),originalColors,'计算语义色不可修改保存的课程色');
    const track=page.locator('.calendar-day-track').first();
    const point=await track.evaluate(element=>{const rect=element.getBoundingClientRect(),index=(21*60-Number(element.dataset.trackStart))/30;return{x:rect.left+rect.width/2,y:rect.top+(index+.5)/Number(element.dataset.trackCount)*rect.height};});
    await page.mouse.click(point.x,point.y);
    assert.equal(await page.locator('#taskStartTime').inputValue(),'21:00','空白落点应映射实际半小时');
    await page.locator('#taskModal .close-button').click();
    await track.focus();await track.press('Home');await track.press('ArrowDown');await track.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.trackDay),'2','左右键应保留时段切换日期');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#taskStartTime').inputValue(),'06:30','方向键后回车创建所选时段');
    assert.equal(await page.locator('#taskStartDate').inputValue(),await page.evaluate(()=>localISO(addDays(weekStartDate(1),1))));
    await page.locator('#taskModal .close-button').click();
    await track.focus();await track.press('End');await track.press('Enter');
    assert.equal(await page.locator('#taskStartTime').inputValue(),'23:30');
    assert.equal(await page.locator('#taskEndTime').inputValue(),'00:30','午夜之后的结束时间不可写成24:30');
    assert.equal(await page.locator('#taskEndDate').inputValue(),await page.evaluate(()=>localISO(addDays(weekStartDate(1),1))));
    await page.locator('#taskModal .close-button').click();
    await page.locator('[data-schedule-mode="timetable"]').click();
    assert.equal(await page.locator('.schedule-day-track').count(),7);
    assert.equal(await page.locator('.schedule-cell').count(),7,'课表不可残留逐节空div');
    const lastTrack=page.locator('.schedule-day-track').last();await lastTrack.focus();await lastTrack.press('End');await lastTrack.press('Enter');
    assert.equal(await page.locator('#courseDay').inputValue(),'7');assert.equal(await page.locator('#courseStartSection').inputValue(),'13');
    await page.locator('#courseModal .close-button').click();
    // Dragover/drop uses the same real pointer geometry as native DnD, including span clamping.
    await page.evaluate(()=>{
      const card=document.querySelector('.course-block[data-course-id="track-course-1-0"]'),track=document.querySelector('.schedule-day-track[data-track-day="3"]'),rect=track.getBoundingClientRect(),transfer=new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      const event={bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+rect.width/2,clientY:rect.bottom-1};
      track.dispatchEvent(new DragEvent('dragover',event));track.dispatchEvent(new DragEvent('drop',event));
    });
    const moved=await page.evaluate(()=>{const course=courseById('track-course-1-0');return{day:course.day,start:course.startSection,end:course.endSection};});
    assert.deepEqual(moved,{day:3,start:12,end:13},'底部拖放应保留课程跨度并避开越界');
    await page.evaluate(()=>{const start=weekStartDate(1),now=addDays(start,1);now.setHours(8,10,0,0);renderCalendarFocus(start,now);refreshCalendarPast(now);bindDynamicEvents();});
    assert.equal(await page.locator('#calendarFocus').evaluate(element=>element.classList.contains('is-current')),true,'焦点必须由真实正在进行课程计算');
    await page.locator('#calendarFocus [data-course-id]').click();assert.equal(await page.locator('#courseModal').evaluate(element=>element.open),true);await page.locator('#courseModal .close-button').click();
    const layouts=[];
    for(const size of [{width:3824,height:2160},{width:1536,height:960},{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(size);
      for(const mode of ['week','timetable']){
        await page.locator(`[data-schedule-mode="${mode}"]`).click();await page.locator('#calendarZoomFit').click();await page.waitForTimeout(80);
        const geometry=await page.locator('.schedule-board-wrap').evaluate(element=>({width:element.clientWidth,height:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,step:getComputedStyle(element).getPropertyValue('--track-step')}));
        assert.ok(geometry.scrollWidth<=geometry.width+1&&geometry.scrollHeight<=geometry.height+1,`${mode} ${size.width}: 全表不得超出可用区域 ${JSON.stringify(geometry)}`);
        assert.ok(parseFloat(geometry.step)>0&&geometry.step.trim().endsWith('px'),'网格背景应收到实际px步高');
        layouts.push({...size,mode,...geometry});
      }
    }
    await page.locator('#calendarListBtn').click();assert.equal(await page.locator('.calendar-list-item').count(),42,'完整清单应保留全部课程');
    await page.locator('#calendarZoomFit').click();await page.locator('#calendarZoomIn').click();assert.equal(await page.locator('.schedule-board-wrap').getAttribute('data-calendar-layout'),'detail');
    assert.deepEqual(errors,[]);
    const dir=path.join(__dirname,'release/qa');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'calendar-engine-report.json'),JSON.stringify({passed:true,tracksPerGrid:7,courses:42,weekRecords:44,cache,invalidation,layouts,errors},null,2)+'\n');
    console.log('calendar engine passed: seven tracks, pointer/keyboard creation, midnight, course drag/drop, semantic colors, real focus, desktop/mobile full table and list');await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
