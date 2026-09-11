// Real content geometry, inline theme controls and navigation regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = path.join(__dirname, 'release/qa/mobile-ui');
  fs.mkdirSync(output, { recursive:true });
  const server = http.createServer((req,res) => {
    const file = path.resolve(__dirname, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const report=[];
  try {
    browser=await chromium.launch({ headless:true });
    const context=await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, serviceWorkers:'block' });
    const page=await context.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**', route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session' ? {configured:true,authenticated:true,user:{id:7,username:'member-layout',role:'user'}} : {data:null,revision:0}}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelector('#authGate').classList.contains('hidden') && !syncState.syncing && !syncState.reconciling);
    await page.evaluate(()=>{
      data.tasks=Array.from({length:31},(_,index)=>({id:`layout-${index}`,title:index%2 ? '程序设计基础新作业：Lab 2 - Python as a Calculator 完整说明与提交要求' : '程序设计基础 Lab 2 - Python as a Calculator 提交截止',due:offsetDate(3),dueTime:'23:59',type:'event',quadrant:'q1',important:true,urgent:true,completed:false,createdAt:Date.now()-index}));
      switchView('matrix');renderAll();
    });
    for (const skin of ['classic','liquid']) for (const mode of ['light','dark']) {
      await page.evaluate(({skin,mode})=>{document.documentElement.dataset.skin=skin;document.documentElement.dataset.mode=mode;document.body.classList.toggle('dark',mode==='dark');},{skin,mode});
      for (const [width,height] of [[320,568],[390,844],[844,390]]) {
        await page.setViewportSize({width,height});
        // Simulate Android's enlarged WebView text independently of root rems.
        for (const fontScale of [1,1.3]) {
          if(fontScale>1) await page.addStyleTag({content:'@layer mobile-ui {html body .task-card h4 {font-size:18.2px!important} html body .task-card .meta-tag {font-size:13px!important}}',id:'large-type'});
          await page.waitForTimeout(100);
          const result=await page.locator('.task-card').evaluateAll(cards=>({
            count:cards.length,
            clipped:cards.flatMap(card=>{
              const box=card.getBoundingClientRect();
              return [...card.querySelectorAll('h4,.task-meta,.meta-tag,.complete-btn')].filter(el=>{
                const rect=el.getBoundingClientRect();
                return rect.left<box.left-1 || rect.right>box.right+1 || rect.top<box.top-1 || rect.bottom>box.bottom+1 || el.scrollWidth>el.clientWidth+1;
              }).map(el=>`${card.dataset.taskId}:${el.className||el.tagName}`);
            }), pageOverflow:document.documentElement.scrollWidth>innerWidth+1
          }));
          assert.equal(result.count,31); assert.deepEqual(result.clipped,[],JSON.stringify({skin,mode,width,fontScale,result})); assert.equal(result.pageOverflow,false);
          // The list must scroll to the final task instead of compressing all cards.
          const last=page.locator('.task-card').last(); await last.scrollIntoViewIfNeeded();
          const reachable=await last.evaluate(el=>{const r=el.getBoundingClientRect(),list=el.closest('.task-list').getBoundingClientRect(),nav=document.querySelector('.mobile-bottom-nav').getBoundingClientRect();return {top:r.top,bottom:r.bottom,listTop:list.top,listBottom:list.bottom,navTop:nav.top, fits:r.top>=list.top-1 && r.bottom<=Math.min(list.bottom,nav.width && nav.height && nav.right>r.left && nav.left<r.right ? nav.top : innerHeight)+1};});
          if(!reachable.fits)await page.screenshot({path:path.join(output,"failure.png")});
          assert.ok(reachable.fits,`${width}/${fontScale}: last task must be reachable above navigation ${JSON.stringify(reachable)}`);
          const navBounds=await page.locator('.mobile-bottom-nav button').evaluateAll(buttons=>buttons.filter(el=>el.checkVisibility()).every(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;}));
          assert.ok(navBounds,`${width}: navigation actions must remain inside the viewport`);
          report.push({skin,mode,width,height,fontScale,...result});
          if(width===390 && fontScale===1) {
            await page.locator('.task-card').first().scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(output,`tasks-${skin}-${mode}.png`)});
          }
          await page.evaluate(()=>document.querySelectorAll('style').forEach(el=>{if(el.textContent.includes('font-size:18.2px'))el.remove();}));
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.locator('#mobileMenu').click();
      await page.evaluate(()=>{document.querySelector('#cloudLabel').textContent='需要处理冲突，请检查尚未同步的更改';});
      await page.waitForTimeout(300);
      await page.screenshot({path:path.join(output,`sidebar-${skin}-${mode}.png`)});
      await page.locator('#appearanceSettingsBtn').click();
      for(const chosen of [mode==='light'?'dark':'light',mode]) {
        await page.locator(`[name="appearance-theme"][value="${chosen}"]`).check();
        assert.equal(await page.evaluate(()=>document.body.classList.contains('dark')),chosen==='dark');
        assert.equal(await page.evaluate(()=>localStorage.getItem('fangcun-theme')),chosen);
        assert.equal(await page.locator('#appearanceMode').inputValue(),chosen);
        assert.equal(await page.locator('#appearanceModal .liquid-select-trigger:visible').count(),0);
      }
      await page.locator(`[name="appearance-theme"][value="${mode}"]`).check();
      const modal=await page.locator('#appearanceModal').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth-el.clientWidth};});
      assert.ok(modal.left>=0 && modal.right<=modal.width && modal.top>=0 && modal.bottom<=modal.height && modal.overflow<=1,JSON.stringify(modal));
      await page.waitForTimeout(300);
      await page.screenshot({path:path.join(output,`appearance-${skin}-${mode}.png`)});
      await page.locator('#appearanceModal .primary-button').click();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(`Mobile UI: ${report.length} long-title/type/viewport cases, all items reachable; theme and navigation checks passed.`);
    await context.close();
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
