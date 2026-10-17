import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, characterFields, validateAppearance, validateCharacter } from '../src/model.js';
import { serialPoll, overlayPresenter } from '../src/poll.js';
import { repository } from '../src/api.js';
import { cleanupPortraits } from '../src/cleanup.js';

const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const row = { id: 'a', name: 'A', notes: '', hp: 100, max_hp: 100, active_slot: 'Normal', font: 'Arial', name_color: '#ffffff', name_size: 25, show_hp: true, images: {} };

test('remote refresh/upload preserves drafts while merging unrelated remote fields', () => {
  const store = new DraftStore(characterFields); store.ingest(row);
  store.edit('a', { notes: 'unfinished text' });
  store.ingest({ ...row, hp: 40, images: { Normal: 'https://image.test/a' } });
  assert.equal(store.get('a').draft.notes, 'unfinished text');
  assert.equal(store.get('a').draft.hp, 40);
  assert.deepEqual(store.changes('a'), { patch: { notes: 'unfinished text' }, expected: { notes: '' } });
});
test('concurrent field conflict is preserved until explicit resolution', () => {
  const store = new DraftStore(characterFields); store.ingest(row); store.edit('a', { hp: 50 });
  store.ingest({ ...row, hp: 40 });
  assert.deepEqual(store.conflicts('a'), ['hp']);
  assert.equal(store.changes('a').expected.hp, 100);
  store.rebase('a'); assert.equal(store.changes('a').expected.hp, 40);
  assert.equal(store.get('a').draft.hp, 50);
  store.reset('a'); assert.equal(store.get('a').draft.hp, 40);
});
test('typing while save is in flight remains dirty after successful save', () => {
  const store = new DraftStore(characterFields); store.ingest(row); store.edit('a', { notes: 'sent' });
  const { patch } = store.changes('a'); store.edit('a', { notes: 'typed later' });
  store.saved({ ...row, notes: 'sent' }, patch);
  assert.deepEqual(store.changes('a'), { patch: { notes: 'typed later' }, expected: { notes: 'sent' } });
});
test('late background responses cannot roll back a saved version', () => {
  const store = new DraftStore(characterFields); store.ingest({ ...row, version: 1 });
  store.edit('a', { hp: 40 }); store.saved({ ...row, hp: 40, version: 2 }, { hp: 40 });
  store.ingest({ ...row, version: 1 });
  assert.equal(store.get('a').draft.hp, 40); assert.equal(store.dirty('a'), false);
});
test('save acknowledgement cannot roll back a newer remote version', () => {
  const store = new DraftStore(characterFields); store.ingest({ ...row, version: 1 }); store.edit('a', { hp: 40 });
  store.ingest({ ...row, hp: 20, version: 3 });
  store.saved({ ...row, hp: 40, version: 2 }, { hp: 40 });
  assert.equal(store.get('a').draft.hp, 20); assert.equal(store.get('a').remote.version, 3);
});
test('validation rejects invalid numeric values, slots, colors and fits', () => {
  validateCharacter(row);
  for (const change of [{ hp: NaN }, { hp: 101 }, { max_hp: Infinity }, { name_size: 25.5 }, { active_slot: 'unknown' }, { name_color: 'red' }]) assert.throws(() => validateCharacter({ ...row, ...change }));
  const appearance = { bar: 'Pixel Art', grad1: '#ffffff', grad2: '#000000', fits: {} };
  validateAppearance(appearance, ['Pixel Art']);
  for (const fit of [{ x: -1, y: 0, w: 50, h: 10 }, { x: 80, y: 0, w: 50, h: 10 }, { x: 0, y: 0, w: null, h: 10 }]) assert.throws(() => validateAppearance({ ...appearance, fits: { 'Pixel Art': fit } }, ['Pixel Art']));
});
test('polling never overlaps requests and stop ignores in-flight response', async () => {
  const d = deferred(); let calls = 0, rendered = 0, scheduled = 0;
  const poll = serialPoll(() => { calls++; return d.promise; }, { onValue: () => rendered++, schedule: () => scheduled++, cancel() {} });
  const first = poll.start(); await poll.tick(); await poll.tick(); assert.equal(calls, 1);
  poll.stop(); d.resolve(row); await first; assert.equal(rendered, 0); assert.equal(scheduled, 0);
});
test('OBS clears transient errors on identical data and removes deleted portraits', () => {
  const root = { children: [], replaceChildren(...c) { this.children = c; } }, error = { textContent: '' };
  let renders = 0;
  const presenter = overlayPresenter(root, error, (r, d) => { renders++; r.replaceChildren(d); });
  presenter.value(row); presenter.error(Error('offline')); presenter.value(row);
  assert.equal(error.textContent, ''); assert.equal(renders, 1);
  presenter.value(null); assert.equal(root.children.length, 0);
  presenter.value(row); assert.equal(renders, 2);
});
test('portrait upload captures destination and stops after account change', async () => {
  const d = deferred(); const calls = [];
  const db = { storage: { from: () => ({ upload: () => d.promise, getPublicUrl: () => ({ data: { publicUrl: 'https://image.test/a' } }) }) }, rpc: async (name, args) => { calls.push(args); return { data: row }; } };
  const target = { characterId: 'a', slot: 'Normal', userId: 'u', file: { type: 'image/png', size: 100 } };
  const pending = repository(db).uploadPortrait(target); target.characterId = 'b'; target.slot = 'Combate';
  d.resolve({ data: {} }); await pending;
  assert.equal(calls[0].target_id, 'a'); assert.equal(calls[0].slot_name, 'Normal');
  await assert.rejects(repository(db).uploadPortrait({ ...target, current: () => false }), /sessão mudou/);
  assert.equal(calls.length, 1);
});
test('cleanup retains failed queue jobs and only completes successful Storage deletion', async () => {
  const completed = [], errors = [];
  const db = {
    rpc: async () => ({ data: [{ object_name: 'ok' }, { object_name: 'fail' }] }),
    storage: { from: () => ({ remove: async ([path]) => ({ error: path === 'fail' ? Error('offline') : null }) }) },
    from: () => ({ delete: () => ({ eq: async (_, path) => { completed.push(path); return {}; } }), update: () => ({ eq: async (_, path) => { errors.push(path); return {}; } }) })
  };
  assert.deepEqual(await cleanupPortraits(db), { removed: 1, failed: 1 });
  assert.deepEqual(completed, ['ok']); assert.deepEqual(errors, ['fail']);
});
