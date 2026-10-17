import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initMotion } from '../ui.js';

test('entry has no image or intro and still respects reduced motion', async () => {
  const dom = new JSDOM(await readFile('index.html', 'utf8'), { url: 'https://site.test' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const stop = initMotion(w.document, w);
  assert.equal(w.document.querySelector('.auth-story img'), null);
  assert.equal(w.document.querySelector('.intro-film'), null);
  assert.equal(w.document.querySelector('#replayIntro'), null);
  assert.equal(w.document.documentElement.classList.contains('reduce-motion'), true);
  stop(); w.close();
});
