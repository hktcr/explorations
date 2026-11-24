(() => {
  'use strict';
  const trigger=document.querySelector('[data-kr-wordcloud]'), dialog=document.getElementById('kr-cloud');
  const frame=document.getElementById('kr-frame'), close=document.getElementById('kr-close');
  const progress=document.getElementById('kr-loading'), error=document.getElementById('kr-cloud-error'), retry=document.getElementById('kr-retry');
  if(!trigger||!dialog?.showModal||!frame||!close||!progress||!error||!retry)return;
  let ours=false,timer,ready=false,pending=false;
  function hideFrame(hidden){
    frame.toggleAttribute('data-loading',hidden);
    frame.setAttribute('aria-hidden',String(hidden));frame.tabIndex=hidden?-1:0;
  }
  function finish(ok){
    if(!pending)return;
    pending=false;clearTimeout(timer);progress.hidden=true;hideFrame(!ok);error.hidden=ok;ready=ok;
  }
  function load(){
    clearTimeout(timer);pending=true;ready=false;progress.hidden=false;error.hidden=true;hideFrame(true);
    const target=new URL(trigger.href);target.searchParams.set('visning','moln');
    target.searchParams.set('_',String(Date.now()));frame.src=target.href;
    timer=setTimeout(()=>finish(false),15000);
  }
  addEventListener('message',event=>{
    if(!dialog.open||event.origin!==location.origin||event.source!==frame.contentWindow)return;
    if(event.data?.type==='explorations:wordcloud-ready') finish(true);
    if(event.data?.type==='explorations:wordcloud-close') dialog.close();
  });
  frame.addEventListener('error',()=>finish(false));
  trigger.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(dialog.open){event.preventDefault();return;}
    try{dialog.showModal();}catch(_){return;}
    event.preventDefault();
    if(!ready)load();
    close.focus();
    if(!document.fullscreenElement&&document.fullscreenEnabled&&document.documentElement.requestFullscreen){
      Promise.resolve(document.documentElement.requestFullscreen()).then(()=>{
        if(dialog.open)ours=true;
        else if(document.fullscreenElement)Promise.resolve(document.exitFullscreen()).catch(()=>{});
      }).catch(()=>{}); // Full-viewport dialog is already visible.
    }
  });
  retry.addEventListener('click',()=>{load();close.focus();});
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    if(pending){clearTimeout(timer);pending=false;frame.removeAttribute('src');progress.hidden=true;}
    if(ours&&document.fullscreenElement)Promise.resolve(document.exitFullscreen()).catch(()=>{});
    ours=false;trigger.focus();
  });
})();
