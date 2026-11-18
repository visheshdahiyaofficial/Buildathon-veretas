import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Supabase configured: reports go to the cloud database. */
export const LIVE = Boolean(url && key);

/** Local mode: the Mac running `npm run local` on the same Wi-Fi, e.g. http://192.168.1.5:8787 */
export const LOCAL_API = process.env.EXPO_PUBLIC_LOCAL_API?.replace(/\/$/, '') || null;

/** False when there is nowhere to send reports: they stay on the phone. */
export const CONNECTED = LIVE || Boolean(LOCAL_API);

export const supabase = LIVE
  ? createClient(url!, key!, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null;

/** Every phone gets an anonymous identity on first launch: no sign-up in an emergency. */
export async function ensureUserId(): Promise<string> {
  if (!supabase) throw new Error('offline build');
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) throw error ?? new Error('Could not sign in');
  return anon.user.id;
}
