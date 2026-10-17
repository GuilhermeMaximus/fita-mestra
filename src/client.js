import { createClient } from '@supabase/supabase-js';

export function client(config, overlay = false) {
  if (!config?.supabaseUrl?.startsWith('https://') || !config?.supabaseAnonKey) throw Error('Preencha config.js com a URL e a chave pública do Supabase.');
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: !overlay, autoRefreshToken: !overlay, detectSessionInUrl: !overlay },
    global: {
      fetch: async (url, options = {}) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        const timeout = setTimeout(abort, 20000);
        try { return await fetch(url, { ...options, signal: controller.signal }); }
        finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
      }
    }
  });
}
