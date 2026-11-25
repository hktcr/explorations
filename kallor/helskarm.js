(() => {
  const graph = document.getElementById('sourceGraph');
  const toggle = document.getElementById('sourceFullscreen');
  const outside = [];
  let pending = false;
  let active = false;
  let fallback = false;

  function setActive(on) {
    active = on;
    graph.classList.toggle('source-fullscreen', on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Avsluta helskärm' : 'Helskärm';
    toggle.focus({preventScroll:true});
  }

  function setFallback(on) {
    fallback = on;
    graph.classList.toggle('source-fullscreen-fallback', on);
    document.documentElement.classList.toggle('source-fullscreen-open', on);
    if (on) {
      graph.setAttribute('role', 'dialog');
      graph.setAttribute('aria-modal', 'true');
      for (let branch = graph; branch !== document.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling !== branch && !sibling.hasAttribute('inert')) {
            sibling.setAttribute('inert', '');
            outside.push(sibling);
          }
        }
      }
    } else {
      graph.removeAttribute('role');
      graph.removeAttribute('aria-modal');
      for (const sibling of outside.splice(0)) sibling.removeAttribute('inert');
    }
    setActive(on);
  }

  document.addEventListener('fullscreenchange', () => {
    if (!fallback && (active || document.fullscreenElement === graph)) {
      setActive(document.fullscreenElement === graph);
    }
  });

  toggle.addEventListener('click', async () => {
    if (pending) return;
    if (fallback) return setFallback(false);
    pending = true;
    try {
      if (document.fullscreenElement === graph) {
        await document.exitFullscreen();
      } else if (graph.requestFullscreen && document.fullscreenEnabled !== false) {
        try {
          await graph.requestFullscreen();
        } catch {
          setFallback(true);
        }
      } else {
        setFallback(true);
      }
    } finally {
      pending = false;
    }
  });

  graph.addEventListener('keydown', event => {
    if (!fallback) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setFallback(false);
    } else if (event.key === 'Tab') {
      const controls = [...graph.querySelectorAll('button, a[href], input, select, [tabindex]')]
        .filter(el => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
})();
