(() => {
  'use strict';
  const trigger = document.querySelector('[data-kr-wordcloud]');
  const dialog = document.getElementById('kr-cloud');
  const frame = document.getElementById('kr-frame');
  const exit = document.getElementById('kr-close');
  if (!trigger || !dialog?.showModal || !frame || !exit) return;
  let enteredHere = false;
  trigger.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try { dialog.showModal(); } catch (_) { return; }
    event.preventDefault();
    if (!frame.hasAttribute('src')) frame.src = trigger.href;
    exit.focus();
    if (!document.fullscreenElement && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      Promise.resolve(document.documentElement.requestFullscreen()).then(() => {
        if (dialog.open) enteredHere = true;
        else if (document.fullscreenElement) Promise.resolve(document.exitFullscreen()).catch(() => {});
      }).catch(() => {}); // modal already fills the viewport
    }
  });
  exit.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (enteredHere && document.fullscreenElement) Promise.resolve(document.exitFullscreen()).catch(() => {});
    enteredHere = false;
    trigger.focus();
  });
})();
