// Real Chromium checks against the actual HTML and production styles/scripts.
// FANGCUN_PLAYWRIGHT_MODULE=/path/to/playwright node mobile-material-smoke.js
// Synthetic records and an optional native-bridge stub do not measure device FPS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');
const root = __dirname;
const output = path.join(root, 'release', 'qa', 'mobile-material-validation.json');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /<link[^>]+href="mobile-material\.css\?v=/, 'Production HTML must reference versioned mobile material CSS');
assert.ok(html.indexOf('mobile-material.css') < html.indexOf('xuan.css'), 'Mobile important layer must load before desktop material');

function collectPaint() {
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth
      && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const styles = [...document.querySelectorAll('body *')].filter(visible).map(element => ({ element, style:getComputedStyle(element) }));
  const dense = styles.filter(({element}) => element.matches('.calendar-time-cell,.schedule-cell,.course-block,.calendar-week-event,.calendar-list-item,.task-card,.complete-btn'));
  const paint = element => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return { class:element.className, blur:style.backdropFilter, shadow:style.boxShadow, image:style.backgroundImage,
      background:style.backgroundColor, border:style.borderLeftColor, color:style.color,
      transition:style.transitionDuration, animation:style.animationName, willChange:style.willChange };
  };
  const colors = selector => [...new Set([...document.querySelectorAll(selector)].map(element => getComputedStyle(element).backgroundColor))];
  return { profile:document.documentElement.dataset.materialPerformance, visibleElements:styles.length,
    visibleBlur:styles.filter(({style}) => style.backdropFilter !== 'none').length,
    unexpectedBlur:styles.filter(({element,style})=>style.backdropFilter!=='none' && !element.matches('.topbar,.week-toolbar,.mobile-bottom-nav,dialog[open]')).map(({element})=>element.className),
    visibleShadow:styles.filter(({style}) => style.boxShadow !== 'none').length,
    visibleWillChange:styles.filter(({style}) => style.willChange !== 'auto').length,
    visibleDense:dense.length, denseBlur:dense.filter(({style}) => style.backdropFilter !== 'none').length,
    denseShadow:dense.filter(({style}) => style.boxShadow !== 'none').length,
    cell:paint(document.querySelector('.calendar-time-cell')), course:paint(document.querySelector('.course-block')),
    task:paint(document.querySelector('.task-card')), listItem:paint(document.querySelector('.calendar-list-item.course')),
    board:paint(document.querySelector('.schedule-board-wrap')), courseColors:colors('.course-block'), listCourseColors:colors('.calendar-list-item.course') };
}

async function checkDialogsAndMenus(page, touch) {
  await page.evaluate(() => switchView('today'));
  if (touch) {
    await page.locator('#mobileMenu').click();
    assert.equal(await page.locator('#sidebar').isVisible(), true);
  }
  await page.locator('#appearanceSettingsBtn').click();
  assert.equal(await page.locator('#appearanceModal').isVisible(), true);
  assert.equal(await page.locator('#appearanceModal').evaluate(element => element.open), true);
  assert.equal(await page.locator('.appearance-mode-option').first().isVisible(), true);
  await page.locator('.appearance-mode-option').first().click();
  await page.locator('#appearanceModal .primary-button').click();
  assert.equal(await page.locator('#appearanceModal').evaluate(element => element.open), false);
  await page.evaluate(() => switchView('schedule'));
  const menu = page.locator('.landscape-schedule-menu');
  await menu.locator('summary').click();
  assert.equal(await menu.getAttribute('open'), '');
  assert.equal(await page.locator('[data-landscape-schedule-action="course"]').isVisible(), true);
  await page.locator('[data-landscape-schedule-action="course"]').click();
  assert.equal(await page.locator('#courseModal').isVisible(), true);
  await page.locator('#courseModal .close-button').click();
  assert.equal(await page.locator('#courseModal').evaluate(element => element.open), false);
}

