/**
 * Runs the whole AI pipeline on the synthetic Gurugram earthquake and writes
 * apps/dashboard/public/demo.json, which the dashboard shows when Supabase is
 * not configured. Uses Ollama if running, otherwise the keyword fallback.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DemoData } from '@dw/shared';
import { ollamaAvailable } from '../src/ollama.js';
import { runClustering } from '../src/pipeline.js';
import { processReports } from '../src/process.js';
import { syntheticReports } from '../src/synthetic.js';

const reports = syntheticReports();
const ai = (await ollamaAvailable()) ? 'ollama' : 'fallback';
console.log(`${reports.length} synthetic reports. AI: ${ai === 'ollama' ? 'Ollama' : 'keyword fallback (start Ollama for real AI)'}`);

const t0 = Date.now();
const processed = await processReports(reports, (n) => {
  if (n % 25 === 0 || n === reports.length) process.stdout.write(`\r  extracted ${n}/${reports.length}`);
});
console.log(`\n  extraction + embedding: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const { clusters, assignment } = await runClustering(processed, [], new Map());
const out: DemoData = {
  generated_at: new Date().toISOString(),
  ai,
  reports: processed.map(({ embedding: _e, ...r }) => ({ ...r, cluster_id: assignment.get(r.id) ?? null })),
  clusters,
};
const file = fileURLToPath(new URL('../../dashboard/public/demo.json', import.meta.url));
writeFileSync(file, JSON.stringify(out));
console.log(`  ${clusters.length} clusters, total ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file}\n`);
for (const c of clusters) {
  console.log(`  [sev ${c.severity}] ${c.title}  (${c.report_count} reports, trapped ~${c.trapped_count} / confirmed ${c.trapped_confirmed}, children ${c.children_count}, injured ${c.injured_count})`);
}
