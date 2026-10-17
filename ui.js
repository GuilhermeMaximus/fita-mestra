// Optional interface transitions only. Opens directly, without an introduction.
export function initMotion(doc = document, win = window) {
  const control = doc.getElementById('motionOff');
  const system = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let preference = false;
  try { preference = win.localStorage.getItem('fita-mestra-reduce-motion') === 'true'; } catch {}
  function update() {
    const reduced = preference || !!system?.matches;
    doc.documentElement.classList.toggle('reduce-motion', reduced); control.checked = reduced;
  }
  control.onchange = () => {
    preference = control.checked;
    try { win.localStorage.setItem('fita-mestra-reduce-motion', String(preference)); } catch {}
    update();
  };
  system?.addEventListener('change', update); update();
  return () => system?.removeEventListener('change', update);
}
