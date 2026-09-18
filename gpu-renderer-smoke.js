// Isolated renderer lifecycle / pixel checks; no application data is loaded.
// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node gpu-renderer-smoke.js
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = process.env.FANGCUN_SCREENSHOT_DIR || path.join(__dirname, 'release', 'qa');
  fs.mkdirSync(output, { recursive:true });
  const source = fs.readFileSync(path.join(__dirname, 'liquid-renderer.js'));
  const server = http.createServer((request, response) => {
    if (request.url === '/liquid-renderer.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(source); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { margin:24px;background:linear-gradient(130deg,#d0d8da,#f3f2ed);font:15px system-ui,sans-serif;color:#234; }
        .surface { position:relative;box-sizing:border-box;margin:18px 0;padding:24px;width:360px;height:520px;
          border-radius:24px;background:linear-gradient(150deg,#ffffffad,#d9e4e799);
          box-shadow:0 14px 35px #30455320,inset 0 1px #fff; }
        .ripple-fixture { display:flex;align-items:center;gap:24px;margin:18px 0;padding:18px;border:1px solid #78909c55;border-radius:18px;background:#ffffff66; }
        .ripple-sample { display:grid;place-items:center;border:1px solid #526b75aa;border-radius:14px;background:radial-gradient(circle at 48% 42%,#fff8,transparent 62%),#c9d8dc;box-shadow:inset 0 1px #fff,0 8px 18px #30455322; }
        .ripple-small { width:44px;height:44px;border-radius:12px;font-size:10px; }
        .ripple-large { width:180px;height:180px; }
        h2 { font-weight:500; } p { line-height:1.6; } #paper { display:none;background:linear-gradient(150deg,#f9f6ed,#ede9df); }
      </style>
      <div id="rippleFixture" class="ripple-fixture"><div class="ripple-sample ripple-large">180px</div><div class="ripple-sample ripple-small">44px</div></div>
      <div id="glass" class="surface"><h2>Glass · 光与波纹</h2><p>局部高光随指尖移动，按下后光圈展开。</p></div>
      <div id="paper" class="surface"></div>
      <script type="module">
        import { createRenderer, rippleProfile } from '/liquid-renderer.js';
        window.renderer = createRenderer();
        window.rippleProfile = rippleProfile;
        window.paperRoot = document.getElementById('paper').attachShadow({mode:'open'});
        paperRoot.innerHTML='<h2 style="font-weight:500">Paper · 纸面柔光</h2><p>光泽缓慢散开，保留纸面质感。</p>';
        window.mountRippleFixture = () => {
          const specs = [['.ripple-large',180],['.ripple-small',44]];
          const renderers = specs.map(([selector,size]) => {
            const renderer=createRenderer();
            renderer.mount(document.querySelector(selector),{width:size,height:size},{kind:'glass',radius:size<80?12:14});
            return renderer;
          });
          specs.forEach(([selector],index)=>document.querySelector(selector).addEventListener('pointerdown',event=>{
            const rect=event.currentTarget.getBoundingClientRect();
            renderers[index].move((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
            renderers[index].pulse(.5,.5,'ripple');
          }));
          return renderers;
        };
        window.ready = true;
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport:{width:1360,height:900}, deviceScaleFactor:3 });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const profileSamples = await page.evaluate(() => [32,44,80,180].map(size => rippleProfile(size,size)));
    const expectedProfiles = [
      {amplitude:.14,radius:4,damping:.976,edgeAbsorption:.48},
      {amplitude:.15604445936074865,radius:5.279999999999999,damping:.9762052198290329,edgeAbsorption:.4751493494955876},
      {amplitude:.3527036898110675,radius:9.6,damping:.9787206285906066,edgeAbsorption:.4156942333129331},
      {amplitude:1,radius:10,damping:.987,edgeAbsorption:.21999999999999997}
    ];
    for (let i=0;i<expectedProfiles.length;i++) for (const key of Object.keys(expectedProfiles[i])) assert.ok(Math.abs(profileSamples[i][key]-expectedProfiles[i][key]) <= 1e-12, `profile ${[32,44,80,180][i]} ${key}`);
    const initial = await page.evaluate(() => {
      renderer.mount(document.getElementById('glass'), {width:360,height:520}, {radius:24});
      renderer.move(.54,.43); renderer.pulse(.54,.43,"ripple");
      return renderer.getStats();
    });
    assert.equal(initial.specVersion, '2026-09-15-lab-align-v1');
    assert.equal(initial.energyEpsilon, 0.00001);
    for (const [name, value] of Object.entries({rippleStrength:.74,trailStrength:.10,trailDecay:.76,edgeStrength:2,edgeSizeInfluence:.89,edgeSpread:.17,edgeSpeedResponse:1.5})) assert.equal(initial.motion[name], value, `motion ${name}`);
    assert.equal(initial.motion.rippleStrength, .74);
    assert.equal(initial.profile.amplitude, 1);
    const copiedStats = await page.evaluate(() => {
      const stats = renderer.getStats(); stats.motion.rippleStrength = 0; stats.profile.amplitude = 0;
      const next = renderer.getStats();
      let invalid = false;
      try { renderer.pulse(.5,.5,'invalid'); } catch (error) { invalid = error instanceof TypeError; }
      return {rippleStrength:next.motion.rippleStrength, amplitude:next.profile.amplitude, invalid};
    });
    assert.equal(copiedStats.rippleStrength, .74, 'stats motion must be a copy');
    assert.equal(copiedStats.amplitude, 1, 'stats profile must be a copy');
    assert.equal(copiedStats.invalid, true, 'pulse rejects unknown kinds');
    assert.ok(initial.pixelCount <= 1400000, 'large surfaces obey a pixel budget');
    assert.ok(initial.pixelRatio > 2, 'the budget retains high density on a phone-size surface');
    assert.equal(initial.resizes, 1);
    await page.waitForTimeout(100);
    const pixels = await page.evaluate(() => new Promise(resolve => {
      renderer.move(.54,.43);
      requestAnimationFrame(() => {
        const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl');
        const rgba = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        let visible = 0, maxAlpha = 0;
        for (let i=3; i<rgba.length; i+=4) {
          if (rgba[i] > 0) visible++;
          maxAlpha = Math.max(maxAlpha, rgba[i]);
        }
        resolve({visible, maxAlpha, cornerAlpha:rgba[3], error:gl.getError()});
      });
    }));
    assert.ok(pixels.visible > 1000, 'the shader produces visible light');
    assert.ok(pixels.maxAlpha > 10, 'the light has measurable opacity');
    assert.equal(pixels.cornerAlpha, 0, 'rounded corners clip the light');
    assert.equal(pixels.error, 0);
    await page.evaluate(() => {
      window.fixtureRenderers=window.mountRippleFixture();
      for(const node of document.querySelectorAll('#rippleFixture .ripple-sample')) {
        const rect=node.getBoundingClientRect();
        node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,isPrimary:true,pointerType:'mouse',clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));
      }
    });
    await page.waitForTimeout(80);
    await page.screenshot({path:path.join(output, '11-liquid-ripple-sizes-1360.png')});
    await page.evaluate(() => { window.fixtureRenderers.forEach(renderer=>renderer.dispose()); delete window.fixtureRenderers; });
    await page.screenshot({path:path.join(output, 'touch-shader-glass.png')});
    const sameSize = await page.evaluate(() => {
      renderer.mount(document.getElementById('glass'), {width:360,height:520}, {radius:24});
      return renderer.getStats();
    });
    assert.equal(sameSize.resizes, 1, 'same dimensions do not reallocate the buffer');
    assert.equal(sameSize.mounts, 1, 'same parent does not move the canvas');
    await page.waitForFunction(() => renderer.getStats().running === false, {timeout:4000});
    await page.waitForTimeout(200);
    const idle = await page.evaluate(() => renderer.getStats());
    await page.waitForTimeout(200);
    const idleAgain = await page.evaluate(() => renderer.getStats());
    assert.equal(idle.running, false, 'the loop stops after the optical tail');
    assert.equal(idle.drawCount, idleAgain.drawCount, 'no draws occur while idle');
    const paper = await page.evaluate(() => {
      document.getElementById('glass').style.display = 'none';
      document.getElementById('paper').style.display = 'block';
      renderer.mount(paperRoot, {width:360,height:520}, {kind:'paper',radius:24});
      renderer.move(.43,.30); renderer.pulse(.43,.30,"ripple");
      return renderer.getStats();
    });
    assert.equal(paper.mounts, 2, 'one renderer moves into a ShadowRoot');
    assert.equal(paper.resizes, 1, 'switching to the same size reuses storage');
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length + paperRoot.querySelectorAll('canvas').length), 1);
    await page.waitForTimeout(120);
    await page.screenshot({path:path.join(output, 'touch-shader-paper.png')});
    const button = await page.evaluate(() => {
      renderer.mount(paperRoot, {width:44,height:44}, {kind:'glass',radius:22,dark:true});
      renderer.pulse(.5,.5,"ripple");
      return renderer.getStats();
    });
    assert.equal(button.pixelRatio, 3, 'small controls keep the device pixel ratio');
    assert.equal(button.pixelCount, 132 * 132);
    const hidden = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {value:true,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
      renderer.move(.3,.3);
      const result = renderer.getStats();
      delete document.hidden;
      return result;
    });
    assert.equal(hidden.running, false, 'a hidden page cannot schedule animation');
    await page.evaluate(() => {
      renderer.move(.5,.5);
      window.contextExtension = paperRoot.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
      assertContextExtension();
      function assertContextExtension() { if (!contextExtension) throw new Error('Context loss test extension unavailable'); }
      contextExtension.loseContext();
    });
    await page.waitForFunction(() => renderer.getStats().lost);
    const lost = await page.evaluate(() => renderer.getStats());
    assert.equal(lost.running, false, 'context loss cancels pending frames');
    await page.evaluate(() => contextExtension.restoreContext());
    await page.waitForFunction(() => renderer.getStats().contextRestores === 1);
    const restored = await page.evaluate(() => renderer.getStats());
    assert.equal(restored.lost, false, 'the GPU resources can be rebuilt');
    await page.waitForTimeout(40);
    const restoredIdle = await page.evaluate(() => renderer.getStats());
    assert.equal(restoredIdle.drawCount, lost.drawCount, 'a restored context waits for new input');
    assert.equal(restoredIdle.running, false, 'a restored context schedules no idle frames');
    await page.evaluate(() => { renderer.move(.5,.5); renderer.pulse(.5,.5,'ripple'); });
    await page.waitForFunction(count => renderer.getStats().drawCount > count, lost.drawCount, {timeout:4000});
    const disposed = await page.evaluate(() => { renderer.dispose(); return renderer.getStats(); });
    assert.equal(disposed.running, false);
    assert.equal(disposed.disposed, true);
    assert.equal(await page.evaluate(() => paperRoot.querySelectorAll('canvas').length), 0);
    assert.deepEqual(errors, []);
    assert.ok(!requests.some(request => request.includes('three')), 'there is no Three.js dependency');
    const report = { backend:'Chromium SwiftShader (functional verification, not a phone FPS benchmark)',
      rendererBytes:source.length, profileSamples, initial, pixels, sameSize, idle, idleAgain, paper, button, hidden, lost, restored, disposed, requests, errors };
    fs.writeFileSync(path.join(output, 'touch-shader-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`gpu-renderer-smoke: passed; ${initial.pixelCount} pixels; idle draws ${idle.drawCount} -> ${idleAgain.drawCount}; context restored`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
