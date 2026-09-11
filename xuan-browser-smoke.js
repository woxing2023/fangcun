// Uses the production server and a disposable database; no runtime dependencies.
// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node xuan-browser-smoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fangcun-xuan-test-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname, stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: data,
      FANGCUN_PASSWORD: 'isolated-material-test', COOKIE_SECURE: 'false', NODE_NO_WARNINGS: '1' }
  });
  const exited = new Promise(resolve => server.once('exit', resolve));
  let browser;
  try {
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('Test server exited');
      if (await fetch(origin + '/api/health').then(r => r.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [[1536,1024], [1024,768], [390,844], [844,390]]) {
      const context = await browser.newContext({ viewport: { width, height },
        isMobile: width < 961, hasTouch: width < 961, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      // UI fixtures are scoped to this context; assets come from server.js.
      await page.route('**/api/**', route => route.fulfill({ json:
        new URL(route.request().url()).pathname === '/api/auth/session'
          ? { configured:true, authenticated:true, user:{ id:7, username:'member-material', role:'user' } }
          : { data:null, revision:0 } }));
      await page.goto(origin);
      await page.waitForFunction(() => document.getElementById('authGate').classList.contains('hidden'));
      for (const skin of ['classic','liquid']) for (const mode of ['light','dark']) {
        await page.evaluate(({skin,mode}) => {
          document.documentElement.dataset.skin = skin;
          document.documentElement.dataset.mode = mode;
          document.body.classList.toggle('dark', mode === 'dark');
        }, { skin, mode });
        for (const view of ['today','matrix','schedule','projects','inbox']) {
          await page.evaluate(view => document.querySelector(`.main-nav [data-view="${view}"]`).click(), view);
          await page.waitForTimeout(300);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${skin}/${mode}/${view}: overflow`);
        }
        await page.evaluate(() => document.querySelector('.main-nav [data-view=today]').click());
        const paint = await page.locator('.today-section').first().evaluate(el => {
          const style = getComputedStyle(el);
          const button = el.querySelector('button');
          return { image:style.backgroundImage, blur:style.backdropFilter,
            controlImage:getComputedStyle(button).backgroundImage, touch:document.documentElement.dataset.materialPerformance==='touch' };
        });
        const checkPaper = image => {
          assert.match(image, /xuan-fibers-mobile\.png/);
          assert.doesNotMatch(image, /filter|feTurbulence/);
        };
        checkPaper(paint.image);
        assert.equal(paint.blur, 'none');
        assert.doesNotMatch(paint.controlImage, /xuan-fibers/);
        await page.evaluate(() => {
          const host = document.createElement('section');
          host.id='material-extension'; host.dataset.material='xuan';
          host.innerHTML='<p>Material extension</p><button id="material-child">Action</button>';
          document.querySelector('.today-section').append(host);
          host.querySelector('button').onclick = e => e.currentTarget.dataset.clicked='yes';
        });
        checkPaper(await page.locator('#material-extension').evaluate(el=>getComputedStyle(el).backgroundImage));
        await page.locator('#material-child').click();
        assert.equal(await page.locator('#material-child').getAttribute('data-clicked'), 'yes');
        assert.doesNotMatch(await page.locator('#material-child').evaluate(el=>getComputedStyle(el).backgroundImage), /xuan-fibers/);
        await page.locator('#material-extension').evaluate(el=>el.remove());
        if (width === 1536) {
          const panel=page.locator('.today-next');
          await panel.hover({position:{x:20,y:20}});
          await page.waitForTimeout(180); // Allow hover's automatic scroll to settle.
          await panel.hover({position:{x:30,y:25}});
          await page.waitForTimeout(80);
          assert.equal(await page.locator('.material-light').count(),1);
          assert.equal(await page.locator('.material-light').getAttribute('aria-hidden'),'true');
          assert.equal(await page.locator('.material-light').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
          const button=page.locator('#themeBtn');
          await button.scrollIntoViewIfNeeded();
          await page.waitForTimeout(180);
          const before=await button.boundingBox();
          await button.hover(); await page.waitForTimeout(80);
          const after=await button.boundingBox();
          assert.deepEqual(after,before,'Optical movement must not move the hit target');
          assert.equal(await button.locator('.material-light-glass').count(),1);
          const complete=page.locator('.focus-task .complete-btn').first();
          await complete.hover(); await page.waitForTimeout(180);
          await complete.hover({position:{x:12,y:12}}); await page.waitForTimeout(80);
          const circle=await complete.boundingBox(), light=await complete.locator('.material-light').boundingBox();
          assert.ok(light && Math.abs(light.width-circle.width)<=4 && Math.abs(light.height-circle.height)<=4,
            'Completion light must stay inside its circle, not cover the task row');
        }
        await page.emulateMedia({ forcedColors:'active', reducedMotion:'reduce' });
        assert.equal(await page.locator('.today-section').first().evaluate(el=>getComputedStyle(el).backgroundImage), 'none');
        await page.waitForTimeout(50);
        assert.equal(await page.locator('.material-light').count(),0);
        await page.emulateMedia({ forcedColors:'none', reducedMotion:'no-preference' });
        console.log(`Xuan ${width}x${height} ${skin}/${mode}: panels, actions, navigation, forced colors OK`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    const offline = await browser.newContext();
    const page = await offline.newPage();
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The application reloads itself on controllerchange; don't race that navigation.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.waitForLoadState('load');
    const asset = await page.request.get(origin + '/xuan-fibers.svg?v=1');
    assert.equal(asset.status(), 200);
    assert.match(asset.headers()['content-type'], /image\/svg\+xml/);
    const baked = await page.request.get(origin + '/xuan-fibers-mobile.png?v=1');
    assert.equal(baked.status(),200); assert.match(baked.headers()['content-type'],/image\/png/);
    await offline.setOffline(true);
    const result = await page.evaluate(async () => {
      const css = await fetch('/xuan.css?v=3').then(r => r.text());
      const image = new Image(); image.src='/xuan-fibers.svg?v=1'; await image.decode();
      const baked = new Image(); baked.src='/xuan-fibers-mobile.png?v=1'; await baked.decode();
      const optics = await import('/liquid-renderer.js');
      const touch = await fetch('/touch-material.js?v=2').then(r=>r.text());
      const app = await fetch('/app.js?v=2.7.0').then(r => r.text());
      const mobile=await Promise.all(['mobile-ui.css?v=2','mobile-material.css?v=2','mobile-calendar.css?v=1','calendar-surface.css?v=1','appearance-controls.js?v=1'].map(name=>fetch('/'+name).then(r=>r.ok)));
      const fonts=await Promise.all(['xuan-sans','xuan-serif'].map(async name=>{
        const face=new FontFace(name,`url(/${name}.woff2?v=2)`); await face.load(); return face.status;
      }));
      return { css:css.includes('--xuan-base'), image:image.naturalWidth, baked:baked.naturalWidth, optics:typeof optics.createRenderer, touch:touch.includes('FangcunTouchMaterial'), build:app.includes('20260911-calendar-v3'), mobile, fonts };
    });
    assert.deepEqual(result, { css:true, image:360, baked:720, optics:'function', touch:true, build:true, mobile:[true,true,true,true,true], fonts:['loaded','loaded'] });
    await offline.close();
    console.log('Xuan production static routes, SVG/PNG/font decoding and touch renderer and PWA offline cache OK');
  } finally {
    await browser?.close(); server.kill(); await exited;
    fs.rmSync(data, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode=1; });
