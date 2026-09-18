// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node liquid-material-smoke.js
// Computed-style regression, complementary to appearance-browser-smoke.js and visual review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');
const controls = 'button,input:not([type=hidden]),textarea,select,option,summary,[role=button],[role=tab],[role=switch],[role=option],[data-task-id],[data-course-id],[data-project-id]';
const LIGHT_TOKENS = Object.freeze({
  '--bg':'#e9ecef','--surface':'rgba(244,247,249,.42)','--card':'rgba(246,248,249,.52)','--ink':'#20272d','--muted':'#657079','--accent':'#344f42','--accent-soft':'#e5ece6','--line':'rgba(101,112,121,.24)',
  '--q1':'#b42318','--q1-soft':'#fff0ee','--q2':'#b54708','--q2-soft':'#fff4e8','--q3':'#175cd3','--q3-soft':'#eef4ff','--q4':'#475467','--q4-soft':'#f2f4f7',
  '--liquid-fill':'rgba(244,247,249,.42)','--liquid-hover':'rgba(255,255,255,.52)','--liquid-selected':'rgba(176,190,201,.28)','--liquid-pressed':'rgba(176,190,201,.30)','--liquid-panel':'rgba(246,248,249,.52)','--liquid-dialog':'rgba(246,248,249,.83)','--liquid-paper':'rgba(246,248,249,.64)','--liquid-edge':'rgba(101,112,121,.24)','--liquid-highlight':'rgba(255,255,255,.70)','--liquid-shade':'rgba(58,69,77,.16)','--liquid-focus':'rgba(52,79,66,.35)','--liquid-focus-haze':'rgba(52,79,66,.15)','--liquid-glass-tint':'176 190 201','--liquid-tint-alpha':'.12','--liquid-clarity':'1','--liquid-shadow-opacity':'.10','--liquid-depth':'.35','--material-blur':'blur(20px) saturate(.78)'
});
const DARK_TOKENS = Object.freeze({
  '--bg':'#24282e','--surface':'rgba(60,69,81,.66)','--card':'rgba(96,110,128,.20)','--ink':'#e7e9eb','--muted':'#b4bbc3','--accent':'#b8c9d9','--accent-soft':'rgba(157,179,203,.16)','--line':'rgba(206,219,234,.17)',
  '--q1':'#e1a1ad','--q1-soft':'#4e3742','--q2':'#dbc297','--q2-soft':'#474236','--q3':'#a0c0e4','--q3-soft':'#33455d','--q4':'#c5b2da','--q4-soft':'#423b53',
  '--liquid-fill':'rgba(60,69,81,.42)','--liquid-hover':'rgba(96,110,128,.30)','--liquid-selected':'rgba(184,201,217,.29)','--liquid-pressed':'rgba(184,201,217,.34)','--liquid-panel':'rgba(60,69,81,.66)','--liquid-dialog':'rgba(60,69,81,.88)','--liquid-paper':'rgba(96,110,128,.20)','--liquid-edge':'rgba(206,219,234,.17)','--liquid-highlight':'rgba(224,233,243,.19)','--liquid-shade':'rgba(0,0,0,.36)','--liquid-focus':'rgba(184,201,217,.43)','--liquid-focus-haze':'rgba(184,201,217,.16)','--liquid-glass-tint':'184 201 217','--liquid-tint-alpha':'.12','--liquid-clarity':'1','--liquid-shadow-opacity':'.10','--liquid-depth':'.35','--material-blur':'blur(20px) saturate(.78)'
});
const LIGHT_TOUCH_TOKENS = Object.freeze({
  '--mobile-glass':'rgba(244,247,249,.62)','--mobile-glass-edge':'rgba(255,255,255,.82)','--mobile-glass-top':'rgba(255,255,255,.86)','--mobile-glass-bottom':'rgba(176,190,201,.15)',
  '--mobile-glass-shadow':'inset 0 1px 0 rgba(255,255,255,.92), inset 0 -1px 0 rgba(75,95,110,.13), 0 3px 8px -4px rgba(58,69,77,.21)',
  '--mobile-panel-shadow':'inset 0 1px 0 rgba(255,255,255,.90), inset 0 -1px 0 rgba(101,112,121,.14), 0 8px 20px -13px rgba(58,69,77,.28)',
  '--mobile-record-shadow':'inset 0 1px 0 rgba(255,255,255,.88), inset 0 -1px 0 rgba(101,112,121,.13), 0 2px 4px -1px rgba(58,69,77,.13)',
  '--mobile-record-top':'rgba(255,255,255,.69)','--mobile-record-bottom':'rgba(176,190,201,.055)','--mobile-record-base':'#f6f8f9','--mobile-tick':'#edf0f1',
  '--liquid-dialog':'rgba(246,248,249,.92)','--material-blur':'none'
});
const DARK_TOUCH_TOKENS = Object.freeze({
  '--mobile-glass':'rgba(60,69,81,.65)','--mobile-glass-edge':'rgba(206,219,234,.23)','--mobile-glass-top':'rgba(224,233,243,.16)','--mobile-glass-bottom':'rgba(0,0,0,.24)',
  '--mobile-glass-shadow':'inset 0 1px 0 rgba(224,233,243,.23), inset 0 -1px 0 rgba(0,0,0,.28), 0 3px 8px -3px rgba(0,0,0,.25)',
  '--mobile-panel-shadow':'inset 0 1px 0 rgba(224,233,243,.17), inset 0 -1px 0 rgba(0,0,0,.25), 0 8px 20px -12px rgba(0,0,0,.36)',
  '--mobile-record-shadow':'inset 0 1px 0 rgba(224,233,243,.24), inset 0 -1px 0 rgba(0,0,0,.23), 0 2px 4px -1px rgba(0,0,0,.24)',
  '--mobile-record-top':'rgba(224,233,243,.12)','--mobile-record-bottom':'rgba(0,0,0,.08)','--mobile-record-base':'#3c4551','--mobile-tick':'#2d333b',
  '--liquid-dialog':'rgba(60,69,81,.94)','--material-blur':'none'
});
const normalizeToken = value => value.replace(/\s+/g,'').replace(/0\.10\b/g,'.10');

