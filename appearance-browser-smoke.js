// Optional browser regression: FANGCUN_PLAYWRIGHT_MODULE=/path/to/playwright node appearance-browser-smoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://localhost').pathname;
    const file = path.join(__dirname,name === '/' ? 'index.html' : name);
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type',file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const screenshotDir=process.env.FANGCUN_SCREENSHOT_DIR;
    async function saveScreenshot(page,name,options={}) {
      if(!screenshotDir) return;
      fs.mkdirSync(screenshotDir,{recursive:true});
      await page.screenshot({path:path.join(screenshotDir,name),...options});
    }
    const todayScreens={
      classic:{light:'01-classic-light-today-1360.png',dark:'02-classic-dark-today-1360.png'},
      liquid:{light:'03-liquid-light-today-1360.png',dark:'04-liquid-dark-today-1360.png'},
    };
    for (const width of [1360,390]) {
      const context = await browser.newContext({ viewport:{ width,height:width<500?844:900 }, serviceWorkers:'block', hasTouch:width<500, isMobile:width<500 });
      const page = await context.newPage();
      const errors=[]; page.on('pageerror',error => errors.push(error.message));
      await page.route('**/api/**',route => {
        const url=new URL(route.request().url());
        const json=url.pathname === '/api/auth/session' ? {configured:true,authenticated:true,user:{id:7,username:'appearance-test',role:'user'}} : url.pathname === '/api/data' ? {data:null,revision:0} : {};
        return route.fulfill({json});
      });
      await page.goto(origin);
      await page.waitForFunction(() => document.getElementById('authGate').classList.contains('hidden'));
      async function settings() {
        if(width<500) await page.locator('#mobileMenu').click();
        await page.locator('#appearanceSettingsBtn').click();
      }
      async function checkDialog(id) {
        const dialog=page.locator(`#${id}`);
        assert.ok(await dialog.isVisible(),`${id} must open`);
        const animationBudget=await dialog.evaluate(el=>{
          // Dialog-level budget: staged child choreography and pointer optics keep their own contracts.
          const animations=el.getAnimations().filter(animation=>animation.playState==='running');
          const invalid=animations.flatMap(animation=>animation.effect?.getKeyframes?.()||[]).flatMap(frame=>Object.keys(frame)).filter(property=>!['opacity','transform','offset','computedOffset','composite','easing'].includes(property));
          return {count:animations.length,invalid};
        });
        assert.ok(animationBudget.count<=1,`${id} animation budget: ${animationBudget.count}`);
        assert.deepEqual(animationBudget.invalid,[],`${id} animation properties`);
        const geometry=await dialog.evaluate(el => {
          const rect=el.getBoundingClientRect();
          return {left:rect.left,right:rect.right,width:innerWidth,overflow:el.scrollWidth-el.clientWidth};
        });
        assert.ok(geometry.left>=-1 && geometry.right<=geometry.width+1 && geometry.overflow<=1,`${id}: ${JSON.stringify(geometry)}`);
      }
      async function checkSelected(selector) {
        // Sample after the 220ms background transition settles; strictEqual stays strict.
        await page.waitForTimeout(400);
        const states=await page.locator(selector).evaluateAll(elements=>elements.map(el=>{
          const probe=document.createElement('span');
          const calendar=Boolean(el.closest('#scheduleView'));
          const glass=document.documentElement.dataset.materialPerformance==='touch' && el.matches('.view-switch button.active,.day-strip button.active');
          probe.style.cssText=calendar ? 'background:var(--cal-selected);color:var(--cal-selected-ink)' : glass ? 'background:var(--accent-soft);color:var(--accent)' : 'background:var(--action-fill);color:var(--action-ink)';el.append(probe);
          const expected=getComputedStyle(probe),actual=getComputedStyle(el);
          const result={background:actual.backgroundColor,color:actual.color,fill:expected.backgroundColor,ink:expected.color};
          probe.remove();return result;
        }));
        assert.ok(states.length,`Missing selected control: ${selector}`);
        for(const state of states) {
          assert.equal(state.background,state.fill,selector);
          assert.equal(state.color,state.ink,selector);
          assert.notEqual(state.color,state.background,selector);
        }
      }
      async function checkDynamicFields(selector) {
        await page.waitForFunction(selector => {
          const node=document.querySelector(selector);
          const dialog=node?.closest('dialog');
          if(!dialog) return true;
          const optics='.material-light,.liquid-lens,.touch-material-layer';
          return !dialog.getAnimations({subtree:true}).some(animation=>animation.playState==='running' && !animation.effect?.target?.closest?.(optics));
        }, selector, {timeout:4000});
        const fields=await page.locator(selector).evaluateAll(elements=>elements.map(el=>el.classList.contains('liquid-select-native')?el.nextElementSibling:el).filter(el=>el.getBoundingClientRect().height && !['checkbox','radio'].includes(el.type)).map(el=>{
          const style=getComputedStyle(el);return {height:el.getBoundingClientRect().height,radius:style.borderRadius,border:style.borderTopWidth};
        }));
        assert.ok(fields.length,`Missing dynamic fields: ${selector}`);
        assert.ok(fields.every(f=>f.height>=44 && f.radius!=='0px' && f.border==='1px'),JSON.stringify(fields));
      }
      async function checkTaskScheduleMatrix() {
        const matrix={task:['due'],event:['start','end','location'],assignment:['due'],exam:['due'],review:['due']};
        for(const [type,visible] of Object.entries(matrix)) {
          await page.locator('#taskType').selectOption(type);
          const state=await page.locator('#taskForm [data-schedule-group]').evaluateAll(groups=>Object.fromEntries(groups.map(group=>[group.dataset.scheduleGroup,{hidden:group.hidden,aria:group.getAttribute('aria-hidden'),rendered:group.getBoundingClientRect().height>0}])));
          for(const group of ['start','end','location','due']) {
            assert.equal(state[group].hidden,!visible.includes(group),`${type}/${group} hidden state`);
            assert.equal(state[group].aria,visible.includes(group)?null:'true',`${type}/${group} aria-hidden state`);
            assert.equal(state[group].rendered,visible.includes(group),`${type}/${group} rendered state`);
          }
        }
        await page.locator('#taskType').selectOption('task');
        await page.locator('#taskDue').fill('2026-09-21');
        await page.locator('#taskDueTime').fill('10:30');
        await page.locator('#taskType').selectOption('event');
        assert.equal(await page.locator('#taskStartDate').inputValue(),'2026-09-21');
        assert.equal(await page.locator('#taskStartTime').inputValue(),'10:30');
        assert.equal(await page.locator('#taskEndDate').inputValue(),'2026-09-21');
        assert.equal(await page.locator('#taskEndTime').inputValue(),'');
        await page.locator('#taskType').selectOption('task');
        assert.equal(await page.locator('#taskDue').inputValue(),'2026-09-21');
        assert.equal(await page.locator('#taskDueTime').inputValue(),'10:30');
        await page.locator('#taskReminder').selectOption('__custom__');
        await page.locator('#taskReminderCustom').fill('15');
        assert.ok(await page.locator('#taskReminderCustomField').isVisible());
      }
      function rect(selector) {
        const node=document.querySelector(selector);
        if(!node) throw new Error(`Missing rect target: ${selector}`);
        const box=node.getBoundingClientRect();
        return {x:box.x,y:box.y,width:box.width,height:box.height};
      }
      const taskTypeValues=await page.locator('#taskType option').evaluateAll(options=>options.map(option=>option.value));
      assert.deepEqual(taskTypeValues,['task','event','assignment','exam','review']);
      for(const id of ['taskStartDate','taskStartTime','taskEndDate','taskEndTime','taskLocation','taskDue','taskDueTime']) {
        assert.equal(await page.locator(`#${id}`).count(),1,`Schedule input id must be unique: ${id}`);
      }
      for(const skin of ['classic','liquid']) for(const mode of ['light','dark']) {
        await settings();
        await page.locator(`input[name=skin][value=${skin}]`).check();
        await page.locator(`[name="appearance-theme"][value="${mode}"]`).check();
        await page.locator('#appearanceModal .primary-button').click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin),skin);
        await page.reload();
        await page.waitForFunction(() => document.getElementById('authGate').classList.contains('hidden'));
        assert.equal(await page.evaluate(() => document.body.classList.contains('dark')),mode==='dark');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin),skin);
        // All main views keep their shared rendering and fit their viewport.
        for(const view of ['today','matrix','schedule','projects','inbox']) {
          await page.evaluate(v => document.querySelector(`.main-nav [data-view="${v}"]`).click(),view);
          assert.equal(await page.locator('.view.active').count(),1);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
        }
        await page.evaluate(() => document.querySelector('.main-nav [data-view="today"]').click());
        if(width>500) await saveScreenshot(page,todayScreens[skin][mode]);
        await page.evaluate(() => document.querySelector('[data-view="schedule"]').click());
        await page.evaluate(()=>document.getElementById('currentWeekBtn').click());
        for(const [calendarMode,selected] of [['day','.day-strip button.active'],['year','.mini-days button.today'],['month','.month-day.today > header strong'],['week','.view-switch button.active']]) {
          await page.locator(`[data-schedule-mode=${calendarMode}]`).click();
          await checkSelected(selected);
          await checkSelected('.view-switch button.active');
        }
        if(width>500) {
          const cell=page.locator('.calendar-time-cell').first();
          const radius=await cell.evaluate(el=>getComputedStyle(el).borderRadius);
          await cell.hover();
          await page.waitForTimeout(150);
          assert.equal(await cell.evaluate(el=>getComputedStyle(el).borderRadius),radius);
          assert.equal(await cell.locator('.liquid-lens').count(),0,'Calendar must not mount a legacy lens per track');
          const rect=await cell.boundingBox();
          await cell.dispatchEvent('pointerdown',{pointerId:71,pointerType:'mouse',clientX:rect.x+8,clientY:rect.y+8,isPrimary:true});
          await page.waitForTimeout(150);
          assert.equal(await page.locator('.touch-material-layer canvas').count(),1,'Calendar shares one optical renderer');
          await cell.dispatchEvent('pointercancel',{pointerId:71});
        }
        await page.locator('.landscape-schedule-menu summary').click();
        await page.locator('[data-landscape-schedule-action=course]').click();
        await page.waitForFunction(() => { const dialog=document.getElementById('courseModal'); return Boolean(dialog && dialog.open && !dialog.getAnimations({subtree:true}).length); }, null, {timeout:4000});
        const metrics=await page.evaluate(() => {
          const form=document.getElementById('courseForm');
          const controls=[...form.querySelectorAll('.field input:not([type=checkbox]):not([type=radio]),.field select')];
          return controls.map(el=>el.classList.contains('liquid-select-native')?el.nextElementSibling:el).filter(el=>el.getBoundingClientRect().height).map(el=>({id:el.id,h:el.getBoundingClientRect().height, labelGap:el.getBoundingClientRect().top-el.closest('.field').getBoundingClientRect().top}));
        });
        assert.ok(metrics.every(m=>m.h>=44 && m.h<=47),JSON.stringify(metrics));
        assert.ok(metrics.every(m=>m.labelGap<40),JSON.stringify(metrics));
        const checkbox=await page.locator('#courseForm input[type=checkbox]').first().boundingBox();
        assert.ok(checkbox.width<=22 && checkbox.height<=22);
        await page.locator('#courseReminder').selectOption('__custom__');
        await page.locator('#courseReminderCustom').fill('10080');
        assert.ok(await page.locator('#courseReminderCustomField').isVisible());
        await page.locator('#courseModal .close-button').click();
        // Exercise real open handlers so dynamic settings controls are rendered.
        for(const [trigger,id] of [['openCreateBtn',width<500?'mobileCreateModal':'taskModal'],['addProjectBtn','projectModal'],['semesterSettingsBtn','semesterModal'],['calendarRulesBtn','calendarRulesModal'],['reminderSettingsBtn','remindersModal'],['cloudBtn','cloudModal']]) {
          await page.evaluate(id=>document.getElementById(id).click(),trigger);
          await checkDialog(id);
          if(id==='semesterModal') await checkDynamicFields('.time-slot-row input');
          if(id==='mobileCreateModal') {
            await page.locator('[data-mobile-create=task]').click();
            await checkDialog('taskModal');
            if(skin==='liquid' && mode==='light') {
              await page.locator('#taskType').selectOption('task');
              await saveScreenshot(page,'07-liquid-light-task-390.png');
              await page.locator('#taskType').selectOption('event');
              await saveScreenshot(page,'08-liquid-light-event-390.png');
              await page.locator('#taskType').selectOption('task');
              await page.locator('#taskReminder').selectOption('__custom__');
              await page.locator('#taskReminderCustom').fill('15');
              await saveScreenshot(page,'09-reminder-custom-390.png');
            }
            await page.locator('#taskModal .close-button').click();
          } else {
            if(id==='taskModal') {
              await checkTaskScheduleMatrix();
              if(skin==='liquid' && mode==='light') {
                await page.locator('#taskType').selectOption('task');
                if(width>500) await saveScreenshot(page,'05-liquid-light-task-1360.png');
                else await saveScreenshot(page,'07-liquid-light-task-390.png');
                await page.locator('#taskType').selectOption('event');
                if(width>500) await saveScreenshot(page,'06-liquid-light-event-1360.png');
                else await saveScreenshot(page,'08-liquid-light-event-390.png');
                if(width<500) {
                  await page.locator('#taskType').selectOption('task');
                  await page.locator('#taskReminder').selectOption('__custom__');
                  await page.locator('#taskReminderCustom').fill('15');
                  await saveScreenshot(page,'09-reminder-custom-390.png');
                }
              }
            }
            if(id==='cloudModal') for(const tab of ['account','calendar','files']) {
              await page.locator(`[data-sync-tab=${tab}]`).click();
              assert.ok(await page.locator(`[data-sync-panel=${tab}]`).isVisible());
              await checkDialog(id);
              if(tab==='files') {
                const style=await page.locator('#wordScheduleInput').evaluate(el=>{
                  const s=getComputedStyle(el,'::file-selector-button');return {height:s.minHeight,radius:s.borderRadius};
                });
                assert.equal(style.height,'40px');assert.notEqual(style.radius,'0px');
              }
            }
            await page.locator(`#${id} .close-button`).click();
          }
        }
        await page.evaluate(()=>{
          document.getElementById('quickInput').value='明天下午三点开设计评审会，重要，提前30分钟提醒';
          document.getElementById('quickAddForm').requestSubmit();
        });
        await checkDialog('smartCaptureModal');
        await checkDynamicFields('.smart-field input,.smart-field select');
        assert.ok(await page.locator('[data-smart-field=reminderMinutes]').count()>0);
        assert.ok(await page.locator('[data-smart-field=repeat]').count()>0);
        assert.ok(await page.locator('[data-smart-field=today]').count()>0);
        const arrowRepeats=await page.locator('.smart-field select').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundRepeat));
        assert.ok(arrowRepeats.every(value=>value.split(',').every(repeat=>repeat.trim()==='no-repeat')),`Smart selects must not tile their arrow image: ${arrowRepeats.join(';')}`);
        assert.ok(await page.locator('.smart-field select').evaluateAll(elements=>elements.every(el=>getComputedStyle(el).backgroundImage!=='none')),'Smart selects must retain a visible dropdown arrow');
        if(width>500 && skin==='liquid' && mode==='light') await saveScreenshot(page,'10-smart-two-drafts-1360.png');
        await page.locator('#smartCaptureModal .close-button').click();
      }
      await settings();
      await page.locator('input[name=skin][value=liquid]').check();
      await page.locator('[name="appearance-theme"][value="light"]').check();
      if(width>500) {
        await page.locator('#appearanceModal .primary-button').hover();
        await page.waitForTimeout(150);
        assert.ok(await page.locator('.liquid-lens').count()>0);
        // WebGL may be unavailable on a CI runner; CSS must remain operational.
        console.log('GPU canvas count:',await page.locator('.liquid-lens canvas').count());
        await page.locator('input[name=skin][value=classic]').check();
        assert.equal(await page.locator('.liquid-lens canvas').count(),0);
        await page.locator('input[name=skin][value=liquid]').check();
      }
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.deepEqual(await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return ['--motion-instant','--motion-press','--motion-fast','--motion-popover','--motion-modal','--motion-drawer'].map(name=>style.getPropertyValue(name).trim());}),['0ms','0ms','100ms','0ms','0ms','0ms']);
      await page.locator('#appearanceModal .primary-button').hover();
      if(width<500) await saveScreenshot(page,'12-liquid-reduced-focus-390.png');
      assert.equal(await page.locator('.liquid-lens').count(),0);
      await page.locator('input[name=skin][value=classic]').check();
      assert.equal(await page.locator('.liquid-lens canvas').count(),0);
      await page.locator('#appearanceModal .primary-button').click();
      // Existing theme shortcut updates the settings mode too.
      await page.evaluate(() => document.getElementById('themeBtn').click());
      await settings();
      assert.equal(await page.locator('#appearanceMode').inputValue(),await page.evaluate(() => document.body.classList.contains('dark')?'dark':'light'));
      assert.deepEqual(errors,[]);
      await context.close();
    }
    const fallback=await browser.newContext({serviceWorkers:'block'});
    await fallback.addInitScript(() => {
      localStorage.setItem('fangcun-skin','liquid');
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args) { return ['webgl','webgl2','experimental-webgl'].includes(type) ? null : original.call(this,type,...args); };
    });
    const page=await fallback.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',route=>route.fulfill({json:{configured:true,authenticated:false}}));
    await page.goto(origin);
    await page.locator('#authGateSubmit').hover();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.liquid-lens canvas').count(),0);
    assert.ok(await page.locator('.liquid-lens').count()>0);
    await page.goto(origin+'/privacy.html');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'liquid');
    await page.setViewportSize({width:390,height:600});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await page.evaluate(()=>getComputedStyle(document.body).overflowY!=='hidden'));
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    assert.ok(await page.evaluate(()=>scrollY>0),'Mobile privacy document must scroll');
    assert.deepEqual(errors,[]);
    await fallback.close();
    const admin=await browser.newContext({serviceWorkers:'block'});
    const adminPage=await admin.newPage();
    await adminPage.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session' ? {configured:true,authenticated:true,user:{id:1,username:'admin-test',role:'admin'}} : {users:[],registrationEnabled:false}}));
    await adminPage.goto(origin);
    await adminPage.waitForFunction(()=>document.body.classList.contains('admin-mode'));
    await adminPage.locator('#appearanceSettingsBtn').click();
    await adminPage.locator('input[name=skin][value=liquid]').check();
    await adminPage.locator('#appearanceMode').selectOption('dark');
    await adminPage.locator('#appearanceModal .primary-button').click();
    assert.ok(await adminPage.locator('#adminView').isVisible());
    await admin.close();
    console.log('Appearance browser checks passed: both skins/modes, desktop/mobile views, creation and settings dialogs, sync tabs, persistence, form geometry, reduced motion, renderer cleanup.');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
