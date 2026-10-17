import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockStore } from '../scripts/mock-store.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fita-mestra-test-')), file = join(dir, 'data.json');
  t.after(() => { for (const f of [file, file + '.tmp']) if (existsSync(f)) unlinkSync(f); rmdirSync(dir); });
  const store = createMockStore(file);
  const run = (op, args = {}, user = 'demo-master') => store.execute(op, args, user);
  return { file, run };
}
test('local test database survives reopening and protects concurrent field edits', t => {
  const { run, file } = fixture(t);
  run('saveCharacter', { id: 'lyra', changes: { patch: { hp: 31 }, expected: { hp: 32 } } });
  assert.throws(() => run('saveCharacter', { id: 'lyra', changes: { patch: { hp: 30 }, expected: { hp: 32 } } }), /CONFLITO/);
  run('saveCharacter', { id: 'lyra', changes: { patch: { notes: 'Nova história' }, expected: { notes: 'Patrulheira das fronteiras.\nInventário: arco longo e mapa das ruínas.' } } });
  const saved = createMockStore(file).execute('characters', { id: 'mesa' }, 'demo-master').find(c => c.id === 'lyra');
  assert.equal(saved.hp, 31); assert.equal(saved.notes, 'Nova história');
});
test('mock player permissions and invitation joins are enforced', t => {
  const { run } = fixture(t);
  assert.throws(() => run('saveCharacter', { id: 'lyra', changes: { patch: { hp: 31 }, expected: { hp: 32 } } }, 'demo-player'), /permissão/);
  assert.throws(() => run('members', { id: 'mesa' }, 'demo-player'), /mestre/);
  const user = run('register', { email: 'novo@example.test' });
  assert.deepEqual(run('campaigns', {}, user.id), []);
  assert.throws(() => run('rpc', { name: 'join_campaign', args: { code: 'INVALIDO' } }, user.id), /inválido/);
  run('rpc', { name: 'join_campaign', args: { code: 'AETHER2026' } }, user.id);
  assert.equal(run('campaigns', {}, user.id).length, 1);
  const c = run('createCharacter', { id: 'mesa' }, user.id);
  assert.equal(c.owner_id, user.id);
});
test('mock removal transfers characters and revokes all existing overlay links', t => {
  const { run } = fixture(t);
  const before = run('characters', { id: 'mesa' });
  run('rpc', { name: 'remove_campaign_member', args: { cid: 'mesa', target_user: 'demo-player' } });
  assert.deepEqual(run('campaigns', {}, 'demo-player'), []);
  assert.equal(run('characters', { id: 'mesa' }).find(c => c.id === 'dorian').owner_id, 'demo-master');
  for (const c of before) assert.equal(run('overlay', { token: c.overlay_token }), null);
  assert.throws(() => run('rpc', { name: 'leave_campaign', args: { cid: 'mesa' } }), /mestre/);
});
test('mock portraits persist and independent OBS reads get current data', t => {
  const { run, file } = fixture(t);
  const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7kAAAAASUVORK5CYII=';
  const c = run('uploadPortrait', { id: 'lyra', slot: 'Normal', data });
  const overlay = createMockStore(file).execute('overlay', { token: c.overlay_token });
  assert.equal(overlay.images.Normal, data);
  assert.equal(overlay.bar, 'Pixel Art');
  run('deleteCharacter', { id: c.id });
  assert.equal(run('overlay', { token: c.overlay_token }), null);
});
test('mock rotations, appearance and reset mutate real local state', t => {
  const { run } = fixture(t);
  const old = run('characters', { id: 'mesa' })[0];
  const c = run('rpc', { name: 'rotate_overlay', args: { target_id: old.id } });
  assert.notEqual(c.overlay_token, old.overlay_token);
  run('saveCampaign', { id: 'mesa', changes: { patch: { bar: 'Dark' }, expected: { bar: 'Pixel Art' } } });
  assert.equal(run('overlay', { token: c.overlay_token }).bar, 'Dark');
  run('rpc', { name: 'rotate_invite', args: { cid: 'mesa' } });
  assert.notEqual(run('campaigns')[0].invite_code, 'AETHER2026');
  run('rpc', { name: 'create_campaign', args: { campaign_title: 'Segunda mesa' } });
  assert.equal(run('campaigns').length, 2);
  run('reset'); assert.equal(run('campaigns').length, 1);
});
test('invalid and unsupported mock writes fail without changing the database', t => {
  const { run, file } = fixture(t);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => run('saveCharacter', { id: 'lyra', changes: { patch: { hp: 900 }, expected: { hp: 32 } } }), /vida atual/);
  assert.throws(() => run('rpc', { name: 'not_implemented', args: {} }), /não implementada/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
