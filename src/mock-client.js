export async function mockRequest(op, args = {}, userId = null) {
  const response = await fetch('/__mock/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, args, userId }), signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || 'Falha no servidor de teste.');
  return result.data;
}

export async function createMockClient(win = window) {
  let profiles = await mockRequest('profiles'), listener;
  const key = 'fita-mestra-test-user';
  const saved = win.sessionStorage.getItem(key);
  let user = saved === 'signed-out' ? null : profiles.find(u => u.id === saved) || profiles[0];
  const session = () => user ? { user } : null;
  function change(next) {
    user = next; win.sessionStorage.setItem(key, user?.id || 'signed-out');
    listener?.(user ? 'SIGNED_IN' : 'SIGNED_OUT', session());
  }
  const request = (op, args) => mockRequest(op, args, user?.id);
  const api = {
    campaigns: () => request('campaigns'), characters: id => request('characters', { id }),
    members: id => request('members', { id }), createCharacter: id => request('createCharacter', { id }),
    saveCharacter: (id, changes) => request('saveCharacter', { id, changes }),
    saveCampaign: (id, changes) => request('saveCampaign', { id, changes }),
    deleteCharacter: id => request('deleteCharacter', { id }),
    rpc: (name, args) => request('rpc', { name, args }),
    async uploadPortrait({ characterId, slot, file, userId, current = () => true }) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw Error('Use PNG, JPG ou WebP de até 5 MB.');
      const data = await new Promise((resolve, reject) => {
        const reader = new win.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (!current()) throw Error('A sessão mudou durante o envio.');
      return mockRequest('uploadPortrait', { id: characterId, slot, data }, userId);
    }
  };
  const db = { auth: {
    getSession: async () => ({ data: { session: session() } }),
    onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() { listener = null; } } } }; },
    signOut: async () => { change(null); return { data: {} }; },
    signInWithPassword: async ({ email }) => {
      profiles = await mockRequest('profiles'); const next = profiles.find(u => u.email === email.trim().toLowerCase());
      if (!next) throw Error('Conta local não encontrada. Use um perfil da barra de teste ou crie uma conta fictícia.');
      change(next); return { data: { session: session() } };
    },
    signUp: async ({ email }) => {
      const next = await mockRequest('register', { email }); profiles.push(next); change(next);
      return { data: { session: session() } };
    },
    resetPasswordForEmail: async () => { throw Error('O modo local não envia e-mails. Use um perfil de teste; recuperação real exige Supabase de homologação.'); },
    updateUser: async () => { throw Error('O modo local não armazena senhas. Valide a troca de senha no Supabase de homologação.'); }
  } };
  return { db, api, get profiles() { return profiles; }, change, request };
}

export function mountTestControls(mock, app, doc = document, win = window) {
  const toolbar = doc.createElement('aside'); toolbar.className = 'test-toolbar'; toolbar.setAttribute('aria-label', 'Ambiente de teste');
  const description = doc.createElement('span');
  description.textContent = 'TESTE LOCAL · dados salvos neste computador · login simulado, sem senha real';
  const label = doc.createElement('label'); label.htmlFor = 'testProfile'; label.textContent = 'Testar como';
  const select = doc.createElement('select'); select.id = 'testProfile';
  const fill = () => {
    select.replaceChildren();
    const none = doc.createElement('option'); none.value = ''; none.textContent = 'Desconectado'; select.append(none);
    for (const user of mock.profiles) { const option = doc.createElement('option'); option.value = user.id; option.textContent = user.email; select.append(option); }
    select.value = app.selection.userId;
  };
  const reset = doc.createElement('button'); reset.textContent = 'Restaurar dados de teste';
  const dirty = () => app.chars.anyDirty() || app.appearances.anyDirty();
  select.onchange = () => {
    if (dirty() && !win.confirm('Trocar de perfil e descartar os rascunhos não salvos?')) { fill(); return; }
    mock.change(mock.profiles.find(u => u.id === select.value) || null);
  };
  reset.onclick = async () => {
    if (!win.confirm('Restaurar somente o banco local de teste? Campanhas, contas e retratos locais serão substituídos pelos exemplos iniciais.')) return;
    reset.disabled = true;
    try {
      await mockRequest('reset', {}, 'demo-master');
      app.stop(); win.sessionStorage.removeItem('fita-mestra-test-user'); win.location.reload();
    } catch (error) { doc.getElementById('message').textContent = error.message; reset.disabled = false; }
  };
  toolbar.append(description, label, select, reset); doc.body.prepend(toolbar);
  new win.MutationObserver(fill).observe(doc.getElementById('who'), { childList: true, characterData: true, subtree: true });
  fill();
  doc.getElementById('password').placeholder = 'Use uma senha fictícia (mínimo de 6 caracteres)';
}
