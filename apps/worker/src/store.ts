import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Cluster, Report } from '@dw/shared';
import { config } from './config.js';
import type { ProcessedReport } from './pipeline.js';

export function supabase(): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/worker/.env (or run `npm run demo` for offline mode).');
  }
  return createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
}

const REPORT_COLS =
  'id,client_id,created_at,reported_at,lat,lng,accuracy_m,disaster_type,about,text,people_count,trapped_count,has_children,injured_count,needs,photo_paths,extracted,cluster_id,processed_at';

/** pgvector comes back as a string like "[0.1,0.2]". */
function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string' && v.startsWith('[')) return JSON.parse(v) as number[];
  return null;
}

export async function fetchUnprocessed(db: SupabaseClient, limit = 100): Promise<Report[]> {
  const { data, error } = await db.from('reports').select(REPORT_COLS).is('processed_at', null).order('created_at').limit(limit);
  if (error) throw error;
  return data as Report[];
}

export async function saveProcessed(db: SupabaseClient, rows: ProcessedReport[]): Promise<void> {
  await Promise.all(
    rows.map(async (r) => {
      const { error } = await db
        .from('reports')
        .update({ extracted: r.extracted, embedding: r.embedding, processed_at: r.processed_at })
        .eq('id', r.id);
      if (error) throw error;
    }),
  );
}

export async function fetchWindow(db: SupabaseClient, hours: number): Promise<ProcessedReport[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const out: ProcessedReport[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('reports')
      .select(`${REPORT_COLS},embedding`)
      .not('processed_at', 'is', null)
      .gte('created_at', since)
      .order('created_at')
      .range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((r) => ({ ...(r as unknown as Report), embedding: parseVector((r as { embedding: unknown }).embedding) })));
    if (data.length < 1000) return out;
  }
}

export async function fetchClusters(db: SupabaseClient): Promise<Cluster[]> {
  const { data, error } = await db.from('clusters').select('*');
  if (error) throw error;
  return data as Cluster[];
}

export async function saveClusters(
  db: SupabaseClient,
  clusters: Cluster[],
  assignment: Map<string, string | null>,
  previousIds: string[],
): Promise<void> {
  if (clusters.length) {
    const { error } = await db.from('clusters').upsert(clusters);
    if (error) throw error;
  }
  // Point each report at its cluster (grouped by cluster to keep requests few).
  const byCluster = new Map<string | null, string[]>();
  for (const [rid, cid] of assignment) (byCluster.get(cid) ?? byCluster.set(cid, []).get(cid)!).push(rid);
  for (const [cid, ids] of byCluster) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from('reports').update({ cluster_id: cid }).in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
  }
  const keep = new Set(clusters.map((c) => c.id));
  const gone = previousIds.filter((id) => !keep.has(id));
  if (gone.length) {
    const { error } = await db.from('clusters').delete().in('id', gone);
    if (error) throw error;
  }
}
