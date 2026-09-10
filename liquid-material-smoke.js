// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node liquid-material-smoke.js
// Computed-style regression, complementary to appearance-browser-smoke.js and visual review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');
const controls = 'button,input:not([type=hidden]),textarea,select,option,summary,[role=button],[role=tab],[role=switch],[role=option],[data-task-id],[data-course-id],[data-project-id]';

async function audit(page, label, root = 'body') {
  await page.waitForTimeout(350); // Allow the shared view reveal animation to expose its controls.
  const result = await page.locator(root).evaluate((scope, selector) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const rgba = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
    const issues = []; let count = 0;
    for (const el of scope.querySelectorAll(selector)) {
      if (!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) || !el.getBoundingClientRect().height) continue;
      count++;
      const s = getComputedStyle(el), name = el.id || `${el.tagName}.${String(el.className).replace(/\s+/g,'.')}`;
      const bg = rgba(s.backgroundColor);
      if(bg[3] === 255) issues.push(`${name}: opaque background ${s.backgroundColor}`);
      const max = Math.max(...bg.slice(0,3)), min = Math.min(...bg.slice(0,3));
      if(bg[3]>32 && bg[1]>bg[0]*1.12 && bg[1]>bg[2]*1.12 && max-min>65) issues.push(`${name}: saturated green ${s.backgroundColor}`);
      for(const side of ['Top','Right','Bottom','Left']) {
        if(parseFloat(s[`border${side}Width`])>0 && s[`border${side}Style`]!=='none' && rgba(s[`border${side}Color`])[3]>0) issues.push(`${name}: visible ${side} border ${s[`border${side}Color`]}`);
      }
      if(el.type==='file') {
        const fileStyle=getComputedStyle(el,'::file-selector-button');
        if(rgba(fileStyle.backgroundColor)[3]===255) issues.push(`${name}: opaque file selector button`);
        if(parseFloat(fileStyle.borderTopWidth)>0 && rgba(fileStyle.borderTopColor)[3]>0) issues.push(`${name}: bordered file selector button`);
      }
      if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName) && !['date','time','color','range'].includes(el.type) && s.appearance !== 'none') issues.push(`${name}: native appearance ${s.appearance}`);
    }
    const opaque = [...scope.querySelectorAll('*')].filter(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && el.getBoundingClientRect().height && rgba(getComputedStyle(el).backgroundColor)[3]===255).map(el=>`${el.id || el.tagName+'.'+String(el.className).replace(/\s+/g,'.')} (parent ${el.parentElement?.id || el.parentElement?.className}): ${getComputedStyle(el).backgroundColor}`);
    return {count,issues,opaque};
  }, controls);
  if(result.opaque.length) console.log(`${label} opaque background diagnostics: ${result.opaque.join('; ')}`);
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
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'); fs.createReadStream(file).pipe(res);
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
      for(const view of ['today','matrix','schedule','projects','inbox']) {
        await page.evaluate(view=>document.querySelector(`.main-nav [data-view="${view}"]`).click(),view);
        await audit(page,`${label}/${view}`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}/${view}: horizontal overflow`);
      }
      // Real seeded task/project/course content, rendered by the production application.
      for(const [view,selector] of [['matrix','[data-task-id]'],['projects','[data-project-id]'],['schedule','[data-course-id]']]) {
        await page.evaluate(view=>document.querySelector(`.main-nav [data-view="${view}"]`).click(),view);
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
          assert.equal(await page.locator('.liquid-select-menu:visible').count(),0);
        }
        await page.locator(`#${id} .close-button`).click();
      }
      await page.evaluate(()=>document.querySelector('.main-nav [data-view=schedule]').click());
      await page.locator('.landscape-schedule-menu summary').click();
      await page.locator('[data-landscape-schedule-action=course]').click();
      await audit(page,`${label}/courseModal`,'#courseModal');
      await page.locator('#courseModal .close-button').click();
      // Future controls must inherit the material without requiring another selector whitelist.
      await page.evaluate(()=>{
        const box=document.createElement('section');box.id='materialFixture';
        box.innerHTML='<button>Future action</button><input aria-label="Future input"><textarea aria-label="Future note"></textarea><input type="checkbox" checked aria-label="Future check"><input type="radio" checked aria-label="Future radio"><input type="file" aria-label="Future file"><select aria-label="Future select"><option>One</option><option>Two</option></select><details><summary>Future disclosure</summary>Content</details><button role="switch" aria-checked="true">Future switch</button><button role="tab" aria-selected="true">Future tab</button>';
        document.body.append(box);
      });
      await audit(page,`${label}/future-controls`,'#materialFixture');
      const button=page.locator('#materialFixture button').first();
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
