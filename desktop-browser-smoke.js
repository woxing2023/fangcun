'use strict';
// Optional Chromium checks; dependency-free invariants run in desktop-material-smoke.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const server = http.createServer((req,res) => {
    const file = path.resolve(__dirname, '.' + new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser, scenarios = 0;
  try {
    browser = await chromium.launch({headless:true});
    for (const skin of ['classic','liquid']) for (const mode of ['light','dark']) {
      const context = await browser.newContext({viewport:{width:1360,height:900},serviceWorkers:'block'});
      await context.addInitScript(({skin,mode}) => {localStorage.setItem('fangcun-skin',skin);localStorage.setItem('fangcun-theme',mode);}, {skin,mode});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-09-13T11:00:00'));
      await page.route('**/api/**', route => route.fulfill({json:new URL(route.request().url()).pathname === '/api/auth/session' ? {configured:true,authenticated:true,user:{id:7,username:'member-test',role:'user'}} : {data:null,revision:0,tokens:[],audit:[]}}));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => document.getElementById('authGate').classList.contains('hidden'));
      const quick = () => page.locator('#quickInput').evaluate(el => { const s=getComputedStyle(el); return {bg:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,blur:s.backdropFilter}; });
      const plain = {bg:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none',blur:'none'};
      assert.deepEqual(await quick(), plain, 'Quick-add must have one outer frame');
      const navStyle = () => page.locator('.main-nav [data-view=projects]').evaluate(el => {
        const s=getComputedStyle(el); return [s.backgroundColor,s.backgroundImage,s.borderRadius,s.boxShadow,s.fontSize];
      });
      await page.mouse.move(1250,850); await page.waitForTimeout(300);
      const todayStyle = await navStyle();
      await page.evaluate(() => document.querySelector('.main-nav [data-view=schedule]').click());
      await page.locator('[data-schedule-mode=week]').click();
      await page.waitForTimeout(350);
      assert.deepEqual(await navStyle(), todayStyle, 'Sidebar row material must match across views');
      assert.ok(await page.locator('.sidebar-note').isVisible(), 'Desktop calendar retains focus card');
      if (skin==='classic') assert.equal(await page.locator('.sidebar .nav-item.active').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(63, 98, 168)','Classic selected row retains blue capsule');
      // Exercise the same input if mounted inside the calendar subtree in future.
      assert.deepEqual(await page.evaluate(() => {
        const form=document.getElementById('quickAddForm'), parent=form.parentNode, next=form.nextSibling;
        document.getElementById('scheduleView').append(form);
        const s=getComputedStyle(document.getElementById('quickInput'));
        const result={bg:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,blur:s.backdropFilter};
        parent.insertBefore(form,next); return result;
      }), plain);
      assert.ok(await page.locator('#scheduleView .dim').count()>0, 'Past courses must dim in week mode');
      if (process.env.FANGCUN_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.FANGCUN_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.FANGCUN_SCREENSHOT_DIR,`sidebar-${skin}-${mode}.png`)});
      }
      await page.locator('#calendarListBtn').click();
      assert.ok(await page.locator('.calendar-list-item.course.dim').count()>0, 'Past courses must dim in list mode');
      if (process.env.FANGCUN_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FANGCUN_SCREENSHOT_DIR,`calendar-list-${skin}-${mode}.png`)});
      await page.evaluate(() => {document.querySelector('.main-nav [data-view=today]').click();document.getElementById('openCreateBtn').click();});
      const input=page.locator('#taskTitle');
      await input.waitFor({state:'visible'}); await page.waitForTimeout(250);
      await input.hover(); await page.waitForTimeout(80);
      await page.evaluate(() => {window.__lens=document.querySelector('#taskModal .liquid-lens');});
      const before=await page.locator('#taskModal').boundingBox();
      await page.waitForTimeout(1300);
      await input.hover();
      if (skin==='liquid') assert.ok(await page.evaluate(() => window.__lens && window.__lens===document.querySelector('#taskModal .liquid-lens')), 'Idle hover must retain exact lens');
      assert.deepEqual(await page.locator('#taskModal').boundingBox(), before, 'Lens must not change modal geometry');
      await input.click(); await input.fill('桌面编辑验证'); await input.press('End'); await input.press('!');
      assert.equal(await input.inputValue(),'桌面编辑验证!');
      const optics = await page.locator('#taskModal').evaluate(dialog => {
        const visible=[dialog,...dialog.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().width>0);
        return {planes:visible.filter(el=>getComputedStyle(el).backdropFilter!=='none').map(el=>el.id || el.className), hit: (()=> {const el=document.getElementById('taskTitle'),r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})(), passive:[...dialog.querySelectorAll('.liquid-lens,.liquid-lens *')].every(el=>getComputedStyle(el).pointerEvents==='none')};
      });
      assert.deepEqual(optics.planes, skin==='liquid'?['taskModal']:[], 'Only liquid dialog panel carries blur');
      assert.ok(optics.hit && optics.passive,'Click must reach the real input');
      if (skin==='liquid') {
        const trigger=page.locator('#taskModal .liquid-select-trigger').first();
        await trigger.click();
        const option=page.locator('.liquid-select-menu:visible [role=option]').last();
        await option.click();
        assert.equal(await page.locator('.liquid-select-menu:visible').count(),0,'Select click must commit and close');
      } else await page.locator('#taskModal select').first().selectOption({index:0});
      if (process.env.FANGCUN_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FANGCUN_SCREENSHOT_DIR,`dialog-${skin}-${mode}.png`)});
      await page.locator('#taskModal .close-button').click();
      assert.equal(await page.locator('#taskModal').isVisible(),false);
      await page.setViewportSize({width:700,height:800});
      await page.evaluate(() => document.getElementById('openCreateBtn').click());
      // Narrow desktop follows the existing compact shell and creation chooser.
      if (await page.locator('#mobileCreateModal').isVisible()) await page.locator('[data-mobile-create=task]').click();
      await page.locator('#taskTitle').fill('窄窗口编辑');
      await page.locator('#taskModal .close-button').click();
      assert.deepEqual(errors,[]);
      scenarios++; await context.close();
    }
    console.log(`Desktop browser checks passed: ${scenarios} skin/mode scenarios; stable modal geometry, real input/select clicks, single blur plane, matching sidebar, single quick-add frame, narrow desktop.`);
  } finally {await browser?.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
