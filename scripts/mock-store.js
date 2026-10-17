// Local simulator, not an authentication service or replacement for PostgreSQL/RLS tests.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { bars } from '../shared.js';
import { characterFields, campaignFields, slots, equal, validateCharacter, validateAppearance } from '../src/model.js';

export function seedData() {
  const users = [{ id: 'demo-master', email: 'mestre@exemplo.com' }, { id: 'demo-player', email: 'jogador@exemplo.com' }];
  const campaign = { id: 'mesa', title: 'Ecos de Aether', owner_id: users[0].id, invite_code: 'AETHER2026', bar: 'Pixel Art', grad1: '#f064a5', grad2: '#8c72ff', fits: {}, version: 1 };
  const base = { campaign_id: 'mesa', images: {}, active_slot: 'Normal', font: 'Georgia', name_color: '#ffffff', name_size: 25, show_hp: true, version: 1 };
  return { format: 1, users, campaigns: [campaign], members: users.map(u => ({ campaign_id: 'mesa', user_id: u.id })), characters: [
    { ...base, id: 'lyra', owner_id: users[0].id, overlay_token: randomUUID(), name: 'Lyra Valen', hp: 32, max_hp: 45, notes: 'Patrulheira das fronteiras.\nInventário: arco longo e mapa das ruínas.' },
    { ...base, id: 'dorian', owner_id: users[1].id, overlay_token: randomUUID(), name: 'Dorian Ash', hp: 18, max_hp: 60, notes: 'O escudo da companhia.' },
    { ...base, id: 'mira', owner_id: users[0].id, overlay_token: randomUUID(), name: 'Mira Sol', hp: 28, max_hp: 28, notes: 'Aprendiz dos arquivos celestes.' }
  ] };
}

