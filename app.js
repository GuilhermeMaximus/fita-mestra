import { initMotion } from './ui.js';
import { client } from './src/client.js';
import { createApp } from './src/app.js';
import { createMockClient, mountTestControls } from './src/mock-client.js';
initMotion();

try {
  if (window.FITA_CONFIG?.mode === 'mock') {
    const mock = await createMockClient();
    const app = createApp({ db: mock.db, api: mock.api });
    await app.start(); mountTestControls(mock, app);
  } else {
    const app = createApp({ db: client(window.FITA_CONFIG), doc: document, win: window });
    await app.start();
  }
} catch (error) {
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('message').textContent = error.message;
}
