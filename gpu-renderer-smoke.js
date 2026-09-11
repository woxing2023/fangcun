// Isolated renderer lifecycle / pixel checks; no application data is loaded.
// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node gpu-renderer-smoke.js
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = path.join(__dirname, 'release', 'qa');
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
        h2 { font-weight:500; } p { line-height:1.6; } #paper { display:none;background:linear-gradient(150deg,#f9f6ed,#ede9df); }
      </style>
      <div id="glass" class="surface"><h2>Glass · 光与波纹</h2><p>局部高光随指尖移动，按下后光圈展开。</p></div>
      <div id="paper" class="surface"></div>
      <script type="module">
        import { createRenderer } from '/liquid-renderer.js';
        window.renderer = createRenderer();
        window.paperRoot = document.getElementById('paper').attachShadow({mode:'open'});
        paperRoot.innerHTML='<h2 style="font-weight:500">Paper · 纸面柔光</h2><p>光泽缓慢散开，保留纸面质感。</p>';
        window.ready = true;
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport:{width:408,height:610}, deviceScaleFactor:3 });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const initial = await page.evaluate(() => {
      renderer.mount(document.getElementById('glass'), {width:360,height:520}, {radius:24});
      renderer.move(.54,.43); renderer.pulse(.54,.43);
      return renderer.getStats();
    });
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
    await page.screenshot({path:path.join(output, 'touch-shader-glass.png')});
    const sameSize = await page.evaluate(() => {
      renderer.mount(document.getElementById('glass'), {width:360,height:520}, {radius:24});
      return renderer.getStats();
    });
    assert.equal(sameSize.resizes, 1, 'same dimensions do not reallocate the buffer');
    assert.equal(sameSize.mounts, 1, 'same parent does not move the canvas');
    await page.waitForTimeout(1200);
    const idle = await page.evaluate(() => renderer.getStats());
    await page.waitForTimeout(180);
    const idleAgain = await page.evaluate(() => renderer.getStats());
    assert.equal(idle.running, false, 'the loop stops after the optical tail');
    assert.equal(idle.drawCount, idleAgain.drawCount, 'no draws occur while idle');
    const paper = await page.evaluate(() => {
      document.getElementById('glass').style.display = 'none';
      document.getElementById('paper').style.display = 'block';
      renderer.mount(paperRoot, {width:360,height:520}, {kind:'paper',radius:24});
      renderer.move(.43,.30); renderer.pulse(.43,.30);
      return renderer.getStats();
    });
    assert.equal(paper.mounts, 2, 'one renderer moves into a ShadowRoot');
    assert.equal(paper.resizes, 1, 'switching to the same size reuses storage');
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length + paperRoot.querySelectorAll('canvas').length), 1);
    await page.waitForTimeout(120);
    await page.screenshot({path:path.join(output, 'touch-shader-paper.png')});
    const button = await page.evaluate(() => {
      renderer.mount(paperRoot, {width:44,height:44}, {kind:'glass',radius:22,dark:true});
      renderer.pulse(.5,.5);
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
    assert.ok((await page.evaluate(() => renderer.getStats())).drawCount > lost.drawCount, 'restored context draws again');
    const disposed = await page.evaluate(() => { renderer.dispose(); return renderer.getStats(); });
    assert.equal(disposed.running, false);
    assert.equal(disposed.disposed, true);
    assert.equal(await page.evaluate(() => paperRoot.querySelectorAll('canvas').length), 0);
    assert.deepEqual(errors, []);
    assert.ok(!requests.some(request => request.includes('three')), 'there is no Three.js dependency');
    const report = { backend:'Chromium SwiftShader (functional verification, not a phone FPS benchmark)',
      rendererBytes:source.length, initial, pixels, sameSize, idle, idleAgain, paper, button, hidden, lost, restored, disposed, requests, errors };
    fs.writeFileSync(path.join(output, 'touch-shader-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`gpu-renderer-smoke: passed; ${initial.pixelCount} pixels; idle draws ${idle.drawCount} -> ${idleAgain.drawCount}; context restored`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
