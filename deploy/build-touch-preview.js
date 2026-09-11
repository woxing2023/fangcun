// Build an offline calendar review from actual fine/coarse application DOM.
// The older release/touch-review.html is intentionally preserved.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.FANGCUN_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const build='20260911-calendar-v3';
const files=new Map(fs.readdirSync(root).filter(file=>/\.(js|css|html|svg|png|woff2|webmanifest)$/.test(file)&&fs.statSync(path.join(root,file)).isFile()).map(file=>[file,fs.readFileSync(path.join(root,file))]));
const read=name=>files.get(name)?.toString()||'';
const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const safeJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const devices={desktop:{width:1536,height:900,touch:false},portrait:{width:390,height:844,touch:true},landscape:{width:844,height:390,touch:true}};
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
  if(!files.has(name))return res.writeHead(404).end();
  res.setHeader('Content-Type',(types[path.extname(name)]||'text/html')+'; charset=utf-8');res.end(files.get(name));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;const snapshots={};
 try{
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const [orientation,device] of Object.entries(devices)){
   const context=await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:device.touch,isMobile:device.touch,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.name));
   await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'?{configured:true,authenticated:true,user:{id:7,username:'member-preview',role:'user'}}:{data:null,revision:0}}));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.waitForFunction(()=>document.querySelector('#authGate').classList.contains('hidden')&&!syncState.syncing&&!syncState.reconciling);
   await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{
    data.semester={...defaultSemester(),startDate:localISO(mondayOf(new Date())),showWeekend:true};data.timeSlots=defaultTimeSlots();data.tasks=[];data.courses=[];data.calendarRules=[];data.courseExceptions=[];data.projects=[];
    const colors=['#7188ba','#589e90','#c79b4a','#ba7584','#9180be','#6198ad','#c48c69'];
    const names=['程序设计基础 · Python Lab','大学物理','微积分与空间解析几何','英语写作','体育','线性代数','设计实践'];
    for(let day=1;day<=7;day++)for(let i=0;i<3;i++)data.courses.push({id:`preview-${day}-${i}`,name:names[(day-1+i)%7],day,startSection:[1,6,11][i],endSection:[2,7,13][i],weeks:[1],color:colors[(day-1+i)%7],location:`A${200+day}`});
    displayedWeek=1;switchView('schedule');renderAll();
   });
   for(const mode of ['week','timetable'])for(const layout of ['overview','list']){
    await page.evaluate(({mode,layout})=>{scheduleMode=mode;renderAll();setCalendarLayout(layout);},{mode,layout});
    await page.waitForTimeout(180);
    const key=`${orientation}-${mode}-${layout}`;
    snapshots[key]=await page.evaluate(()=>{
     const copy=document.body.cloneNode(true);
     copy.querySelectorAll('script,dialog,.touch-material-layer,.material-light,.liquid-lens').forEach(element=>element.remove());
     copy.querySelectorAll('[draggable]').forEach(element=>element.setAttribute('draggable','false'));
     const media={coarse:matchMedia('(pointer:coarse)').matches,fine:matchMedia('(pointer:fine)').matches};
     return {html:copy.innerHTML,attributes:[...copy.attributes].map(attribute=>[attribute.name,attribute.value]),rootAttributes:[...document.documentElement.attributes].map(attribute=>[attribute.name,attribute.value]),media};
    });
    if(snapshots[key].media.coarse!==device.touch)throw Error('Pointer media does not match '+key);
   }
   if(errors.length)throw Error('Snapshot page errors: '+errors.join(', '));
   await context.close();
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
 const styleFiles=[...read('index.html').matchAll(/<link rel="stylesheet" href="([^?]+)[^"]*"/g)].map(match=>match[1]);
 let css=styleFiles.map(read).join('\n');
 const assets={},assetNames=new Map();
 css=css.replace(/url\((["']?)([^)"']+)\1\)/g,(match,quote,url)=>{
  if(/^(data:|#)/.test(url))return match;
  if(/^https?:/.test(url))throw Error('Offline review cannot embed a remote CSS URL');
  const name=url.split('?')[0],buffer=files.get(name);if(!buffer)throw Error('Missing CSS asset: '+name);
  if(!assetNames.has(name)){
   const key='__PREVIEW_ASSET_'+assetNames.size+'__';assetNames.set(name,key);
   assets[key]='data:'+(types[path.extname(name)]||'application/octet-stream')+';base64,'+buffer.toString('base64');
  }
  return 'url("'+assetNames.get(name)+'")';
 });
 // The fine-pointer stylesheet is unmodified. Only touch snapshots receive
 // emulated coarse media so their layout also survives review with a mouse.
 const touchCSS=css.replace(/\(pointer:\s*coarse\)/g,'(min-width:0px)').replace(/\(pointer:\s*fine\)/g,'(max-width:0px)').replace(/\(hover:\s*none\)/g,'(min-width:0px)').replace(/\(hover:\s*hover\)/g,'(max-width:0px)');
 const gpu='window.__previewOptics=(()=>{'+read('liquid-renderer.js').replace('export function createRenderer','function createRenderer')+'\nreturn {createRenderer};})();';
 const controller=read('touch-material.js').replace("import('./liquid-renderer.js')","Promise.resolve(window.__previewOptics)");
 const bridge=`document.addEventListener('submit',event=>event.preventDefault());document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link)event.preventDefault();const button=event.target.closest('button');if(button?.id==='calendarListBtn')parent.postMessage({calendarPreviewLayout:'toggle'},'*');if(button?.id==='calendarZoomFit')parent.postMessage({calendarPreviewLayout:'overview'},'*');if(button?.dataset.scheduleMode && ['week','timetable'].includes(button.dataset.scheduleMode))parent.postMessage({calendarPreviewMode:button.dataset.scheduleMode},'*');});`;
 const payload={build,devices,snapshots,styles:{desktop:css,touch:touchCSS},assets,optics:gpu+'\n'+controller+'\n'+bridge};
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方寸 · 日历材质与布局审阅</title><style>
 *{box-sizing:border-box}body{margin:0;background:#e9edf1;color:#263447;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1610px;margin:auto;padding:24px 24px 36px}h1{font-size:27px;line-height:1.3;font-weight:600;letter-spacing:.02em;margin:6px 0}p{margin:8px 0;color:#607084}.kicker{font-size:11px;letter-spacing:.1em;color:#526c95}.controls{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.group{display:flex;padding:4px;border:1px solid #fff;border-radius:12px;background:#dfe5ed;box-shadow:inset 0 1px 3px #38455b12}button{border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;padding:6px 12px;cursor:pointer}button[aria-pressed=true]{background:linear-gradient(145deg,#fff,#e7effa);box-shadow:0 2px 5px #30435820;color:#375c96}button:focus-visible{outline:2px solid #47679f;outline-offset:2px}.stage{max-width:100%;margin:20px auto 0;position:relative}.screen{position:relative;margin:auto;overflow:hidden;border-radius:18px;box-shadow:0 16px 42px #23384f20,0 1px 0 #fff;outline:1px solid #ffffffaa}iframe{border:0;display:block;transform-origin:0 0;background:#e9edf1}.foot{font-size:12px;max-width:900px;margin:20px auto;text-align:center}body.dark{background:#202834;color:#ecf0f5}body.dark p{color:#b2becd}body.dark .group{background:#303f54;border-color:#52627a}body.dark button[aria-pressed=true]{background:linear-gradient(145deg,#526989,#344965);color:#e4efff}body.dark .kicker{color:#a9c4eb}@media(max-width:500px){main{padding:18px 12px}h1{font-size:23px}.controls{gap:6px}.group button{padding:6px 9px;font-size:12px}}
 </style><main><div class="kicker">方寸 / ${build}</div><h1>日历材质与布局审阅</h1><p>切换桌面与手机、周历与课表。按住课程或纸面空白，小幅拖动，查看跟随手指的光泽。</p><div class="controls">
 <div class="group" aria-label="皮肤"><button data-skin="classic">宣纸</button><button data-skin="liquid">流光玻璃</button></div>
 <div class="group" aria-label="显示模式"><button data-theme="light">浅色</button><button data-theme="dark">深色</button></div>
 <div class="group" aria-label="屏幕"><button data-orientation="desktop">桌面</button><button data-orientation="portrait">手机竖屏</button><button data-orientation="landscape">手机横屏</button></div>
 <div class="group" aria-label="日历视图"><button data-calendar="week">周历</button><button data-calendar="timetable">课表</button></div>
 <div class="group" aria-label="布局"><button data-layout="overview">全表</button><button data-layout="list">清单</button></div></div>
 <div class="stage"><div class="screen"><iframe title="方寸真实日历与可交互材质" scrolling="no"></iframe></div></div><p class="foot">虚构课程 · 12 组真实页面快照，支持两套皮肤与浅深色。清单可滚动，其余业务操作仅展示材质反馈。此文件可离线打开，不连接账号或保存任务。</p></main>
 <script>const preview=${safeJSON(payload)};
 const state={skin:'classic',theme:'light',orientation:'desktop',calendar:'week',layout:'overview'};const frame=document.querySelector('iframe'),screenBox=document.querySelector('.screen'),stage=document.querySelector('.stage');
 const escapeAttribute=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 function attributes(values){return values.map(([key,value])=>key+'="'+escapeAttribute(value)+'"').join(' ');}
 function mark(){document.querySelectorAll('.controls button').forEach(button=>{const key=Object.keys(button.dataset)[0];button.setAttribute('aria-pressed',String(state[key]===button.dataset[key]));});document.body.classList.toggle('dark',state.theme==='dark');}
 function fit(){const {width,height}=preview.devices[state.orientation],scale=Math.min(1,stage.clientWidth/width);frame.width=width;frame.height=height;frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform='scale('+scale+')';screenBox.style.width=(width*scale)+'px';screenBox.style.height=(height*scale)+'px';}
 function theme(){const doc=frame.contentDocument;if(!doc?.body)return;doc.documentElement.dataset.skin=state.skin;doc.documentElement.dataset.mode=state.theme;doc.body.classList.toggle('dark',state.theme==='dark');}
 function render(){mark();const key=state.orientation+'-'+state.calendar+'-'+state.layout,snapshot=preview.snapshots[key];const rootAttributes=new Map(snapshot.rootAttributes);rootAttributes.set('data-preview-view',key);rootAttributes.set('data-skin',state.skin);rootAttributes.set('data-mode',state.theme);const css=preview.styles[state.orientation==='desktop'?'desktop':'touch'].replace(/__PREVIEW_ASSET_\d+__/g,key=>preview.assets[key]);frame.srcdoc='<!doctype html><html '+attributes([...rootAttributes])+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body '+attributes(snapshot.attributes)+'>'+snapshot.html+'<script>'+preview.optics+'<'+ '/script></body></html>';fit();}
 frame.addEventListener('load',theme);document.querySelector('.controls').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const key=Object.keys(button.dataset)[0];if(state[key]===button.dataset[key])return;state[key]=button.dataset[key];if(key==='skin'||key==='theme'){mark();theme();}else render();});window.addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;if(event.data?.calendarPreviewLayout){state.layout=event.data.calendarPreviewLayout==='toggle'?(state.layout==='list'?'overview':'list'):'overview';render();}if(event.data?.calendarPreviewMode){state.calendar=event.data.calendarPreviewMode;render();}});new ResizeObserver(fit).observe(stage);render();
 </script></html>`;
 fs.mkdirSync(path.join(root,'release'),{recursive:true});fs.writeFileSync(path.join(root,'release/calendar-review.html'),html);
 console.log('Offline calendar review built: '+Buffer.byteLength(html)+' bytes; '+Object.keys(snapshots).length+' actual DOM snapshots; separate fine/coarse CSS.');
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