async function audit(page, label, root = 'body') {
  await page.waitForTimeout(350); // Allow the shared view reveal animation to expose its controls.
  const result = await page.locator(root).evaluate((scope, selector) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const rgba = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
    const mobile = document.documentElement.dataset.materialPerformance === 'touch';
    const issues = []; let count = 0;
    for (const el of scope.querySelectorAll(selector)) {
      if (!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) || !el.getBoundingClientRect().height) continue;
      count++;
      const s = getComputedStyle(el), name = el.id || `${el.tagName}.${String(el.className).replace(/\s+/g,'.')}`;
      const bg = rgba(s.backgroundColor);
      const calendar = Boolean(el.closest('#scheduleView'));
      // Calendar uses a shared optical plane with semantic course and selected colors.
      // Sidebar rows keep one view-independent material (desktop suites: "Sidebar row material must match across views"),
      // so the flat-plane rule scopes to the calendar surface itself.
      if(calendar) {
        if(s.backdropFilter!=='none' || s.filter!=='none') issues.push(`${name}: per-control calendar filtering`);
        if(el.matches('[data-calendar-track]') && s.boxShadow!=='none') issues.push(`${name}: empty-track shadow`);
        if(bg[3]===255 && rgba(s.color).slice(0,3).every((v,i)=>Math.abs(v-bg[i])<20)) issues.push(`${name}: calendar foreground merges with background`);
      }
      if(!mobile && !calendar && bg[3] === 255) issues.push(`${name}: opaque background ${s.backgroundColor}`);
      const max = Math.max(...bg.slice(0,3)), min = Math.min(...bg.slice(0,3));
      if(!mobile && !calendar && bg[3]>32 && bg[1]>bg[0]*1.12 && bg[1]>bg[2]*1.12 && max-min>65) issues.push(`${name}: saturated green ${s.backgroundColor}`);
      for(const side of ['Top','Right','Bottom','Left']) {
        const border=rgba(s[`border${side}Color`]);
        if(!mobile && !calendar && parseFloat(s[`border${side}Width`])>0 && s[`border${side}Style`]!=='none' && border[3]>96) issues.push(`${name}: high-contrast ${side} border ${s[`border${side}Color`]}`);
      }
      if(el.type==='file') {
        const fileStyle=getComputedStyle(el,'::file-selector-button');
        if(!mobile && !calendar && rgba(fileStyle.backgroundColor)[3]===255) issues.push(`${name}: opaque file selector button`);
        if(!mobile && !calendar && parseFloat(fileStyle.borderTopWidth)>0 && rgba(fileStyle.borderTopColor)[3]>96) issues.push(`${name}: high-contrast file selector border`);
      }
      // Touch uses shared backdrop panels plus static glass bevels on records.
      // Dense hit cells must stay flat; pointer optics use one isolated canvas.
      if(mobile) {
        if(s.backdropFilter !== 'none' || s.filter !== 'none') issues.push(`${name}: mobile filtering`);
        if(el.matches('.calendar-time-cell,.schedule-cell') && s.boxShadow !== 'none') issues.push(`${name}: dense mobile shadow`);
        if(bg[3]===255 && rgba(s.color).slice(0,3).every((v,i)=>Math.abs(v-bg[i])<20)) issues.push(`${name}: foreground merges with background`);
      }
      if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName) && !['date','time','color','range'].includes(el.type) && s.appearance !== 'none') issues.push(`${name}: native appearance ${s.appearance}`);
    }
    const opaque = [...scope.querySelectorAll('*')].filter(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && el.getBoundingClientRect().height && rgba(getComputedStyle(el).backgroundColor)[3]===255).map(el=>`${el.id || el.tagName+'.'+String(el.className).replace(/\s+/g,'.')} (parent ${el.parentElement?.id || el.parentElement?.className}): ${getComputedStyle(el).backgroundColor}`);
    return {count,issues,opaque};
  }, controls);
  if(result.opaque.length && !label.startsWith('390/')) console.log(`${label} opaque background diagnostics: ${result.opaque.join('; ')}`);
  assert.ok(result.count > 0, `${label}: no controls sampled`);
  assert.deepEqual(result.issues, [], `${label}\n${result.issues.join('\n')}`);
  console.log(`${label}: ${result.count} visible controls`);
  if(process.env.FANGCUN_SCREENSHOT_DIR && !label.includes('future') && !label.includes('reduced') && !label.includes('no-backdrop')) {
    fs.mkdirSync(process.env.FANGCUN_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.FANGCUN_SCREENSHOT_DIR,label.replaceAll('/','-')+'.png')});
  }
}

