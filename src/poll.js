// One request at a time, including manual refresh. Stop invalidates late responses.
export function serialPoll(task, { delay = 2000, onValue, onError, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let stopped = true, running = false, timer, generation = 0;
  async function tick() {
    if (stopped || running) return;
    running = true;
    const current = generation;
    try {
      const value = await task();
      if (!stopped && current === generation) await onValue?.(value);
    } catch (error) {
      if (!stopped && current === generation) onError?.(error);
    } finally {
      running = false;
      if (!stopped) timer = schedule(tick, delay);
    }
  }
  return {
    start() { if (!stopped) return; stopped = false; generation++; return tick(); },
    stop() { stopped = true; generation++; cancel(timer); },
    tick
  };
}

export function overlayPresenter(root, errorNode, render) {
  let previous = '';
  return {
    value(data) {
      errorNode.textContent = '';
      if (!data) {
        previous = '';
        root.replaceChildren();
        errorNode.textContent = 'Personagem indisponível ou link revogado.';
        return;
      }
      const json = JSON.stringify(data);
      if (json !== previous) { render(root, data); previous = json; }
    },
    error() { errorNode.textContent = 'Reconectando… A exibição pode estar desatualizada.'; }
  };
}
