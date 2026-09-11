/* Two inline choices share the existing preference select and change handler. */
(() => {
  const start=()=>{
    const source=document.getElementById('appearanceMode');
    const options=[...document.querySelectorAll('[name="appearance-theme"]')];
    if(!source || !options.length) return;
    const sync=()=>{
      const mode=document.documentElement.dataset.mode || source.value;
      options.forEach(input=>{input.checked=input.value===mode});
    };
    options.forEach(input=>input.addEventListener('change',()=>{
      if(!input.checked) return;
      source.value=input.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    }));
    source.addEventListener('change',()=>queueMicrotask(sync));
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-mode']});
    sync();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
