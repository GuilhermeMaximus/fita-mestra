// Screen navigation is independent of persistence: switching tabs never resets a draft.
export function createNavigation(doc) {
  const $ = id => doc.getElementById(id);
  const tabs = [...doc.querySelectorAll('[data-tab]')];
  let authMode = 'login';
  function select(name, focus = false) {
    if (!tabs.some(tab => tab.dataset.tab === name)) return;
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
  }
  tabs.forEach((tab, i) => {
    tab.onclick = () => select(tab.dataset.tab);
    tab.onkeydown = event => {
      const index = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (index !== undefined) { event.preventDefault(); select(tabs[index].dataset.tab, true); }
    };
  });
  function screen(campaign = false) {
    $('campaignScreen').hidden = !campaign; $('characterScreen').hidden = campaign;
    $('campaignSettings').setAttribute('aria-pressed', String(campaign));
  }
  $('campaignSettings').onclick = () => screen(true);
  $('backToCharacter').onclick = () => { screen(); $('campaignSettings').focus(); };
  $('goObs').onclick = () => select('obs', true);
  $('firstCharacter').onclick = () => $('newCharacter').click();
  function dialogMode(mode) {
    const join = mode === 'join';
    $('createCampaignForm').hidden = join; $('joinCampaignForm').hidden = !join;
    $('modeCreate').setAttribute('aria-pressed', String(!join)); $('modeJoin').setAttribute('aria-pressed', String(join));
    $('dialogMessage').textContent = '';
  }
  for (const b of doc.querySelectorAll('[data-open-campaign]')) b.onclick = () => {
    dialogMode(b.dataset.openCampaign);
    $('campaignDialog').showModal();
    $(b.dataset.openCampaign === 'join' ? 'invite' : 'newCampaign').focus();
  };
  $('modeCreate').onclick = () => dialogMode('create'); $('modeJoin').onclick = () => dialogMode('join');
  $('closeCampaignDialog').onclick = () => $('campaignDialog').close();
  for (const [form, action] of [['createCampaignForm', 'createCampaign'], ['joinCampaignForm', 'joinCampaign']]) {
    $(form).onsubmit = event => { event.preventDefault(); $(action).click(); };
  }
  function auth(mode) {
    authMode = mode;
    const titles = { login: 'Sua próxima sessão começa aqui.', signup: 'Toda boa história tem um começo.', reset: 'Vamos recuperar seu acesso.' };
    const help = { login: 'Entre para continuar suas campanhas.', signup: 'Crie sua conta para montar ou participar de uma mesa.', reset: 'Enviaremos as instruções para o seu e-mail.' };
    $('authTitle').textContent = titles[mode]; $('authHelp').textContent = help[mode];
    for (const [id, show] of [['login', mode === 'login'], ['signup', mode === 'signup'], ['resetPassword', mode === 'reset']]) {
      $(id).classList.toggle('hidden', !show); $(id).type = show ? 'submit' : 'button';
    }
    $('passwordField').hidden = mode === 'reset'; $('password').required = mode !== 'reset';
    $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('authSwitchText').hidden = mode !== 'login';
    for (const b of doc.querySelectorAll('[data-auth-mode]')) b.classList.toggle('hidden', b.dataset.authMode === 'login' ? mode === 'login' : mode !== 'login');
  }
  for (const b of doc.querySelectorAll('[data-auth-mode]')) b.onclick = () => auth(b.dataset.authMode);
  $('authForm').onsubmit = event => { event.preventDefault(); $({ login: 'login', signup: 'signup', reset: 'resetPassword' }[authMode]).click(); };
  function revealInvalid() {
    const field = ['charName', 'maxHp', 'hp', 'notes', 'nameSize'].map($).find(el => !el.checkValidity());
    if (field) { screen(); select(field.closest('[data-panel]').dataset.panel); field.focus(); field.reportValidity(); return true; }
    return false;
  }
  select('session'); auth('login');
  return { select, screen, auth, revealInvalid, closeDialog: () => { if ($('campaignDialog').open) $('campaignDialog').close(); } };
}
