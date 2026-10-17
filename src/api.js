export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function repository(db) {
  const rpc = async (name, args) => unwrap(await db.rpc(name, args));
  return {
    rpc,
    campaigns: async () => unwrap(await db.from('campaigns').select('*').order('created_at', { ascending: false })),
    characters: async id => unwrap(await db.from('characters').select('*').eq('campaign_id', id).order('updated_at', { ascending: false })),
    members: async id => rpc('list_campaign_members', { cid: id }),
    createCharacter: async (campaignId, userId) => unwrap(await db.from('characters').insert({ campaign_id: campaignId, owner_id: userId }).select().single()),
    saveCharacter: (id, changes) => rpc('save_character', { target_id: id, ...changes }),
    saveCampaign: (id, changes) => rpc('save_campaign', { target_id: id, ...changes }),
    deleteCharacter: async id => unwrap(await db.from('characters').delete().eq('id', id).select('id').single()),
    async uploadPortrait({ characterId, slot, userId, file, current = () => true }) {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
      if (!ext || file.size > 5 * 1024 * 1024 || file.size === 0) throw Error('Use PNG, JPG ou WebP de até 5 MB.');
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const bucket = db.storage.from('portraits');
      unwrap(await bucket.upload(path, file, { contentType: file.type, upsert: false }));
      if (!current()) throw Error('A sessão mudou durante o envio. Envie a imagem novamente.');
      const { data } = bucket.getPublicUrl(path);
      // On an ambiguous network failure do not delete: the transaction may have committed.
      // Unattached uploads are collected by the server cleanup after a grace period.
      return rpc('replace_portrait', { target_id: characterId, slot_name: slot, image_url: data.publicUrl });
    }
  };
}