(async () => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless:true });
    for (const [width, height, touch, android] of [[390,844,true,false], [844,390,true,false], [1360,900,false,true], [1360,900,false,false]]) {
      const context = await browser.newContext({ viewport:{width,height}, isMobile:touch, hasTouch:touch, serviceWorkers:'block' });
      if (android) await context.addInitScript(() => { window.FangcunNative = { syncReminders() {} }; });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => route.fulfill({ json:new URL(route.request().url()).pathname === '/api/auth/session'
        ? { configured:true, authenticated:true, user:{ id:7, username:'member-material', role:'user' } } : { data:null, revision:0 } }));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => document.getElementById('authGate').classList.contains('hidden'));
      assert.equal(await page.evaluate(() => [...document.styleSheets].some(sheet => sheet.href?.includes('/mobile-material.css'))), true);
      await page.evaluate(() => {
        const start = localISO(addDays(new Date(), -(new Date().getDay() + 6) % 7));
        data.semester = { ...data.semester, startDate:start, totalWeeks:20, showWeekend:true };
        data.courses = Array.from({length:42}, (_, i) => ({ id:'qa-course-' + i,
          name:['计算机和程序设计基础ALab 2 - Python as a Calculator','大学物理实验','微积分与线性代数','英语写作'][i % 4],
          day:i % 7 + 1, startSection:Math.floor(i / 7) * 2 + 1, endSection:Math.min(13, Math.floor(i / 7) * 2 + 2),
          weeks:Array.from({length:20}, (_, j) => j + 1), location:'E13-205', color:COURSE_PALETTE[i % COURSE_PALETTE.length], colorAuto:false }));
        data.tasks = Array.from({length:180}, (_, i) => ({ id:'qa-task-' + i,
          title:'计算机和程序设计基础A新作业：Lab 2 - Python as a Calculator ' + i, notes:'', due:localISO(addDays(new Date(), i % 7)), dueTime:'23:59',
          startDate:'', important:true, urgent:i % 2 === 0, quadrant:i % 2 === 0 ? 'q1' : 'q2', completed:false, type:'task', repeat:'none', createdAt:Date.now() }));
        displayedWeek = 1; displayedYear = new Date().getFullYear(); displayedMonth = new Date().getMonth(); displayedDay = localISO();
        renderAll(); switchView('schedule');
      });
      for (const skin of ['classic','liquid']) for (const theme of ['light','dark']) {
        await page.evaluate(({skin,theme}) => {
          document.documentElement.dataset.skin = skin; document.documentElement.dataset.mode = theme;
          document.body.classList.toggle('dark', theme === 'dark');
        }, {skin,theme});
        for (const mode of ['week','timetable','list','matrix']) {
          await page.evaluate(mode => {
            if (mode === 'matrix') switchView('matrix');
            else {
              switchView('schedule'); document.querySelector(`[data-schedule-mode="${mode === 'list' ? 'timetable' : mode}"]`).click();
              document.getElementById('calendarZoomFit').click();
              if (mode === 'list') document.getElementById('calendarListBtn').click();
            }
          }, mode);
          await page.waitForTimeout(150);
          const metrics = await page.evaluate(collectPaint);
          if (touch || android) {
            assert.ok(metrics.visibleBlur>0 && metrics.visibleBlur<=4, 'Shared glass backdrops must remain visible within a bounded budget');
            assert.deepEqual(metrics.unexpectedBlur, [], 'Only shared chrome captures the backdrop');
            assert.equal(metrics.denseBlur, 0, 'Course records do not capture a backdrop per item');
            if(mode!=='week')assert.ok(metrics.denseShadow>0, 'Glass bevels must remain on dense records');
            assert.equal(metrics.visibleWillChange, 0, 'Resting surfaces must not be permanently promoted');
            assert.match(metrics.board.image, /xuan|svg/, 'The shared paper substrate must remain');
            if (mode === 'week') { assert.equal(metrics.cell.image, 'none'); assert.equal(metrics.cell.transition, '0s'); }
            if (mode === 'timetable') { assert.match(metrics.course.image, /gradient/); assert.equal(metrics.courseColors.length, 8, 'Saved course colors remain distinct'); }
            if (mode === 'list') { assert.equal(metrics.listItem.animation, 'none'); assert.match(metrics.listItem.image, /gradient/); assert.equal(metrics.listCourseColors.length, 8, 'Readable list preserves course colors'); }
          }
          results.push({width,height,touch,android,skin,theme,mode,...metrics});
        }
        await checkDialogsAndMenus(page, touch);
      }
      await page.evaluate(() => { document.documentElement.dataset.skin = 'liquid'; switchView('today'); });
      const opticalTarget=page.locator(touch ? '#mobileNavCreate' : '#themeBtn');
      const opticalRect=await opticalTarget.boundingBox();
      await opticalTarget.dispatchEvent('pointerdown', {pointerType:touch ? 'touch' : 'mouse',pointerId:1,isPrimary:true,clientX:opticalRect.x+opticalRect.width/2,clientY:opticalRect.y+opticalRect.height/2});
      await page.waitForTimeout(100);
      const interaction = {lens:await page.locator('.liquid-lens').count(), light:await page.locator('.material-light').count(), canvas:await page.locator('canvas').count()};
      assert.deepEqual(interaction, touch || android ? {lens:0,light:0,canvas:1} : {lens:1,light:1,canvas:1});
      assert.deepEqual(errors, []);
      await page.evaluate(() => {Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.locator('.liquid-lens,.material-light,canvas').count(), 0, 'Visibility change releases decorations and WebGL surface');
      results.push({width,height,touch,android,interaction,dialogsAndMenus:true,visibilityReleased:true,errors});
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForTimeout(70);
      assert.equal(await page.locator('.liquid-lens,.material-light').count(), 0);
      await page.emulateMedia({forcedColors:'active'});
      if (touch || android) assert.equal(await page.locator('.today-section').first().evaluate(element => getComputedStyle(element).backgroundImage), 'none');
      await context.close();
    }
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, JSON.stringify({ testedAt:new Date().toISOString(), browser:'Chromium',
      fixture:{courses:42,tasks:180}, limitation:'Synthetic browser and simulated native bridge; not real-device FPS or APK validation.', results }, null, 2));
    console.log('Mobile materials: 48 paper/glass view/theme cases with touch optics enabled, desktop effects, course list colors, modal/menu visibility and resource cleanup passed.');
    console.log(path.relative(root, output));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
