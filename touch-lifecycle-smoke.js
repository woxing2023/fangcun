// Uses the real touch controller and renderer in an isolated DOM fixture.
// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node touch-lifecycle-smoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = path.join(__dirname, 'release', 'qa');
  fs.mkdirSync(output, {recursive:true});
  const sources = new Map(['/touch-material.js','/liquid-renderer.js'].map(url => [url,fs.readFileSync(path.join(__dirname,url.slice(1)))]));
  const server = http.createServer((request,response) => {
    if(sources.has(request.url)) {
      response.setHeader('Content-Type','text/javascript; charset=utf-8');
      response.end(sources.get(request.url)); return;
    }
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(`<!doctype html><html data-material-performance="touch" data-mode="light">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body{margin:24px;min-height:1500px;background:#e2e8ed;font:15px system-ui,sans-serif}
        button{display:block;width:300px;height:220px;border:1px solid #fff;border-radius:22px;
          background:linear-gradient(145deg,#ffffffca,#bdcddfa0);touch-action:none;margin:0 0 22px;color:#234}
        dialog{padding:20px;border:1px solid #fff;border-radius:24px;background:#e8eef3}
        dialog button{width:220px;height:130px;margin:0}
        .today-section{height:150px;width:300px;box-sizing:border-box;padding:22px;border-radius:22px;background:#f3efe3;touch-action:none}
      </style>
      <button id="surface">Glass · 触摸材质</button>
      <section class="today-section" id="paper">Paper · 宣纸柔光</section>
      <dialog id="detail"><button id="dialog-surface">Dialog surface</button></dialog>
      <script>document.addEventListener("pointerdown",event=>{window.lastTestPointer=event.pointerId;},{passive:true});</script>
      <script src="/touch-material.js"></script>
    </html>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const errors = [];
  const report = { backend:'Chromium SwiftShader; CDP touch input; functional lifecycle checks, not a device FPS benchmark' };
  try {
    browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>window.FangcunTouchMaterial?.getStats().renderer);
    const cdp = await context.newCDPSession(page);
    let point = {x:150,y:110,id:1};
    const touch = (type,points) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    const begin = async (x=150,y=110) => {point={x,y,id:1};await touch('touchStart',[point]);};
    const move = async (x,y) => {point={...point,x,y};await touch('touchMove',[point]);};
    const end = () => touch('touchEnd',[]);
    const cancel = () => touch('touchCancel',[]);
    const stats = () => page.evaluate(()=>FangcunTouchMaterial.getStats());
    const cleared = async reason => {
      await page.waitForFunction(()=>!FangcunTouchMaterial.getStats().active);
      const result = await stats();
      assert.equal(result.renderer?.running || false,false,`${reason}: no queued GPU frame`);
      assert.equal(await page.locator('.touch-material-layer').count(),0,`${reason}: overlay removed`);
      return result;
    };

    await begin();
    const holdStart=await stats(), start=Date.now();
    while(Date.now()-start<2100) {
      const elapsed=Date.now()-start;
      await move(145+Math.sin(elapsed/300)*25,110+Math.cos(elapsed/300)*18);
      await page.waitForTimeout(40);
    }
    report.continuous=await stats();
    assert.equal(report.continuous.active,true,'a continuous gesture survives the old 1600 ms cutoff');
    assert.ok(report.continuous.uniformUpdates>20,'the two-second gesture kept updating the shader');
    assert.equal(report.continuous.geometryReads,holdStart.geometryReads,'moves do not remeasure DOM geometry');
    await end();
    const released=await stats();
    // A stale sample after pointerup must not re-activate the gesture tail.
    await page.evaluate(()=>document.getElementById('surface').dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,pointerId:window.lastTestPointer,isPrimary:true,pointerType:'touch',clientX:170,clientY:110
    })));
    assert.equal((await stats()).pointerSamples,released.pointerSamples,'released gestures ignore late pointer samples');
    report.released=await cleared('pointerup tail');

    await begin();
    await page.evaluate(()=>{
      const canvas=document.querySelector('.touch-material-layer').shadowRoot.querySelector('canvas');
      window.lossExtension=canvas.getContext('webgl').getExtension('WEBGL_lose_context');
      if(!lossExtension)throw new Error('WEBGL_lose_context is required for this test');
      lossExtension.loseContext();
    });
    await page.waitForFunction(()=>FangcunTouchMaterial.getStats().renderer.lost && FangcunTouchMaterial.getStats().fallback);
    const fallbackBefore=await page.evaluate(()=>{
      const glow=document.querySelector('.touch-material-layer').shadowRoot.querySelector('.glow');
      return {opacity:getComputedStyle(glow).opacity,transform:glow.style.transform};
    });
    assert.ok(Number(fallbackBefore.opacity)>0,'GPU failure retains a visible CSS glow');
    await move(200,145);
    await page.waitForTimeout(50);
    const fallbackAfter=await page.evaluate(()=>document.querySelector('.touch-material-layer').shadowRoot.querySelector('.glow').style.transform);
    assert.notEqual(fallbackAfter,fallbackBefore.transform,'fallback follows the actual touch pointer');
    report.contextLost=await stats();
    await page.evaluate(()=>lossExtension.restoreContext());
    await page.waitForFunction(()=>{
      const s=FangcunTouchMaterial.getStats();return s.active && s.renderer.contextRestores===1 && !s.renderer.lost && !s.fallback;
    },null,{timeout:5000});
    report.contextRestored=await stats();
    assert.equal(report.contextRestored.active,true,'context restoration preserves the current gesture');
    assert.equal(report.contextRestored.fallback,false,'a restored GPU replaces fallback');
    await cancel();await cleared('pointercancel');

    await begin();
    await page.evaluate(()=>document.getElementById('surface').remove());
    report.targetRemoved=await cleared('target removed by render');
    await cancel();
    await page.evaluate(()=>{
      const button=document.createElement('button');button.id='surface';button.textContent='Glass · 重绘后';
      document.body.prepend(button);
    });
    await begin();
    await page.evaluate(()=>window.scrollTo(0,60));
    report.scrolled=await cleared('scroll');await cancel();
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(50);
    await begin();
    await touch('touchStart',[point,{x:230,y:160,id:2}]);
    report.multitouch=await cleared('second finger');await cancel();

    await page.evaluate(()=>document.getElementById('detail').showModal());
    const box=await page.locator('#dialog-surface').boundingBox();
    await begin(box.x+box.width/2,box.y+box.height/2);
    assert.equal(await page.locator('dialog .touch-material-layer').count(),1,'dialog feedback mounts in the top layer');
    await page.evaluate(()=>document.getElementById('detail').close());
    report.dialogClosed=await cleared('dialog close');await cancel();

    await begin();
    // Dispatching lifecycle handlers is deterministic; this does not emulate an
    // Android process kill or claim coverage of a vendor WebView background policy.
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    report.pageHidden=await cleared('pagehide');
    assert.equal(report.pageHidden.renderer,null,'pagehide releases the GPU instance');await cancel();
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await page.waitForFunction(()=>FangcunTouchMaterial.getStats().renderer);
    await begin();
    await page.waitForFunction(()=>FangcunTouchMaterial.getStats().renderer.drawCount>0);
    report.pageResumed=await stats();
    assert.equal(report.pageResumed.active,true);
    assert.equal(report.pageResumed.fallback,false);
    await cancel();await cleared('resumed gesture cancelled');
    await context.close();

    const noGpu=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await noGpu.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        return /^(webgl2?|experimental-webgl)$/.test(type) ? null : original.call(this,type,...args);
      };
    });
    const fallbackPage=await noGpu.newPage();
    fallbackPage.on('pageerror',error=>errors.push(String(error)));
    await fallbackPage.goto(`http://127.0.0.1:${server.address().port}`);
    const fallbackCdp=await noGpu.newCDPSession(fallbackPage);
    await fallbackCdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:135,y:110,id:1}]});
    await fallbackPage.waitForFunction(()=>FangcunTouchMaterial.getStats().fallback);
    const cssBefore=await fallbackPage.evaluate(()=>{
      const shadow=document.querySelector('.touch-material-layer').shadowRoot;
      return {opacity:getComputedStyle(shadow.querySelector('.glow')).opacity,transform:shadow.querySelector('.glow').style.transform,
        ringAnimations:shadow.querySelector('.ring').getAnimations().filter(a=>a.playState==='running').length};
    });
    assert.ok(Number(cssBefore.opacity)>0,'no WebGL still displays a glow');
    assert.equal(cssBefore.ringAnimations,1,'no WebGL still animates an expanding ring');
    await fallbackCdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:140,id:1}]});
    await fallbackPage.waitForTimeout(80);
    const cssAfter=await fallbackPage.evaluate(()=>document.querySelector('.touch-material-layer').shadowRoot.querySelector('.glow').style.transform);
    assert.notEqual(cssBefore.transform,cssAfter,'CSS glow moves without WebGL');
    report.noWebGL=await fallbackPage.evaluate(()=>FangcunTouchMaterial.getStats());
    assert.equal(report.noWebGL.renderer,null);
    await fallbackCdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await fallbackPage.waitForFunction(()=>!FangcunTouchMaterial.getStats().active);
    assert.equal(await fallbackPage.locator('.touch-material-layer').count(),0,'fallback tail releases its layer');
    await noGpu.close();
    assert.deepEqual(errors,[]);
    report.errors=errors;report.passed=true;
    fs.writeFileSync(path.join(output,'touch-lifecycle-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('touch-lifecycle-smoke: passed; sustained touch, GPU loss/recovery, redraw, scrolling, multitouch, lifecycle and CSS fallback');
  } catch(error) {
    report.passed=false;report.error=String(error);report.errors=errors;
    fs.writeFileSync(path.join(output,'touch-lifecycle-report.json'),JSON.stringify(report,null,2)+'\n');
    throw error;
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
