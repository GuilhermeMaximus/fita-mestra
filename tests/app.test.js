import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createApp } from '../src/app.js';
import { bars } from '../shared.js';

const html = await readFile('index.html', 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const campaign = id => ({ id, title: id, owner_id: 'u', invite_code: id, bar: 'Pixel Art', grad1: '#ffffff', grad2: '#000000', fits: {} });
const character = (id, cid = 'a') => ({ id, campaign_id: cid, owner_id: 'u', overlay_token: id, name: id, notes: '', hp: 100, max_hp: 100, images: {}, active_slot: 'Normal', font: 'Arial', name_color: '#ffffff', name_size: 25, show_hp: true });
async function fixture(t) {
  const dom = new JSDOM(html, { url: 'https://site.test/index.html' });
  dom.window.confirm = () => true;
  const calls = [];
  const rows = { a: [character('A'), character('A2')], b: [character('B', 'b')] };
  const api = {
    campaigns: async () => [campaign('a'), campaign('b')],
    characters: async id => structuredClone(rows[id]),
    members: async () => [],
    saveCharacter: async (id, { patch }) => { calls.push({ id, patch }); const row = Object.values(rows).flat().find(c => c.id === id); Object.assign(row, patch); return structuredClone(row); },
    saveCampaign: async (id, { patch }) => ({ ...campaign(id), ...patch }),
    createCharacter: async id => character('new', id),
    uploadPortrait: async ({ characterId, slot }) => { const row = Object.values(rows).flat().find(c => c.id === characterId); row.images[slot] = 'https://image.test/a'; return structuredClone(row); }
  };
  const app = createApp({ db: {}, api, win: dom.window, doc: dom.window.document, autoSync: false });
  const $ = id => dom.window.document.getElementById(id);
  const input = (id, value) => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event('input')); };
  t.after(() => { app.stop(); dom.window.close(); });
  await app.sessionChanged({ user: { id: 'u', email: 'u@example.test' } }, 'SIGNED_IN');
  return { app, api, rows, calls, $, input, dom };
}

test('task tabs preserve drafts and support Arrow, Home and End keys', async t => {
  const f = await fixture(t), w = f.dom.window;
  f.$('tab-sheet').click(); f.input('notes', 'Rascunho entre abas');
  f.$('tab-sheet').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(f.$('tab-obs').getAttribute('aria-selected'), 'true');
  assert.equal(f.dom.window.document.activeElement, f.$('tab-obs'));
  assert.equal(f.$('panel-sheet').hidden, true);
  f.$('tab-obs').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(f.$('tab-session').tabIndex, 0);
  f.$('tab-session').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(f.$('notes').value, 'Rascunho entre abas');
  assert.equal(f.$('saveCharacter').disabled, false);
  await f.$('saveCharacter').onclick();
  assert.equal(f.$('saveCharacter').disabled, true);
});

test('sync preserves keyboard focus in roster and visual bar selector', async t => {
  const f = await fixture(t);
  const rosterButton = f.$('characters').children[1]; rosterButton.focus();
  await f.app.refreshCampaigns();
  assert.equal(f.dom.window.document.activeElement, rosterButton);
  f.$('campaignSettings').click();
  const bar = f.$('barOptions').children[2]; bar.focus(); bar.click();
  await f.app.refreshCampaigns();
  assert.equal(f.dom.window.document.activeElement, bar);
  assert.equal(bar.getAttribute('aria-pressed'), 'true');
});

test('portrait selection chooses upload destination without changing live state', async t => {
  const f = await fixture(t);
  f.$('portraitGallery').children[1].click();
  assert.equal(f.$('uploadSlot').value, 'Combate');
  assert.equal(f.$('activeSlot').value, 'Normal');
  assert.equal(f.app.chars.dirty('A'), false);
  f.input('activeSlot', 'Combate');
  assert.equal(f.app.chars.dirty('A'), true);
});

test('invalid fields are revealed in their tab before save can proceed', async t => {
  const f = await fixture(t);
  f.input('charName', '');
  f.$('tab-session').click();
  await f.$('saveCharacter').onclick();
  assert.equal(f.$('panel-sheet').hidden, false);
  assert.equal(f.dom.window.document.activeElement, f.$('charName'));
  assert.equal(f.calls.length, 0);
});

test('empty campaigns and empty rosters have actionable first steps', async t => {
  const f = await fixture(t);
  f.rows.a = []; await f.app.refreshCharacters();
  assert.equal(f.$('noCharacter').classList.contains('hidden'), false);
  assert.equal(f.$('editor').classList.contains('hidden'), true);
  f.api.campaigns = async () => []; await f.app.refreshCampaigns();
  assert.equal(f.$('noCampaign').classList.contains('hidden'), false);
  assert.equal(f.$('campaignSettings').disabled, true);
});

test('campaign dialog keeps errors inside the dialog and submits one create', async t => {
  const f = await fixture(t);
  f.$('campaignDialog').showModal = () => { f.$('campaignDialog').open = true; };
  f.$('campaignDialog').close = () => { f.$('campaignDialog').open = false; };
  f.dom.window.document.querySelector('[data-open-campaign]').click();
  await f.$('createCampaign').onclick();
  assert.match(f.$('dialogMessage').textContent, /nome de campanha/);
  f.api.rpc = async () => 'a'; f.$('newCampaign').value = 'Nova mesa';
  await f.$('createCampaign').onclick();
  assert.equal(f.$('campaignDialog').open, false);
});

