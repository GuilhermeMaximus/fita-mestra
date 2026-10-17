import { unwrap } from './api.js';

export async function cleanupPortraits(db) {
  const rows = unwrap(await db.rpc('claim_portrait_cleanup', { batch_size: 100 }));
  let removed = 0, failed = 0;
  for (const { object_name } of rows) {
    const { error } = await db.storage.from('portraits').remove([object_name]);
    if (error) {
      failed++;
      unwrap(await db.from('portrait_gc').update({ last_error: String(error.message).slice(0, 500) }).eq('object_name', object_name));
    } else {
      unwrap(await db.from('portrait_gc').delete().eq('object_name', object_name));
      removed++;
    }
  }
  return { removed, failed };
}
