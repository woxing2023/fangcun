// Read-only public build inspection plus isolated local calendar traces.
// FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node calendar-profile.js
// FANGCUN_PROFILE_ROOT=/path/to/unpacked/release selects an isolated source tree.
// FANGCUN_PROFILE_TAG=baseline (or current) separates reports and traces.
// Set FANGCUN_PROFILE_REMOTE=0 to skip public GETs. No login or deployment occurs.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {chromium}=require(process.env.FANGCUN_PLAYWRIGHT_MODULE||'playwright');
const output=path.join(__dirname,'release','qa');
const sourceRoot=path.resolve(process.env.FANGCUN_PROFILE_ROOT||__dirname);
const tag=(process.env.FANGCUN_PROFILE_TAG||'baseline').replace(/[^a-z0-9_-]/gi,'_');
const reportFile=path.join(output,`calendar-rebuild-${tag}.json`);
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const round=value=>Math.round(value*1000)/1000;
const rootFiles=new Map(fs.readdirSync(sourceRoot).filter(file=>/\.(js|css|html|svg|woff2|png|webmanifest)$/.test(file)&&fs.statSync(path.join(sourceRoot,file)).isFile()).map(file=>[file,fs.readFileSync(path.join(sourceRoot,file))]));
const tracked=[...new Set(['index.html','app.js','mobile-ui.css','mobile-material.css','mobile-calendar.css','touch-material.js','liquid-renderer.js','appearance.js','xuan.css','styles.css','service-worker.js',...Array.from(rootFiles.get('index.html').toString().matchAll(/<link rel="stylesheet" href="([^?]+)[^"]*"/g),match=>match[1])])].filter(file=>rootFiles.has(file));

async function publicBuild(){
  if(process.env.FANGCUN_PROFILE_REMOTE==='0')return {skipped:true};
  const android=fs.readFileSync(path.join(sourceRoot,'android/app/src/main/java/app/fangcun/MainActivity.java'),'utf8');
  const match=android.match(/APP_URL\s*=\s*"([^"]+)"/);
  if(!match)return {available:false,reason:'APP_URL constant not found'};
  const resources=[];
  // A small concurrent batch avoids multiplying the timeout for an unavailable site.
  for(let offset=0;offset<tracked.length;offset+=4){
    const batch=await Promise.all(tracked.slice(offset,offset+4).map(async file=>{
      const localSHA256=sha(rootFiles.get(file));
      try{
        const response=await fetch(new URL(file,match[1]),{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'Cache-Control':'no-cache'}});
        const buffer=Buffer.from(await response.arrayBuffer());
        const value={file,status:response.status,bytes:buffer.length,type:response.headers.get('content-type'),sha256:sha(buffer),localSHA256,matchesLocal:sha(buffer)===localSHA256};
        if(file==='app.js')value.build=(buffer.toString().match(/APP_BUILD\s*=\s*"([^"]+)"/)||[])[1]||null;
        if(file==='index.html')value.newResourcesReferenced=['touch-material.js','mobile-material.css','mobile-calendar.css'].map(name=>({file:name,present:buffer.includes(Buffer.from(name))}));
        return value;
      }catch(error){return {file,status:null,errorType:error.name,code:error.cause?.code||null,localSHA256,matchesLocal:false};}
    }));resources.push(...batch);
  }
  return {checkedAt:new Date().toISOString(),targetSource:'Android MainActivity.APP_URL (redacted)',method:'Unauthenticated public GET only',resources};
}
function metrics(raw){return Object.fromEntries(raw.metrics.map(item=>[item.name,item.value]));}
function delta(before,after){
  const result={};
  for(const key of ['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration']){
    result[key.endsWith('Duration')?key+'Ms':key]=round((after[key]-before[key])*(key.endsWith('Duration')?1000:1));
  }
  return result;
}
async function readTrace(cdp,stream){
  let body='';
  for(;;){const part=await cdp.send('IO.read',{handle:stream});body+=part.base64Encoded?Buffer.from(part.data,'base64').toString():part.data;if(part.eof)break;}
  await cdp.send('IO.close',{handle:stream});return body;
}
function traceSummary(events,phases){
  const names=new Set(['UpdateLayoutTree','RecalculateStyles','Layout','PrePaint','Paint','RasterTask','Layerize','CompositeLayers','UpdateLayerTree','FunctionCall','EventDispatch','FireAnimationFrame','RunTask']);
  const summarize=subset=>{
    const grouped=new Map();
    for(const event of subset){
      if(event.ph!=='X'||!names.has(event.name)||!Number.isFinite(event.dur))continue;
      const row=grouped.get(event.name)||{name:event.name,count:0,totalMs:0,maxMs:0};
      row.count++;row.totalMs+=event.dur/1000;row.maxMs=Math.max(row.maxMs,event.dur/1000);grouped.set(event.name,row);
    }
    return [...grouped.values()].map(row=>({...row,totalMs:round(row.totalMs),maxMs:round(row.maxMs)})).sort((a,b)=>b.totalMs-a.totalMs);
  };
  const phaseResults={};
  for(const phase of phases){
    const start=events.find(event=>event.name===`calendar-profile:${phase}:start`),end=events.find(event=>event.name===`calendar-profile:${phase}:end`);
    if(start&&end)phaseResults[phase]={wallMs:round((end.ts-start.ts)/1000),events:summarize(events.filter(event=>event.ts>=start.ts&&event.ts<=end.ts))};
  }
  const invalidations=events.filter(event=>/InvalidationTracking$/.test(event.name));
  const reasons={};for(const event of invalidations){const reason=event.args?.data?.reason||event.name;reasons[reason]=(reasons[reason]||0)+1;}
  return {durationNote:'Event times are inclusive and may overlap across threads; do not add categories as a total.',events:summarize(events),phases:phaseResults,invalidationReasons:reasons};
}
function profileSummary(profile){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
  const times=new Map();
  for(let index=0;index<(profile.samples||[]).length;index++)times.set(profile.samples[index],(times.get(profile.samples[index])||0)+(profile.timeDeltas?.[index]||0));
  return [...times].map(([id,time])=>{
    const frame=nodes.get(id)?.callFrame||{};let file='';try{file=path.basename(new URL(frame.url).pathname);}catch{}
    return {function:frame.functionName||'(anonymous)',file,line:(frame.lineNumber??-1)+1,selfMs:round(time/1000)};
  }).filter(row=>!['(idle)','(root)'].includes(row.function)).sort((a,b)=>b.selfMs-a.selfMs).slice(0,18);
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const report={recordedAt:new Date().toISOString(),sourceLabel:tag,sourceSnapshot:'Root assets frozen in memory at process start',localBuild:(rootFiles.get('app.js').toString().match(/APP_BUILD\s*=\s*"([^"]+)"/)||[])[1],sourceSHA256:Object.fromEntries(tracked.map(file=>[file,sha(rootFiles.get(file))])),
    fixture:{courses:28,tasks:60,scope:'Synthetic member fixture; no account or course data is read'},
    limitation:'Headless Chromium uses SwiftShader. CPU trace shows work structure on this host; it is not Android hardware FPS or GPU throughput.',scenarios:[]};
  const remotePromise=publicBuild();
  const server=http.createServer((request,response)=>{
    const file=decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1)||'index.html';
    const buffer=rootFiles.get(file);
    if(!buffer)return response.writeHead(404).end();
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'text/html');
    response.end(buffer);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    for(const viewport of [{width:1920,height:960},{width:390,height:844}])for(const skin of ['classic','liquid']){
      const mobile=viewport.width<960,name=`${viewport.width}x${viewport.height}-${skin}`;
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,serviceWorkers:'block'});
      await context.addInitScript(skin=>{localStorage.setItem('fangcun-skin',skin);localStorage.setItem('fangcun-theme','light');},skin);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.name));
      await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'?{configured:true,authenticated:true,user:{id:7,username:'member-profile',role:'user'}}:{data:null,revision:0}}));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(()=>document.getElementById('authGate').classList.contains('hidden')&&!syncState.syncing&&!syncState.reconciling);
      await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>{
        const colors=['#6289a9','#849770','#aa8065','#8877ac','#9a7692','#64988e','#a39361'];
        data.semester={...defaultSemester(),startDate:localISO(mondayOf(new Date())),showWeekend:true};data.timeSlots=defaultTimeSlots();data.courses=[];data.tasks=[];data.calendarRules=[];data.courseExceptions=[];
        for(let day=1;day<=7;day++)for(let slot=0;slot<4;slot++)data.courses.push({id:`profile-${day}-${slot}`,name:['程序设计基础','线性代数与解析几何','实验方法与数据分析','学习交流'][slot],day,startSection:[1,4,7,11][slot],endSection:[2,5,8,12][slot],weeks:[1,2,3],color:colors[(day+slot)%7],location:`A${200+day}`});
        data.tasks=Array.from({length:60},(_,index)=>({id:`profile-task-${index}`,title:'项目阶段任务 '+index,quadrant:['q1','q2','q3','q4'][index%4],important:index%2===0,urgent:index%3===0,due:offsetDate(index%10),completed:false}));
        displayedWeek=1;scheduleMode='week';localStorage.setItem(accountKey('fangcun-calendar-layout'),'overview');switchView('schedule');renderAll();
      });
      await page.waitForTimeout(400);
      const paint=await page.evaluate(()=>{
        const visible=element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
        const all=[...document.querySelectorAll('body *')].filter(visible),grid=document.querySelector('.calendar-week-grid');
        const styleCounts=elements=>elements.reduce((counts,element)=>{const style=getComputedStyle(element);counts.total++;if(style.backdropFilter!=='none')counts.backdropFilter++;if(style.boxShadow!=='none')counts.boxShadow++;if(style.filter!=='none')counts.filter++;if(style.backgroundImage!=='none')counts.backgroundImage++;return counts;},{total:0,backdropFilter:0,boxShadow:0,filter:0,backgroundImage:0});
        const cell=grid.querySelector('.calendar-time-cell'),cellStyle=getComputedStyle(cell);
        window.__calendarChanges={batches:0,added:0,removed:0};
        window.__calendarObserver=new MutationObserver(records=>{window.__calendarChanges.batches++;for(const record of records){window.__calendarChanges.added+=record.addedNodes.length;window.__calendarChanges.removed+=record.removedNodes.length;}});
        window.__calendarObserver.observe(document.querySelector('#weekCalendar'),{subtree:true,childList:true});
        return {domElements:document.querySelectorAll('*').length,visibleElements:all.length,calendarElements:grid.querySelectorAll('*').length,timeCells:grid.querySelectorAll('.calendar-time-cell').length,events:grid.querySelectorAll('.calendar-week-event').length,
          visibleStyles:styleCounts(all),calendarStyles:styleCounts([...grid.querySelectorAll('*')]),timeCellStyles:styleCounts([...grid.querySelectorAll('.calendar-time-cell')]),
          cell:{background:cellStyle.backgroundColor,image:cellStyle.backgroundImage.replace(/url\([^)]*\)/g,'url(asset)'),shadow:cellStyle.boxShadow,blur:cellStyle.backdropFilter},materialPerformance:document.documentElement.dataset.materialPerformance};
      });
      const cdp=await context.newCDPSession(page);
      await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
      let layers=[];await cdp.send('LayerTree.enable');cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers||[];});
      await cdp.send('Tracing.start',{categories:'devtools.timeline,toplevel,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'});
      const phaseMetrics={};
      const phase=async(label,work)=>{
        await page.evaluate(label=>performance.mark(`calendar-profile:${label}:start`),label);
        const before=metrics(await cdp.send('Performance.getMetrics'));await work();
        const after=metrics(await cdp.send('Performance.getMetrics'));
        await page.evaluate(label=>performance.mark(`calendar-profile:${label}:end`),label);
        phaseMetrics[label]=delta(before,after);
      };
      await phase('idle',()=>page.waitForTimeout(1100));
      const renders=[];
      await phase('redraw',async()=>{
        for(let index=0;index<3;index++){
          renders.push(await page.evaluate(()=>{const old=document.querySelector('.calendar-time-cell'),start=performance.now();renderAll();return {synchronousMs:performance.now()-start,previousCellReplaced:!old.isConnected};}));
          await page.waitForTimeout(180);
        }
      });
      await phase('week-navigation',async()=>{
        for(const id of ['nextWeekBtn','prevWeekBtn','nextWeekBtn','prevWeekBtn']){await page.evaluate(id=>document.getElementById(id).click(),id);await page.waitForTimeout(160);}
      });
      await phase('zoom',async()=>{
        for(const id of ['calendarZoomIn','calendarZoomOut','calendarZoomFit']){await page.evaluate(id=>document.getElementById(id).click(),id);await page.waitForTimeout(170);}
      });
      await phase('pointer',async()=>{
        const box=await page.locator('.calendar-time-cell').first().boundingBox();
        const x=box.x+box.width*.5,y=box.y+box.height*.5;
        if(mobile){
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
          for(let index=0;index<9;index++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+Math.sin(index)*2,y:y+Math.cos(index)*2,id:1}]});await page.waitForTimeout(45);}
          await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
        }else{for(let index=0;index<9;index++){await page.mouse.move(x+Math.sin(index)*2,y+Math.cos(index)*2);await page.waitForTimeout(45);}await page.mouse.move(0,0);}
        await page.waitForTimeout(220);
      });
      const traceComplete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
      const complete=await traceComplete,traceBody=await readTrace(cdp,complete.stream),trace=JSON.parse(traceBody);
      const {profile}=await cdp.send('Profiler.stop');
      const traceFile=`calendar-trace-${tag}-${name}.json`;
      fs.writeFileSync(path.join(output,traceFile),traceBody);
      const mutations=await page.evaluate(()=>window.__calendarChanges);
      const scenario={name,viewport,skin,mode:'light',paint,phaseMetrics,renders:renders.map(render=>({...render,synchronousMs:round(render.synchronousMs)})),mutations,
        layers:{total:layers.length,drawsContent:layers.filter(layer=>layer.drawsContent).length},domCounters:await cdp.send('Memory.getDOMCounters'),trace:traceSummary(trace.traceEvents,Object.keys(phaseMetrics)),cpuSamples:profileSummary(profile),traceFile,errors};
      report.scenarios.push(scenario);
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
      console.log(`${name}: ${paint.timeCells} time cells, ${paint.timeCellStyles.backdropFilter} blurred cells; redraw style ${phaseMetrics.redraw.RecalcStyleDurationMs} ms, layout ${phaseMetrics.redraw.LayoutDurationMs} ms; errors ${errors.length}`);
      await context.close();
    }
    report.publicBuild=await remotePromise;
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
    if(!report.publicBuild.skipped)fs.writeFileSync(path.join(output,'calendar-public-build.json'),JSON.stringify(report.publicBuild,null,2)+'\n');
    console.log(`calendar-profile: ${report.scenarios.length} traces saved; public inspection contains only resource names, status and hashes`);
  }finally{
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error.name+': '+String(error.message).replace(/https?:\/\/[^\s"']+/g,'[redacted]'));process.exitCode=1;});