(async () => {
  const server = http.createServer((req,res) => {
    const file = path.resolve(__dirname, '.' + new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(__dirname+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.woff2')?'font/woff2':'text/html'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const origin = `http://127.0.0.1:${server.address().port}`;
    for(const width of [1360,390]) for(const mode of ['light','dark']) {
      const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<500,isMobile:width<500,serviceWorkers:'block'});
      await context.addInitScript(mode=>{localStorage.setItem('fangcun-skin','liquid');localStorage.setItem('fangcun-theme',mode);},mode);
      const page = await context.newPage(), errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'?{configured:true,authenticated:true,user:{id:7,username:'material-test',role:'user'}}:{data:null,revision:0}}));
      await page.goto(origin);
      await page.waitForFunction(()=>document.getElementById('authGate').classList.contains('hidden'));
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'liquid');
      assert.equal(await page.evaluate(()=>document.body.classList.contains('dark')),mode==='dark');
      const label = `${width}/${mode}`;
      const baseTokens = mode === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
      const expectedTokens = width < 500 ? {...baseTokens, ...(mode === 'dark' ? DARK_TOUCH_TOKENS : LIGHT_TOUCH_TOKENS)} : baseTokens;
      const actual=await page.evaluate(tokens=>Object.fromEntries(Object.keys(tokens).map(key=>[key,getComputedStyle(document.body).getPropertyValue(key).trim()])),expectedTokens);
      for(const [key,expected] of Object.entries(expectedTokens)) assert.equal(normalizeToken(actual[key]),normalizeToken(expected),`${label}: ${key}`);
      if (width < 500) {
        // §2.5.1 touch budget rows: shared 12px capture, per-skin scrim, two-layer body background.
        const touchSpec = await page.evaluate(() => {
          const compact = value => value.replace(/\s+/g,'').replace(/0\.(\d)/g,'.$1');
          const top = document.querySelector('.topbar');
          const probeDialog = document.createElement('dialog'); document.body.append(probeDialog); probeDialog.showModal();
          const backdrop = getComputedStyle(probeDialog,'::backdrop').backgroundColor;
          probeDialog.close(); probeDialog.remove();
          const body = getComputedStyle(document.body);
          return { capture:compact(getComputedStyle(top).backdropFilter), backdrop:compact(backdrop),
            gradients:(body.backgroundImage.match(/gradient\(/g)||[]).length, bgColor:compact(body.backgroundColor) };
        });
        assert.equal(touchSpec.capture,'blur(12px)saturate(1.16)',`${label}: shared 12px topbar/dialog capture`);
        assert.equal(touchSpec.backdrop,mode==='dark'?'rgba(0,0,0,.36)':'rgba(32,39,45,.31)',`${label}: dialog::backdrop scrim`);
        assert.equal(touchSpec.gradients,2,`${label}: body keeps the two-layer gradient`);
        assert.equal(touchSpec.bgColor,mode==='dark'?'rgb(36,40,46)':'rgb(233,236,239)',`${label}: body background resolves var(--bg)`);
      }
      for(const view of ['today','matrix','schedule','projects','inbox']) {
        await page.evaluate(view=>document.querySelector(`.main-nav [data-view="${view}"]`).click(),view);
        await audit(page,`${label}/${view}`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}/${view}: horizontal overflow`);
      }
      // Real seeded task/project/course content, rendered by the production application.
      for(const [view,selector] of [['matrix','[data-task-id]'],['projects','[data-project-id]'],['schedule','[data-course-id]']]) {
        await page.evaluate(view=>document.querySelector(`.main-nav [data-view="${view}"]`).click(),view);
        if(view==='schedule') await page.locator('[data-schedule-mode=timetable]').click();
        assert.ok(await page.locator(selector).count()>0,`${label}: missing dynamic ${selector}`);
      }
      for(const [trigger,id] of [['openCreateBtn',width<500?'mobileCreateModal':'taskModal'],['addProjectBtn','projectModal'],['semesterSettingsBtn','semesterModal'],['calendarRulesBtn','calendarRulesModal'],['reminderSettingsBtn','remindersModal'],['cloudBtn','cloudModal'],['appearanceSettingsBtn','appearanceModal']]) {
        await page.evaluate(id=>document.getElementById(id).click(),trigger);
        await audit(page,`${label}/${id}`,`#${id}`);
        if(id==='cloudModal') for(const tab of ['account','calendar','files']) {
          await page.locator(`[data-sync-tab=${tab}]`).click(); await audit(page,`${label}/cloud/${tab}`,`#${id}`);
        }
        const select = page.locator(`#${id} .liquid-select-trigger`).first();
        if(await select.isVisible()) {
          await select.click();
          assert.ok(await page.locator('.liquid-select-menu:visible').count()>0,'Custom menu must open');
          await audit(page,`${label}/select-menu`,'.liquid-select-menu:visible');
          await page.keyboard.press('Escape');
          // The 160ms visual exit keeps the menu measurable; wait for it to settle instead of sampling mid-animation.
          await page.waitForFunction(() => [...document.querySelectorAll('.liquid-select-menu')].every(menu => menu.hidden || menu.getBoundingClientRect().width === 0), null, {timeout:2000});
          assert.equal(await page.locator('.liquid-select-menu:visible').count(),0);
        }
        await page.locator(`#${id} .close-button`).click();
      }
      await page.evaluate(()=>document.querySelector('.main-nav [data-view=schedule]').click());
      await page.locator('.landscape-schedule-menu summary').click();
      await page.locator('[data-landscape-schedule-action=course]').click();
      await audit(page,`${label}/courseModal`,'#courseModal');
      await page.locator('#courseModal .close-button').click();
      // Dense records keep their paper feedback and never mount decorative water.
      await page.evaluate(()=>document.querySelector('.main-nav [data-view=matrix]').click());
      const paperRecord=page.locator('.task-card').first();
      if(await paperRecord.isVisible()) {
        await paperRecord.hover();
        assert.equal(await paperRecord.locator('.liquid-lens').count(),0,'Dense task records must not receive water lenses');
      }
      // Future controls must inherit the material without requiring another selector whitelist.
      await page.evaluate(()=>{
        const box=document.createElement('section');box.id='materialFixture';
        box.innerHTML='<button>Future action</button><input aria-label="Future input"><textarea aria-label="Future note"></textarea><input type="checkbox" checked aria-label="Future check"><input type="radio" checked aria-label="Future radio"><input type="file" aria-label="Future file"><select aria-label="Future select"><option>One</option><option>Two</option></select><details><summary>Future disclosure</summary>Content</details><button role="switch" aria-checked="true">Future switch</button><button role="tab" aria-selected="true">Future tab</button>';
        document.body.append(box);
      });
      await audit(page,`${label}/future-controls`,'#materialFixture');
      const button=page.locator('#materialFixture button').first();
      await page.keyboard.press('Tab'); // Exercise keyboard focus, after earlier pointer clicks.
      await button.focus();
      const focus=await button.evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outlineStyle,width:parseFloat(s.outlineWidth),shadow:s.boxShadow};});
      assert.ok((focus.outline!=='none' && focus.width>0)||focus.shadow!=='none','Keyboard focus must be visible');
      await page.emulateMedia({reducedMotion:'reduce'});
      await button.hover();
      assert.equal(await page.locator('.liquid-lens').count(),0,'Reduced motion must remove animated lenses');
      await audit(page,`${label}/reduced-motion`,'#materialFixture');
      // Emulate unavailable filtering at the rendering layer, then ensure content and actions remain usable.
      await page.addStyleTag({content:'*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'});
      await button.click();
      await audit(page,`${label}/no-backdrop`,'#materialFixture');
      await page.evaluate(()=>{document.getElementById('materialFixture').remove();document.getElementById('appearanceSettingsBtn').click();});
      await page.locator('input[name=skin][value=classic]').check();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'classic');
      assert.equal(await page.locator('.liquid-select-trigger:visible').count(),0,'Classic must restore native selects');
      assert.equal(await page.locator('.liquid-lens').count(),0,'Classic must release liquid effects');
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log('Liquid material checks passed. Native system picker windows, shader appearance and perceptual contrast still require device/visual review.');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
