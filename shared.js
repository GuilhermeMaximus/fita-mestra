export const bars={
 'Gótico':'assets/gotico.webp','Pixel Art':'assets/pixel.webp',
 'Arco-íris':'assets/barra_arco_iris.webp','Steampunk':'assets/barra_steampunk.webp',
 'Dark':'assets/barra_dark.webp','Floresta':'assets/barra_floresta.webp','Céu':'assets/barra_ceu.webp'
};
export const fitDefaults={
 'Personalizada':{x:16.5,y:46.5,w:73.5,h:14},
 'Gótico':{x:17.3,y:43.8,w:72.3,h:12},'Pixel Art':{x:16.5,y:46.5,w:73.5,h:14},
 'Arco-íris':{x:19,y:47.5,w:70.5,h:13},'Steampunk':{x:20.5,y:47.5,w:67.5,h:13},
 'Dark':{x:18.5,y:49,w:72,h:12},'Floresta':{x:20,y:49,w:68,h:13},'Céu':{x:20,y:49,w:68,h:13}
};
export const fonts=['Arial','Georgia','Verdana','Trebuchet MS','Tahoma','Times New Roman','Courier New','Impact','Palatino Linotype','Book Antiqua','Garamond','Cambria','Candara','Consolas','Lucida Console','Comic Sans MS','Segoe UI','Century Gothic','Franklin Gothic Medium','Brush Script MT','Lucida Handwriting','Monotype Corsiva','Copperplate','Papyrus','fantasy','cursive','monospace','serif','sans-serif'];
export function createBar(s, doc = document) {
  const wrap = doc.createElement('div');
  wrap.className = 'obs-bar bar-wrap';
  const fit = { ...(fitDefaults[s.bar] || fitDefaults['Pixel Art']), ...(s.fits?.[s.bar] || {}) };
  const track = doc.createElement('div');
  track.className = 'bar-track';
  Object.assign(track.style, { left: fit.x + '%', top: fit.y + '%', width: fit.w + '%', height: fit.h + '%' });
  const fill = doc.createElement('div');
  fill.className = 'bar-fill';
  const percent = Number.isFinite(s.hp / s.max_hp) ? s.hp / s.max_hp * 100 : 0;
  fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
  fill.style.background = `linear-gradient(90deg,${s.grad1},${s.grad2})`;
  track.append(fill);
  const img = doc.createElement('img');
  img.className = 'bar-frame';
  img.alt = '';
  img.src = s.bar === 'Personalizada' && s.custom_bar ? s.custom_bar : bars[s.bar] || bars['Pixel Art'];
  wrap.append(track, img);
  return wrap;
}

export function renderOverlay(root, data) {
  const doc = root.ownerDocument;
  const element = (className, text) => {
    const el = doc.createElement('div');
    el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  const left = element('obs-left');
  const imageUrl = data.images?.[data.active_slot] || data.images?.Normal;
  if (imageUrl) {
    const img = doc.createElement('img');
    img.className = 'obs-img';
    img.alt = data.name;
    img.src = imageUrl;
    img.addEventListener('error', () => img.replaceWith(element('obs-img placeholder', 'Imagem indisponível')), { once: true });
    left.append(img);
  } else left.append(element('obs-img placeholder', 'Sem imagem'));
  const name = element('obs-name', data.name);
  Object.assign(name.style, { fontFamily: data.font, color: data.name_color, fontSize: data.name_size + 'px' });
  left.append(name);
  const right = element('obs-right');
  right.append(createBar(data, doc));
  if (data.show_hp) {
    const hp = element('obs-hp', `${data.hp} / ${data.max_hp} HP`);
    Object.assign(hp.style, { fontFamily: data.font, color: data.name_color, fontSize: Math.max(10, Math.round(data.name_size * .48)) + 'px' });
    right.append(hp);
  }
  if (data.extra_hp > 0) {
    const extra = element('obs-extra', data.show_hp ? '+' + data.extra_hp + ' VIDA EXTRA' : '');
    const track = element('extra-track'), fill = element('extra-fill');
    fill.style.width = Math.min(100, data.extra_hp / data.max_hp * 100) + '%';
    track.append(fill); extra.append(track); right.append(extra);
  }
  root.replaceChildren(left, right);
}
