import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cluster, ClusterStatus, DemoData, Report } from '@dw/shared';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const LIVE = Boolean(URL_ && KEY);
export const db: SupabaseClient | null = LIVE ? createClient(URL_!, KEY!) : null;

const REPORT_COLS =
  'id,client_id,created_at,reported_at,lat,lng,accuracy_m,disaster_type,about,text,people_count,trapped_count,has_children,injured_count,needs,photo_paths,extracted,cluster_id,processed_at';

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(LIVE ? undefined : null);
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export interface DataState {
  reports: Report[];
  clusters: Cluster[];
  loading: boolean;
  error: string | null;
  mode: 'live' | 'demo';
  ai: 'ollama' | 'fallback' | 'live';
  lastUpdate: Date | null;
  setStatus: (id: string, status: ClusterStatus) => Promise<void>;
}

/** Loads reports + clusters. Live mode follows Supabase realtime; demo mode reads demo.json. */
export function useData(enabled: boolean): DataState {
  const [reports, setReports] = useState<Report[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<DataState['ai']>(LIVE ? 'live' : 'fallback');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      if (!db) {
        const res = await fetch(`/demo.json?t=${Date.now()}`);
        if (!res.ok) throw new Error('No demo data. Run `npm run demo` first.');
        const d = (await res.json()) as DemoData;
        setReports(d.reports);
        setClusters(d.clusters);
        setAi(d.ai);
      } else {
        const since = new Date(Date.now() - 72 * 3600_000).toISOString();
        const [r, c] = await Promise.all([
          db.from('reports').select(REPORT_COLS).gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
          db.from('clusters').select('*'),
        ]);
        if (r.error) throw r.error;
        if (c.error) throw c.error;
        setReports(r.data as Report[]);
        setClusters(c.data as Cluster[]);
      }
      setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    if (!db) return;
    // Debounce bursts of realtime events (the worker updates many rows at once).
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 800);
    };
    const ch = db
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clusters' }, soon)
      .subscribe();
    return () => {
      db!.removeChannel(ch);
    };
  }, [enabled, load]);

  const setStatus = useCallback(async (id: string, status: ClusterStatus) => {
    setClusters((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    if (db) {
      const { error } = await db.from('clusters').update({ status }).eq('id', id);
      if (error) setError(error.message);
    }
  }, []);

  return { reports, clusters, loading, error, mode: LIVE ? 'live' : 'demo', ai, lastUpdate, setStatus };
}

/** Short-lived links to private report photos. */
export async function signedPhotoUrls(paths: string[]): Promise<string[]> {
  if (!db || !paths.length) return [];
  const { data } = await db.storage.from('report-photos').createSignedUrls(paths, 600);
  return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
}
