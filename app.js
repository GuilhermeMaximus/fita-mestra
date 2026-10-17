import { client } from './src/client.js';
import { createApp } from './src/app.js';

try {
  const app = createApp({ db: client(window.FITA_CONFIG), doc: document, win: window });
  app.start();
} catch (error) {
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('message').textContent = error.message;
}