test('every available bar has a visible thumbnail and remains selectable', async t => {
  const f = await fixture(t);
  assert.equal(f.$('barOptions').children.length, Object.keys(bars).length);
  for (const tile of f.$('barOptions').children) {
    assert.equal(tile.querySelector('img').getAttribute('src'), bars[tile.dataset.bar]);
    tile.click();
    assert.equal(f.app.appearances.get('a').draft.bar, tile.dataset.bar);
  }
});

test('authentication has one native submit action for each mode', async t => {
  const f = await fixture(t), doc = f.dom.window.document;
  assert.equal(f.$('login').type, 'submit');
  doc.querySelector('[data-auth-mode="signup"]').click();
  assert.equal(f.$('signup').type, 'submit'); assert.equal(f.$('login').type, 'button');
  doc.querySelector('[data-auth-mode="login"]').click();
  doc.querySelector('[data-auth-mode="reset"]').click();
  assert.equal(f.$('resetPassword').type, 'submit'); assert.equal(f.$('password').required, false);
  assert.equal(doc.querySelectorAll('#authForm button[type=submit]').length, 1);
});

test('upload preserves unsaved form and original destination across character selection', async t => {
  const f = await fixture(t); const d = deferred(); let target;
  f.input('notes', 'unsaved A');
  f.api.uploadPortrait = args => { target = args; return d.promise; };
  Object.defineProperty(f.$('upload'), 'files', { value: [{ type: 'image/png', size: 100 }] });
  const pending = f.$('upload').onchange();
  f.$('characters').children[1].click(); f.$('uploadSlot').value = 'Combate';
  assert.equal(target.characterId, 'A'); assert.equal(target.slot, 'Normal');
  d.resolve({ ...character('A'), images: { Normal: 'https://image.test/a' } }); await pending;
  assert.equal(f.app.selection.characterId, 'A2');
  f.$('characters').children[0].click();
  assert.equal(f.$('notes').value, 'unsaved A');
  assert.equal(f.app.chars.get('A').draft.images.Normal, 'https://image.test/a');
});
test('late campaign response never replaces current campaign characters', async t => {
  const f = await fixture(t); const d = deferred();
  f.api.characters = id => id === 'a' ? d.promise : Promise.resolve([character('B','b')]);
  const old = f.app.selectCampaign('a'); await f.app.selectCampaign('b');
  d.resolve([character('A')]); await old;
  assert.equal(f.app.selection.campaignId, 'b'); assert.equal(f.app.selection.characterId, 'B');
  assert.equal(f.$('charName').value, 'B');
});
test('campaign save completion updates only its original record', async t => {
  const f = await fixture(t); const d = deferred();
  f.$('grad1').value = '#123456'; f.$('grad1').oninput();
  f.api.saveCampaign = () => d.promise;
  const pending = f.$('saveCampaign').onclick(); await f.app.selectCampaign('b');
  d.resolve({ ...campaign('a'), grad1: '#123456' }); await pending;
  assert.equal(f.$('grad1').value, '#ffffff');
  assert.equal(f.app.appearances.get('a').remote.grad1, '#123456');
  assert.equal(f.app.appearances.get('b').remote.grad1, '#ffffff');
});
test('auth refresh preserves draft and account switch clears prior records and chooses a valid campaign', async t => {
  const f = await fixture(t); f.input('notes', 'unfinished');
  await f.app.sessionChanged({ user: { id: 'u' } }, 'TOKEN_REFRESHED');
  assert.equal(f.$('notes').value, 'unfinished');
  await f.app.sessionChanged(null, 'SIGNED_OUT');
  f.api.campaigns = async () => [{ ...campaign('b'), owner_id: 'v' }];
  await f.app.sessionChanged({ user: { id: 'v' } }, 'SIGNED_IN');
  assert.equal(f.app.selection.campaignId, 'b');
  assert.equal(f.app.chars.get('A'), undefined);
  assert.equal(f.$('notes').value, '');
});
test('saving notes does not send stale HP; typing during save is preserved', async t => {
  const f = await fixture(t); f.input('notes','sent');
  const d = deferred(); let changes;
  f.api.saveCharacter = (_, ch) => { changes = ch; return d.promise; };
  const pending = f.$('saveCharacter').onclick();
  assert.deepEqual(changes, { patch: { notes: 'sent' }, expected: { notes: '' } });
  f.input('notes','typed later');
  d.resolve({ ...character('A'), hp: 40, notes: 'sent' }); await pending;
  assert.equal(f.$('hp').value, '40'); assert.equal(f.$('notes').value, 'typed later');
  assert.equal(f.app.chars.dirty('A'), true);
});
test('repeated create clicks trigger one mutation', async t => {
  const f = await fixture(t); const d = deferred(); let calls = 0;
  f.api.createCharacter = () => { calls++; return d.promise; };
  const pending = f.$('newCharacter').onclick(); await f.$('newCharacter').onclick();
  assert.equal(calls,1); d.resolve(character('new')); await pending;
});
test('remote update of a focused field does not become an accidental local edit', async t => {
  const f = await fixture(t); f.$('hp').focus(); f.rows.a[0].hp = 40;
  await f.app.refreshCharacters(); await f.app.refreshCharacters();
  assert.equal(f.$('hp').value,'40'); assert.equal(f.app.chars.dirty('A'),false);
});
test('input labels are associated and preview uses same renderer contract as OBS', async t => {
  const f = await fixture(t);
  for (const el of f.dom.window.document.querySelectorAll('input,textarea,select')) assert.ok(el.labels.length > 0, el.id);
  assert.equal(f.$('preview').querySelectorAll('.obs-img').length,1);
  assert.equal(f.$('preview').querySelector('.bar-fill').style.width,'100%');
});
