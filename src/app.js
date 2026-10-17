import { bars, fonts, fitDefaults, renderOverlay } from '../shared.js';
import { DraftStore, LatestRequest, characterFields, campaignFields, slots, validateCharacter, validateAppearance } from './model.js';
import { repository, unwrap } from './api.js';
import { serialPoll } from './poll.js';

export function createApp({ db, doc = document, win = window, api = repository(db), autoSync = true }) {
  const $ = id => doc.getElementById(id);
  const chars = new DraftStore(characterFields), appearances = new DraftStore(campaignFields);
  const campaignsGate = new LatestRequest(), charactersGate = new LatestRequest();
  let userId = '', epoch = 0, campaigns = [], characters = [], campaignId = null, characterId = null;
  let renderedId = null, authEvent = 0, subscription, started = false, previewJson = '';
  const busy = new Set();
  const campaign = () => appearances.get(campaignId)?.remote;
  const character = () => chars.get(characterId)?.remote;
  const owner = () => !!userId && campaign()?.owner_id === userId;
  const editable = () => !!character() && (owner() || character().owner_id === userId);
  const show = (id, value) => $(id).classList.toggle('hidden', !value);
  const message = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'error' : 'muted'; };
  const context = () => { const value = epoch; return () => value === epoch; };
  function options(el, entries, selected) {
    el.replaceChildren();
    for (const [value, label] of entries) { const o = doc.createElement('option'); o.value = value; o.textContent = label; el.append(o); }
    if (selected != null) el.value = selected;
  }
  function button(text, action, disabled = false) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; b.disabled = disabled; return b;
  }
  function renderPermissions() {
    for (const id of ['charName', 'hp', 'maxHp', 'notes', 'activeSlot', 'font', 'nameColor', 'nameSize', 'showHp', 'uploadSlot']) $(id).disabled = !editable();
    for (const id of ['saveCharacter', 'deleteCharacter', 'upload', 'rotateOverlay']) $(id).disabled = !editable() || busy.has('character');
    for (const id of ['minus', 'plus', 'minus5', 'plus5']) $(id).disabled = !editable();
    $('newCharacter').disabled = !campaign() || busy.has('createCharacter');
    $('saveCampaign').disabled = !owner() || busy.has('campaign');
    $('rotateInvite').disabled = !owner() || busy.has('campaign');
    $('removeMember').disabled = !owner() || busy.has('campaign');
    $('leaveCampaign').disabled = owner() || !campaign() || busy.has('campaign');
    for (const [key, ids] of Object.entries({ auth: ['login', 'signup', 'logout', 'resetPassword', 'updatePassword'], campaignCreate: ['createCampaign', 'joinCampaign'] })) {
      for (const id of ids) $(id).disabled = busy.has(key);
    }
  }
  async function run(key, action) {
    if (busy.has(key)) return;
    const current = context();
    busy.add(key); renderPermissions(); message('');
    try { return await action(current); }
    catch (error) {
      if (current()) {
        const text = error?.message || String(error);
        message(error.code === 'PGRST202' ? 'O banco precisa da migração v2. Consulte a seção de atualização no LEIA-ME.md; não reaplique o schema inicial.' : /CONFLITO/.test(text) ? 'Outra pessoa alterou este campo. Seu rascunho foi preservado. Revise o conflito abaixo.' : text, true);
        if (/CONFLITO/.test(text)) await refreshCampaigns().catch(() => {});
      }
    } finally { busy.delete(key); renderPermissions(); }
  }
  function formValues() {
    return { name: $('charName').value, notes: $('notes').value, hp: Number($('hp').value), max_hp: Number($('maxHp').value), active_slot: $('activeSlot').value, font: $('font').value, name_color: $('nameColor').value, name_size: Number($('nameSize').value), show_hp: $('showHp').checked };
  }
  function capture() {
    if (editable() && renderedId === characterId) chars.edit(characterId, formValues());
  }
  function preview() {
    const c = chars.get(characterId)?.draft, a = appearances.get(campaignId)?.draft;
    if (!c || !a) return;
    const data = { ...c, ...Object.fromEntries(campaignFields.map(k => [k, a[k]])) };
    const json = JSON.stringify(data);
    if (json !== previewJson) { renderOverlay($('preview'), data); previewJson = json; }
    $('draftStatus').textContent = chars.dirty(characterId) ? 'Alterações não salvas' : 'Ficha salva';
    const conflicts = chars.conflicts(characterId);
    show('characterConflict', conflicts.length > 0);
    $('conflictFields').textContent = conflicts.join(', ');
  }
  function gallery() {
    const c = chars.get(characterId)?.draft;
    $('portraitGallery').replaceChildren();
    if (!c) return;
    for (const slot of slots) {
      const tile = button(slot, () => {
        capture(); chars.edit(characterId, { active_slot: slot });
        $('activeSlot').value = slot; $('uploadSlot').value = slot; gallery(); preview();
      }, !editable());
      tile.className = 'portrait-tile' + (c.active_slot === slot ? ' active' : '');
      tile.setAttribute('aria-pressed', String(c.active_slot === slot));
      if (c.images?.[slot]) { const img = doc.createElement('img'); img.src = c.images[slot]; img.alt = ''; img.className = 'portrait-thumb'; tile.prepend(img); }
      else { const placeholder = doc.createElement('span'); placeholder.className = 'portrait-thumb empty'; placeholder.textContent = '+'; tile.prepend(placeholder); }
      $('portraitGallery').append(tile);
    }
  }
  function renderCharacter() {
    const c = chars.get(characterId)?.draft;
    show('editor', !!c);
    if (!c) { renderedId = null; previewJson = ''; return; }
    const changed = renderedId !== characterId;
    const mapping = { charName: 'name', notes: 'notes', hp: 'hp', maxHp: 'max_hp', activeSlot: 'active_slot', font: 'font', nameColor: 'name_color', nameSize: 'name_size' };
    for (const [id, field] of Object.entries(mapping)) if ($(id).value !== String(c[field])) $(id).value = c[field];
    $('showHp').checked = c.show_hp;
    if (changed) { $('uploadSlot').value = c.active_slot; $('upload').value = ''; }
    $('obsLink').value = new URL('obs.html?id=' + encodeURIComponent(c.overlay_token), win.location.href).href;
    renderedId = characterId;
    gallery(); renderPermissions(); preview();
  }
  function drawCharacters() {
    $('characters').replaceChildren();
    for (const c of characters) {
      const b = button(`${c.name} · ${c.hp}/${c.max_hp} HP`, () => { capture(); characterId = c.id; drawCharacters(); renderCharacter(); });
      b.classList.toggle('selected', c.id === characterId);
      b.setAttribute('aria-pressed', String(c.id === characterId));
      $('characters').append(b);
    }
  }
  function renderAppearance() {
    const d = appearances.get(campaignId)?.draft;
    if (!d) return;
    show('ownerOnly', owner()); show('notOwner', !owner()); show('memberAdmin', owner()); show('leaveCampaign', !owner());
    $('campaignInfo').textContent = `${owner() ? 'Mestre' : 'Jogador'} · Convite: ${campaign().invite_code}`;
    for (const id of ['grad1', 'grad2']) if (doc.activeElement !== $(id)) $(id).value = d[id];
    const fit = { ...fitDefaults[d.bar], ...d.fits?.[d.bar] };
    for (const [key, id] of Object.entries({ x: 'fitX', y: 'fitY', w: 'fitW', h: 'fitH' })) if (doc.activeElement !== $(id)) $(id).value = fit[key];
    $('barOptions').replaceChildren();
    for (const name of Object.keys(bars)) {
      const b = button(name, () => { appearances.edit(campaignId, { bar: name }); renderAppearance(); preview(); }, !owner());
      b.classList.toggle('selected', d.bar === name); b.setAttribute('aria-pressed', String(d.bar === name)); $('barOptions').append(b);
    }
    $('appearanceStatus').textContent = appearances.dirty(campaignId) ? 'Aparência com alterações não salvas' : 'Aparência salva';
    show('campaignConflict', appearances.conflicts(campaignId).length > 0);
  }
  async function refreshCharacters(selectedId) {
    if (!campaignId) return;
    const id = campaignId, current = context(), latest = charactersGate.begin();
    const rows = await api.characters(id);
    if (!current() || !latest() || campaignId !== id) return;
    capture();
    const previousIds = characters.map(c => c.id);
    characters = rows.map(row => chars.ingest(row).remote);
    for (const oldId of previousIds) if (!rows.some(row => row.id === oldId)) chars.remove(oldId);
    characterId = rows.find(c => c.id === (selectedId || characterId))?.id || rows[0]?.id || null;
    drawCharacters(); renderCharacter();
  }
  async function loadMembers() {
    const id = campaignId, current = context();
    if (!owner()) return;
    const rows = await api.members(id);
    if (!current() || id !== campaignId) return;
    options($('memberSelect'), rows.filter(m => m.user_id !== userId).map(m => [m.user_id, m.label]));
  }
  async function selectCampaign(id) {
    capture(); charactersGate.invalidate();
    campaignId = campaigns.some(c => c.id === id) ? id : campaigns[0]?.id || null;
    characterId = null; characters = []; renderedId = null;
    $('campaignSelect').value = campaignId || '';
    show('workspace', !!campaignId); show('editor', false); drawCharacters();
    if (campaignId) { renderAppearance(); await Promise.all([refreshCharacters(), loadMembers()]); }
    renderPermissions();
  }
  async function refreshCampaigns(selectedId) {
    if (!userId) return;
    const current = context(), latest = campaignsGate.begin();
    const rows = await api.campaigns();
    if (!current() || !latest()) return;
    const gone = campaigns.filter(c => !rows.some(row => row.id === c.id));
    for (const c of gone) {
      appearances.remove(c.id);
      for (const [id, e] of chars.entries) if (e.remote.campaign_id === c.id) chars.remove(id);
    }
    campaigns = rows.map(row => appearances.ingest(row).remote);
    const next = rows.find(c => c.id === (selectedId || campaignId))?.id || rows[0]?.id || null;
    options($('campaignSelect'), rows.map(c => [c.id, c.title]), next);
    if (next !== campaignId || selectedId) await selectCampaign(next);
    else if (next) { renderAppearance(); await refreshCharacters(); }
    else show('workspace', false);
  }
  function clearState() {
    epoch++; campaignsGate.invalidate(); charactersGate.invalidate();
    chars.clear(); appearances.clear(); campaigns = []; characters = []; campaignId = null; characterId = null; renderedId = null;
    previewJson = ''; $('preview').replaceChildren(); $('characters').replaceChildren(); $('memberSelect').replaceChildren();
    options($('campaignSelect'), []); show('workspace', false); show('editor', false);
    for (const id of ['notes', 'charName', 'obsLink', 'password', 'newPassword', 'newCampaign', 'invite']) $(id).value = '';
  }
  async function sessionChanged(session, event) {
    if (event === 'PASSWORD_RECOVERY') show('recovery', true);
    const next = session?.user?.id || '';
    show('auth', !next); show('app', !!next); show('logout', !!next);
    $('who').textContent = session?.user?.email || 'Desconectado';
    if (next === userId) return;
    sync.stop(); clearState(); userId = next;
    if (!next) show('recovery', false);
    renderPermissions();
    if (next) { await refreshCampaigns(); if (autoSync && userId === next) sync.start(); }
  }
  const sync = serialPoll(async () => { if (userId) await refreshCampaigns(); }, {
    delay: 5000,
    onValue: () => { $('syncStatus').textContent = userId ? 'Sincronizado' : ''; },
    onError: () => { $('syncStatus').textContent = 'Sem sincronização. Seus rascunhos estão preservados.'; }
  });
  function bind(id, key, fn) { $(id).onclick = () => run(key, fn); }
  for (const id of ['charName', 'hp', 'maxHp', 'notes', 'activeSlot', 'font', 'nameColor', 'nameSize', 'showHp']) $(id).addEventListener('input', () => { capture(); if (id === 'activeSlot') gallery(); preview(); });
  options($('activeSlot'), slots.map(s => [s, s])); options($('uploadSlot'), slots.map(s => [s, s])); options($('font'), fonts.map(f => [f, f]));
  for (const [id, delta] of [['minus', -1], ['plus', 1], ['minus5', -5], ['plus5', 5]]) $(id).onclick = () => {
    $('hp').value = Math.max(0, Math.min(Number($('maxHp').value) || 1, (Number($('hp').value) || 0) + delta)); capture(); preview();
  };
  $('campaignSelect').onchange = () => run('selection:' + $('campaignSelect').value, () => selectCampaign($('campaignSelect').value));
  bind('createCampaign', 'campaignCreate', async current => {
    const title = $('newCampaign').value.trim();
    if (!title || title.length > 100) throw Error('Informe um nome de campanha de 1 a 100 caracteres.');
    const id = await api.rpc('create_campaign', { campaign_title: title });
    if (current()) { $('newCampaign').value = ''; await refreshCampaigns(id); }
  });
  bind('joinCampaign', 'campaignCreate', async current => {
    const code = $('invite').value.trim();
    if (!code) throw Error('Informe o código de convite.');
    const id = await api.rpc('join_campaign', { code });
    if (current()) { $('invite').value = ''; await refreshCampaigns(id); }
  });
  bind('newCharacter', 'createCharacter', async current => {
    const id = campaignId;
    if (!id) throw Error('Selecione uma campanha.');
    const row = await api.createCharacter(id, userId);
    if (current() && campaignId === id) await refreshCharacters(row.id);
  });
  bind('saveCharacter', 'character', async current => {
    if (!editable()) throw Error('Sem permissão.');
    capture(); const id = characterId;
    validateCharacter(chars.get(id).draft);
    const changes = chars.changes(id);
    if (!Object.keys(changes.patch).length) { message('Nenhuma alteração para salvar.'); return; }
    const row = await api.saveCharacter(id, changes);
    if (!current()) return;
    if (id === characterId) capture();
    chars.saved(row, changes.patch);
    characters = characters.map(c => c.id === id ? chars.get(id).remote : c);
    drawCharacters(); if (id === characterId) renderCharacter();
    message('Ficha salva. O OBS atualizará na próxima consulta.');
  });
  bind('deleteCharacter', 'character', async current => {
    if (!editable()) throw Error('Sem permissão.');
    const id = characterId, cid = campaignId;
    if (!win.confirm('Excluir este personagem e seus retratos?')) return;
    await api.deleteCharacter(id);
    if (current()) { chars.remove(id); if (cid === campaignId) await refreshCharacters(); }
  });
  $('upload').onchange = () => {
    const file = $('upload').files?.[0];
    if (!file) return;
    // Capture identity AND slot before the first asynchronous step.
    const target = { characterId, slot: $('uploadSlot').value, userId, file };
    return run('character', async current => {
      if (!editable()) throw Error('Sem permissão.');
      capture();
      const row = await api.uploadPortrait({ ...target, current });
      if (!current()) return;
      if (characterId === target.characterId) capture();
      chars.ingest(row);
      if (characterId === target.characterId) { $('upload').value = ''; renderCharacter(); }
      message(`Imagem ${target.slot} salva. Selecione o estado e salve a ficha para ativá-lo.`);
    });
  };
  for (const id of ['grad1', 'grad2']) $(id).oninput = () => { if (owner()) { appearances.edit(campaignId, { [id]: $(id).value }); renderAppearance(); preview(); } };
  for (const [key, id] of Object.entries({ x: 'fitX', y: 'fitY', w: 'fitW', h: 'fitH' })) $(id).oninput = () => {
    if (!owner()) return;
    const d = appearances.get(campaignId).draft;
    appearances.edit(campaignId, { fits: { ...d.fits, [d.bar]: { ...fitDefaults[d.bar], ...d.fits?.[d.bar], [key]: $(id).value === '' ? null : Number($(id).value) } } });
    renderAppearance(); preview();
  };
  $('resetFit').onclick = () => {
    if (!owner()) return;
    const d = appearances.get(campaignId).draft, fits = { ...d.fits }; delete fits[d.bar];
    appearances.edit(campaignId, { fits }); renderAppearance(); preview();
  };
  bind('saveCampaign', 'campaign', async current => {
    if (!owner()) throw Error('Somente o mestre.');
    const id = campaignId, d = appearances.get(id).draft;
    validateAppearance(d, Object.keys(bars));
    const changes = appearances.changes(id);
    const row = await api.saveCampaign(id, changes);
    if (current()) { appearances.saved(row, changes.patch); if (campaignId === id) { renderAppearance(); preview(); } message('Aparência salva.'); }
  });
  for (const [prefix, store, id] of [['character', chars, () => characterId], ['campaign', appearances, () => campaignId]]) {
    $(prefix + 'Reload').onclick = () => {
      if (win.confirm('Descartar o rascunho e usar os dados mais recentes?')) { store.reset(id()); renderCharacter(); renderAppearance(); }
    };
    $(prefix + 'Keep').onclick = () => {
      if (win.confirm('Manter suas alterações sobre os valores mais recentes? Revise e clique em Salvar para confirmar.')) { store.rebase(id()); renderCharacter(); renderAppearance(); }
    };
  }
  bind('rotateOverlay', 'character', async current => {
    const id = characterId;
    if (!editable() || !win.confirm('Revogar o link atual? Será necessário substituir a URL no OBS.')) return;
    const row = await api.rpc('rotate_overlay', { target_id: id });
    if (current()) { chars.ingest(row); if (id === characterId) renderCharacter(); message('Link renovado. Copie o novo endereço para o OBS.'); }
  });
  bind('rotateInvite', 'campaign', async current => {
    const id = campaignId;
    if (!owner() || !win.confirm('Renovar o convite? O código antigo deixará de aceitar novos participantes.')) return;
    const row = await api.rpc('rotate_invite', { cid: id });
    if (current()) { appearances.ingest(row); if (campaignId === id) renderAppearance(); }
  });
  bind('removeMember', 'campaign', async current => {
    const cid = campaignId, target_user = $('memberSelect').value;
    if (!owner() || !target_user || !win.confirm('Remover este participante? Suas fichas ficarão com o mestre. Todos os links OBS e o convite da campanha serão renovados.')) return;
    await api.rpc('remove_campaign_member', { cid, target_user });
    if (current() && campaignId === cid) { await loadMembers(); await refreshCampaigns(); }
  });
  bind('leaveCampaign', 'campaign', async current => {
    const cid = campaignId;
    if (owner() || !win.confirm('Sair desta campanha? Suas fichas ficarão com o mestre. Todos os links OBS e o convite serão renovados.')) return;
    await api.rpc('leave_campaign', { cid });
    if (current()) await refreshCampaigns();
  });
  bind('copyObs', 'clipboard', async () => { await win.navigator.clipboard.writeText($('obsLink').value); message('Link copiado.'); });
  $('openObs').onclick = () => win.open($('obsLink').value, '_blank', 'noopener');
  function credentials() {
    if (!$('email').reportValidity() || !$('password').reportValidity()) throw Error('Confira o e-mail e a senha.');
    return { email: $('email').value.trim(), password: $('password').value };
  }
  bind('login', 'auth', async () => { unwrap(await db.auth.signInWithPassword(credentials())); $('password').value = ''; });
  bind('signup', 'auth', async () => { const result = unwrap(await db.auth.signUp(credentials())); $('password').value = ''; message(result.session ? 'Conta criada.' : 'Confira seu e-mail para confirmar o cadastro.'); });
  bind('logout', 'auth', async () => {
    if ((chars.anyDirty() || appearances.anyDirty()) && !win.confirm('Sair e descartar as alterações não salvas?')) return;
    unwrap(await db.auth.signOut()); await sessionChanged(null, 'SIGNED_OUT');
  });
  bind('resetPassword', 'auth', async () => {
    if (!$('email').reportValidity()) throw Error('Informe seu e-mail.');
    unwrap(await db.auth.resetPasswordForEmail($('email').value.trim(), { redirectTo: new URL('index.html', win.location.href).href }));
    message('Se a conta existir, você receberá um e-mail para redefinir a senha.');
  });
  bind('updatePassword', 'auth', async () => {
    if (!$('newPassword').reportValidity()) throw Error('A nova senha deve ter pelo menos 8 caracteres.');
    unwrap(await db.auth.updateUser({ password: $('newPassword').value })); $('newPassword').value = ''; show('recovery', false); message('Senha atualizada.');
  });
  const beforeUnload = event => { if (chars.anyDirty() || appearances.anyDirty()) { event.preventDefault(); event.returnValue = ''; } };
  const resize = win.ResizeObserver ? new win.ResizeObserver(entries => {
    $('preview').style.zoom = String(Math.min(1, entries[0].contentRect.width / 490));
  }) : null;
  resize?.observe($('preview').parentElement);
  return {
    chars, appearances, refreshCampaigns, refreshCharacters, selectCampaign, sessionChanged,
    get selection() { return { campaignId, characterId, userId }; },
    async start() {
      if (started) return; started = true;
      win.addEventListener('beforeunload', beforeUnload);
      const result = db.auth.onAuthStateChange((event, session) => {
        authEvent++;
        // Do not await database requests inside the auth lock.
        queueMicrotask(() => sessionChanged(session, event).catch(e => message(e.message, true)));
      });
      subscription = result.data.subscription;
      const version = authEvent;
      try { const { session } = unwrap(await db.auth.getSession()); if (version === authEvent) await sessionChanged(session, 'INITIAL_SESSION'); }
      catch (e) { message(e.message, true); }
    },
    stop() { sync.stop(); epoch++; subscription?.unsubscribe(); resize?.disconnect(); win.removeEventListener('beforeunload', beforeUnload); }
  };
}
