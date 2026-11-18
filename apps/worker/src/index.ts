/**
 * The live AI worker. Leave it running on the Mac:
 *   1. picks up new reports, extracts facts and embeds them (Ollama)
 *   2. re-clusters the last WINDOW_HOURS of reports
 *   3. re-summarises clusters whose members changed
 * Wakes every POLL_SECONDS, and immediately when a report is inserted.
 */
import { config } from './config.js';
import { ollamaAvailable } from './ollama.js';
import { runClustering } from './pipeline.js';
import { processReports } from './process.js';
import { fetchClusters, fetchUnprocessed, fetchWindow, saveClusters, saveProcessed, supabase } from './store.js';

const db = supabase();
console.log(`[worker] AI: ${(await ollamaAvailable()) ? `Ollama (${config.chatModel})` : 'keyword fallback — start Ollama for real AI'}`);

let dirty = true; // cluster on start-up
let running = false;
let wake: (() => void) | null = null;

async function tick() {
  if (running) return;
  running = true;
  try {
    let fresh = await fetchUnprocessed(db);
    while (fresh.length) {
      console.log(`[worker] processing ${fresh.length} new report(s)`);
      await saveProcessed(db, await processReports(fresh));
      dirty = true;
      fresh = await fetchUnprocessed(db);
    }
    if (dirty) {
      dirty = false;
      const reports = await fetchWindow(db, config.windowHours);
      const previous = await fetchClusters(db);
      const previousMembers = new Map<string, string[]>();
      for (const r of reports) if (r.cluster_id) (previousMembers.get(r.cluster_id) ?? previousMembers.set(r.cluster_id, []).get(r.cluster_id)!).push(r.id);
      const t0 = Date.now();
      const { clusters, assignment, resummarised } = await runClustering(reports, previous, previousMembers);
      await saveClusters(db, clusters, assignment, previous.map((c) => c.id));
      console.log(`[worker] ${reports.length} reports → ${clusters.length} clusters (${resummarised} re-summarised) in ${Date.now() - t0} ms`);
    }
  } catch (e) {
    console.error('[worker] error:', (e as Error).message);
    dirty = true;
  } finally {
    running = false;
  }
}

db.channel('new-reports')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, () => wake?.())
  .subscribe();

for (;;) {
  await tick();
  await new Promise<void>((resolve) => {
    wake = resolve;
    setTimeout(resolve, config.pollSeconds * 1000);
  });
  wake = null;
}
