import { createClient } from '@supabase/supabase-js';
import { cleanupPortraits } from '../src/cleanup.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no ambiente do servidor.');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const result = await cleanupPortraits(db);
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