export function createMockStore(filename) {
  let state;
  if (existsSync(filename)) {
    state = JSON.parse(readFileSync(filename, 'utf8'));
    if (state.format !== 1) throw Error('Formato do banco de teste incompatível. Preserve o arquivo antes de reiniciar os testes.');
  } else { state = seedData(); persist(); }
  function persist() {
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename + '.tmp', JSON.stringify(state), 'utf8');
    renameSync(filename + '.tmp', filename);
  }
  const need = (condition, message) => { if (!condition) throw Error(message); };
  const campaign = id => {
    const c = state.campaigns.find(c => c.id === id); need(c, 'Campanha não encontrada.'); return c;
  };
  const member = (cid, uid) => state.members.some(m => m.campaign_id === cid && m.user_id === uid);
  const access = (cid, uid) => { const c = campaign(cid); need(member(cid, uid), 'Sem acesso à campanha.'); return c; };
  const master = (cid, uid) => { const c = access(cid, uid); need(c.owner_id === uid, 'Somente o mestre.'); return c; };
  const editable = (id, uid) => {
    const c = state.characters.find(c => c.id === id); need(c, 'Personagem não encontrado.');
    const ca = access(c.campaign_id, uid); need(c.owner_id === uid || ca.owner_id === uid, 'Sem permissão para editar este personagem.'); return c;
  };
  function save(row, changes, fields, validate) {
    const { patch, expected } = changes || {};
    need(patch && expected && typeof patch === 'object' && !Array.isArray(patch), 'Alterações inválidas.');
    for (const key of Object.keys(patch)) {
      need(fields.includes(key), 'Campo não permitido.');
      need(Object.hasOwn(expected, key) && equal(row[key], expected[key]), 'CONFLITO: o campo ' + key + ' mudou em outra sessão.');
    }
    const next = { ...row, ...patch }; validate(next);
    Object.assign(row, next, { version: row.version + 1 }); return row;
  }
  function leave(cid, target, uid, removing) {
    const ca = removing ? master(cid, uid) : access(cid, uid);
    need(target !== ca.owner_id, 'O mestre não pode sair da campanha.');
    need(member(cid, target), 'Participante não encontrado.');
    state.members = state.members.filter(m => m.campaign_id !== cid || m.user_id !== target);
    for (const c of state.characters.filter(c => c.campaign_id === cid)) {
      if (c.owner_id === target) c.owner_id = ca.owner_id;
      c.overlay_token = randomUUID(); c.version++;
    }
    ca.invite_code = randomUUID(); ca.version++; return null;
  }
  function perform(op, args, uid) {
    if (op === 'profiles') return state.users;
    if (op === 'overlay') {
      const c = state.characters.find(c => c.overlay_token === args.token);
      if (!c) return null;
      const ca = campaign(c.campaign_id);
      return { ...c, ...Object.fromEntries(campaignFields.map(k => [k, ca[k]])) };
    }
    if (op === 'register') {
      const email = String(args.email || '').trim().toLowerCase();
      need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'E-mail inválido.');
      need(!state.users.some(u => u.email === email), 'Esta conta de teste já existe.');
      const user = { id: randomUUID(), email }; state.users.push(user); return user;
    }
    need(state.users.some(u => u.id === uid), 'Escolha um perfil de teste válido.');
    if (op === 'reset') { state = seedData(); return null; }
    if (op === 'campaigns') return state.campaigns.filter(c => member(c.id, uid));
    if (op === 'characters') { access(args.id, uid); return state.characters.filter(c => c.campaign_id === args.id); }
    if (op === 'members') {
      master(args.id, uid);
      return state.members.filter(m => m.campaign_id === args.id).map(m => ({ ...m, label: state.users.find(u => u.id === m.user_id)?.email || m.user_id }));
    }
    if (op === 'createCharacter') {
      access(args.id, uid);
      const c = { id: randomUUID(), campaign_id: args.id, owner_id: uid, overlay_token: randomUUID(), name: 'Novo personagem', notes: '', hp: 100, max_hp: 100, images: {}, active_slot: 'Normal', font: 'Arial', name_color: '#ffffff', name_size: 25, show_hp: true, version: 1 };
      state.characters.push(c); return c;
    }
    if (op === 'saveCharacter') return save(editable(args.id, uid), args.changes, characterFields, validateCharacter);
    if (op === 'saveCampaign') return save(master(args.id, uid), args.changes, campaignFields, d => validateAppearance(d, Object.keys(bars)));
    if (op === 'deleteCharacter') { editable(args.id, uid); state.characters = state.characters.filter(c => c.id !== args.id); return { id: args.id }; }
    if (op === 'uploadPortrait') {
      const c = editable(args.id, uid);
      need(slots.includes(args.slot), 'Estado inválido.');
      need(typeof args.data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(args.data), 'Imagem inválida.');
      need(Buffer.from(args.data.split(',')[1], 'base64').length <= 5 * 1024 * 1024, 'Use imagem de até 5 MB.');
      c.images = { ...c.images, [args.slot]: args.data }; c.version++; return c;
    }
    if (op === 'rpc') {
      const a = args.args;
      switch (args.name) {
        case 'create_campaign': {
          const title = String(a.campaign_title || '').trim(); need(title.length > 0 && title.length <= 100, 'Nome de campanha inválido.');
          const c = { id: randomUUID(), owner_id: uid, title, invite_code: randomUUID(), bar: 'Pixel Art', grad1: '#f064a5', grad2: '#8c72ff', fits: {}, version: 1 };
          state.campaigns.unshift(c); state.members.push({ campaign_id: c.id, user_id: uid }); return c.id;
        }
        case 'join_campaign': {
          const c = state.campaigns.find(c => c.invite_code === String(a.code || '').trim()); need(c, 'Código de convite inválido.');
          if (!member(c.id, uid)) state.members.push({ campaign_id: c.id, user_id: uid }); return c.id;
        }
        case 'rotate_overlay': { const c = editable(a.target_id, uid); c.overlay_token = randomUUID(); c.version++; return c; }
        case 'rotate_invite': { const c = master(a.cid, uid); c.invite_code = randomUUID(); c.version++; return c; }
        case 'remove_campaign_member': return leave(a.cid, a.target_user, uid, true);
        case 'leave_campaign': return leave(a.cid, uid, uid, false);
        default: throw Error('Operação de teste não implementada: ' + args.name);
      }
    }
    throw Error('Operação de teste desconhecida.');
  }
  const reads = new Set(['profiles', 'overlay', 'campaigns', 'characters', 'members']);
  return {
    execute(op, args = {}, uid) {
      const backup = reads.has(op) ? null : structuredClone(state);
      try {
        const result = perform(op, args, uid);
        if (!reads.has(op)) persist();
        return structuredClone(result);
      } catch (error) { if (backup) state = backup; throw error; }
    }
  };
}
