import { client } from './src/client.js';
import { unwrap } from './src/api.js';
import { renderOverlay } from './shared.js';
import { overlayPresenter, serialPoll } from './src/poll.js';
import { mockRequest } from './src/mock-client.js';

const errorNode = document.getElementById('error');
try {
  const token = new URLSearchParams(location.search).get('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token || '')) throw Error('Use um link OBS válido.');
  const mock = window.FITA_CONFIG?.mode === 'mock';
  const db = mock ? null : client(window.FITA_CONFIG, true);
  const presenter = overlayPresenter(document.getElementById('overlay'), errorNode, renderOverlay);
  const poll = serialPoll(async () => mock ? mockRequest('overlay', { token }) : unwrap(await db.rpc('get_overlay', { token })), {
    onValue: presenter.value,
    onError: presenter.error
  });
  poll.start();
  window.addEventListener('pagehide', () => poll.stop());
  window.addEventListener('pageshow', () => poll.start());
} catch (error) { errorNode.textContent = error.message; }
