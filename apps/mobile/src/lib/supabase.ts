import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False when the app was built without Supabase keys: reports are kept on the phone only. */
export const LIVE = Boolean(url && key);

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
