export const slots = ['Normal', 'Combate', 'Machucado', 'Inconsciente'];
export const characterFields = ['name', 'notes', 'hp', 'extra_hp', 'max_hp', 'active_slot', 'font', 'name_color', 'name_size', 'show_hp', 'hp_display'];
export const campaignFields = ['bar', 'custom_bar', 'grad1', 'grad2', 'fits'];
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A draft belongs to a record, never to the currently selected screen.
export class DraftStore {
  constructor(fields) { this.fields = fields; this.entries = new Map(); }
  clear() { this.entries.clear(); }
  remove(id) { this.entries.delete(id); }
  get(id) { return this.entries.get(id); }
  ingest(row) {
    row = { ...(this.fields.includes('extra_hp') ? { extra_hp: 0, hp_display: 'bar' } : {}), ...(this.fields.includes('custom_bar') ? { custom_bar: null } : {}), ...row };
    const entry = this.get(row.id);
    if (entry && Number.isFinite(row.version) && row.version < entry.remote.version) return entry;
    if (!entry) {
      this.entries.set(row.id, { base: structuredClone(row), draft: structuredClone(row), remote: structuredClone(row) });
    } else {
      for (const key of Object.keys(row)) {
        if (!this.fields.includes(key) || equal(entry.draft[key], entry.base[key]) || equal(entry.draft[key], row[key])) {
          entry.base[key] = structuredClone(row[key]);
          entry.draft[key] = structuredClone(row[key]);
        }
      }
      entry.remote = structuredClone(row);
    }
    return this.get(row.id);
  }
  edit(id, values) { Object.assign(this.get(id).draft, structuredClone(values)); }
  changes(id) {
    const entry = this.get(id), patch = {}, expected = {};
    for (const key of this.fields) if (!equal(entry.base[key], entry.draft[key])) {
      patch[key] = structuredClone(entry.draft[key]);
      expected[key] = structuredClone(entry.base[key]);
    }
    return { patch, expected };
  }
  dirty(id) { return !!this.get(id) && Object.keys(this.changes(id).patch).length > 0; }
  anyDirty() { return [...this.entries.keys()].some(id => this.dirty(id)); }
  conflicts(id) {
    const e = this.get(id);
    return e ? this.fields.filter(k => !equal(e.draft[k], e.base[k]) && !equal(e.remote[k], e.base[k]) && !equal(e.remote[k], e.draft[k])) : [];
  }
  reset(id) { const row = this.get(id).remote; this.remove(id); this.ingest(row); }
  rebase(id) { this.get(id).base = structuredClone(this.get(id).remote); }
  // Preserve edits typed while a save was in flight.
  saved(row, submitted) {
    const entry = this.get(row.id);
    if (!entry) return this.ingest(row);
    const latest = entry.remote;
    for (const key of Object.keys(submitted)) {
      entry.base[key] = structuredClone(row[key]);
      if (equal(entry.draft[key], submitted[key])) entry.draft[key] = structuredClone(row[key]);
    }
    return this.ingest(latest.version > row.version ? latest : row);
  }
}

export class LatestRequest {
  revision = 0;
  invalidate() { this.revision++; }
  begin() { const revision = ++this.revision; return () => revision === this.revision; }
}

export function validateCharacter(d) {
  if (!d.name.trim() || d.name.length > 120) throw Error('O nome deve ter entre 1 e 120 caracteres.');
  if (d.notes.length > 50000) throw Error('As anotações devem ter no máximo 50.000 caracteres.');
  if (!Number.isInteger(d.max_hp) || d.max_hp < 1 || d.max_hp > 1000000) throw Error('Vida máxima: informe um inteiro de 1 a 1.000.000.');
  if (!Number.isInteger(d.hp) || d.hp < 0 || d.hp > d.max_hp) throw Error('A vida atual deve estar entre zero e a vida máxima.');
  if (!Number.isInteger(d.extra_hp ?? 0) || (d.extra_hp ?? 0) < 0 || (d.extra_hp ?? 0) > 1000000) throw Error('Vida extra: informe um inteiro de 0 a 1.000.000.');
  if (!slots.includes(d.active_slot)) throw Error('Estado inválido.');
  if (!/^#[0-9a-f]{6}$/i.test(d.name_color)) throw Error('Cor de texto inválida.');
  if (!Number.isInteger(d.name_size) || d.name_size < 12 || d.name_size > 60) throw Error('Tamanho do nome: informe um inteiro de 12 a 60.');
  if (typeof d.font !== 'string' || !d.font.trim() || d.font.length > 80) throw Error('Fonte inválida.');
  if (!['bar', 'numbers'].includes(d.hp_display ?? 'bar')) throw Error('Formato de vida inválido.');
  if (typeof d.show_hp !== 'boolean') throw Error('Opção de vida inválida.');
}

export function validateAppearance(d, barNames) {
  barNames = [...barNames, 'Personalizada'];
  if (d.bar === 'Personalizada' && !d.custom_bar) throw Error('Envie uma barra personalizada primeiro.');
  if (!barNames.includes(d.bar)) throw Error('Modelo de barra inválido.');
  for (const key of ['grad1', 'grad2']) if (!/^#[0-9a-f]{6}$/i.test(d[key])) throw Error('Cor de preenchimento inválida.');
  if (!d.fits || Array.isArray(d.fits) || typeof d.fits !== 'object') throw Error('Encaixes inválidos.');
  for (const [bar, fit] of Object.entries(d.fits)) {
    if (!barNames.includes(bar) || !fit || Object.keys(fit).sort().join() !== 'h,w,x,y') throw Error('Encaixe inválido.');
    for (const key of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(fit[key]) || fit[key] < (['w', 'h'].includes(key) ? 1 : 0) || fit[key] > 100) throw Error('Posição deve ser de 0 a 100%; tamanho, de 1 a 100%.');
    }
    if (fit.x + fit.w > 100 || fit.y + fit.h > 100) throw Error('O preenchimento deve caber dentro da moldura.');
  }
}

export function normalizeHealth(hp, max, extra = 0) {
  return { hp: Math.min(hp, max), extra_hp: extra + Math.max(0, hp - max) };
}
export function adjustHealth(hp, max, extra, delta) {
  if (delta < 0) { const absorbed = Math.min(extra, -delta); return { hp: Math.max(0, hp + delta + absorbed), extra_hp: extra - absorbed }; }
  return normalizeHealth(hp + delta, max, extra);
}
