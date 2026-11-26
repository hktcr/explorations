(() => {
  const link=document.getElementById('dagensBild'), sep=document.getElementById('novellSep');
  if(!link || !sep) return;
  const root=new URL('noveller/',document.baseURI), clock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'});
  let active=false, verified='', timer;
  const toggle=visible=>{link.hidden=sep.hidden=!visible;};
  const hash=async response=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  async function refresh() {
    clearTimeout(timer);
    const now=Date.now(), day=clock.format(now);
    if(verified!==day)toggle(false);
    let lo=0,hi=300000;
    if(clock.format(now+hi)!==day){while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(clock.format(now+mid)===day)lo=mid;else hi=mid;}}
    timer=setTimeout(refresh,hi);
    if(active||document.hidden||(verified===day&&!link.hidden))return;
    active=true;
    try {
      const res=await fetch(root,{cache:'no-cache'});if(!res.ok)return;
      const card=new DOMParser().parseFromString(await res.text(),'text/html').getElementById('novell-'+day);
      const target=card?.querySelector('a[href]')?.getAttribute('href'), img=card?.querySelector('img[alt]')?.getAttribute('src');
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(target||'') || !/^bilder\/[a-z0-9-]+-[a-f0-9]{64}\.webp$/.test(img||'')) return;
      if(!img.endsWith('-'+card.dataset.imageSha+'.webp'))return;
      const [article,picture]=await Promise.all([fetch(new URL(target,root),{cache:'no-cache'}),fetch(new URL(img,root),{cache:'no-cache'})]);
      if(!article.ok||!picture.ok)return;
      const bytes=await picture.blob();
      if(await hash(article)!==card.dataset.pageSha||await hash(bytes)!==card.dataset.imageSha)return;
      const src=URL.createObjectURL(bytes);
      try{const image=new Image();image.src=src;await image.decode();if(!image.naturalWidth||clock.format(Date.now())!==day)return;}
      finally{URL.revokeObjectURL(src);}
      verified=day;link.href=new URL(target,root).href;toggle(true);
    }catch{toggle(false);}finally{active=false;}
  }
  document.addEventListener('visibilitychange',refresh);window.addEventListener('pageshow',refresh);refresh();
})();
