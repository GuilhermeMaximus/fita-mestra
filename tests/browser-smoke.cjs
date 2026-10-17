// Optional end-to-end smoke check using a locally installed Playwright.
// All Supabase traffic is intercepted; no real account or database is touched.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('dist');
  const server = http.createServer(async (req, res) => {
    try {
      const relative = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html');
      const filename = path.resolve(root, '.' + relative);
      if (!filename.startsWith(root + path.sep)) throw Error('outside root');
      const data = await fs.readFile(filename);
      res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' })[path.extname(filename)] || 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    const uid = '11111111-1111-4111-8111-111111111111', cid = '22222222-2222-4222-8222-222222222222';
    const token = '33333333-3333-4333-8333-333333333333';
    const ca = { id: cid, owner_id: uid, title: 'Mesa de teste', invite_code: 'TESTE', bar: 'Pixel Art', grad1: '#f064a5', grad2: '#8c72ff', fits: {}, version: 1 };
    let ch = { id: token, campaign_id: cid, owner_id: uid, overlay_token: token, name: 'Personagem de teste', notes: '', hp: 100, max_hp: 100, images: {}, active_slot: 'Normal', font: 'Georgia', name_color: '#ffffff', name_size: 25, show_hp: true, version: 1 };
    let overlayExists = true;
    const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const jwt = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.test';
    await context.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.FITA_CONFIG={supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'public-test-key'}" }));
    await context.route('https://test.supabase.co/**', async route => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname.endsWith('/auth/v1/token')) data = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user: { id: uid, email: 'test@example.test', aud: 'authenticated' } };
      else if (url.pathname.endsWith('/campaigns')) data = [ca];
      else if (url.pathname.endsWith('/characters')) data = [ch];
      else if (url.pathname.endsWith('/list_campaign_members')) data = [];
      else if (url.pathname.endsWith('/save_character')) { const body = route.request().postDataJSON(); ch = { ...ch, ...body.patch, version: ch.version + 1 }; data = ch; }
      else if (url.pathname.endsWith('/get_overlay')) data = overlayExists ? { ...ch, ...ca, name: ch.name } : null;
      else { errors.push('Unexpected request: ' + url.pathname); data = {}; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base);
    await page.getByLabel('E-mail', { exact: true }).fill('test@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Entrar no estúdio', exact: true }).click();
    await page.locator('#editor').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Ficha', exact: true }).click();
    await page.getByLabel('Anotações').fill('Texto preservado durante sincronização');
    await page.waitForTimeout(5500);
    assert.equal(await page.getByLabel('Anotações').inputValue(), 'Texto preservado durante sincronização');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('draftStatus').textContent === 'Tudo salvo');
    assert.equal(ch.notes, 'Texto preservado durante sincronização');
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.getElementById('preview').getBoundingClientRect().width < 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    const overlay = await context.newPage(); overlay.on('pageerror', e => errors.push(e.message));
    await overlay.setViewportSize({ width: 490, height: 320 });
    await overlay.goto(base + '/obs.html?id=' + token);
    await overlay.locator('.bar-fill').waitFor();
    assert.equal(await overlay.locator('.bar-frame').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await overlay.screenshot({ path: 'test-results/overlay.png', omitBackground: true });
    overlayExists = false;
    await overlay.waitForFunction(() => document.getElementById('overlay').children.length === 0);
    assert.equal(await overlay.locator('#error').textContent(), 'Personagem indisponível ou link revogado.');
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: login, polling, draft preservation, save, mobile layout, images and revoked overlay.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
