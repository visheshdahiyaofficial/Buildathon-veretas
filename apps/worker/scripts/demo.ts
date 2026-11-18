/**
 * Runs the whole AI pipeline on the synthetic Gurugram earthquake and writes
 * apps/dashboard/public/demo.json, which the dashboard shows when Supabase is
 * not configured. Uses Ollama if running, otherwise the keyword fallback.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DemoData, Extraction } from '@dw/shared';
import { embedMany, guard, mergeWithReporter, reportText } from '../src/extract.js';
import { ollamaAvailable } from '../src/ollama.js';
import { runClustering } from '../src/pipeline.js';
import { processReports } from '../src/process.js';
import { syntheticReports } from '../src/synthetic.js';

const reports = syntheticReports();
const ai = (await ollamaAvailable()) ? 'ollama' : 'fallback';
console.log(`${reports.length} synthetic reports. AI: ${ai === 'ollama' ? 'Ollama' : 'keyword fallback (start Ollama for real AI)'}`);

const file = fileURLToPath(new URL('../../dashboard/public/demo.json', import.meta.url));
const t0 = Date.now();

// --reuse: keep the LLM extractions from the last run (by text) and only
// re-run the code steps (guardrails, clustering, counting, summaries).
const cache = new Map<string, Extraction>();
if (process.argv.includes('--reuse') && existsSync(file)) {
  for (const r of (JSON.parse(readFileSync(file, 'utf8')) as DemoData).reports) if (r.extracted) cache.set(r.text, r.extracted);
  console.log(`  reusing ${cache.size} cached extractions`);
}
const missing = reports.filter((r) => !cache.has(r.text));
const fresh = new Map(
  (await processReports(missing, (n) => {
    if (n % 25 === 0 || n === missing.length) process.stdout.write(`\r  extracted ${n}/${missing.length}`);
  })).map((r) => [r.id, r]),
);
const vectors = ai === 'ollama' ? await embedMany(reports.map(reportText)) : reports.map(() => null);
const processed = reports.map((r, i) =>
  fresh.get(r.id) ?? { ...r, extracted: mergeWithReporter(guard(cache.get(r.text)!, r.text), r), embedding: vectors[i], processed_at: new Date().toISOString() },
);
console.log(`\n  extraction + embedding: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const { clusters, assignment } = await runClustering(processed, [], new Map());
const out: DemoData = {
  generated_at: new Date().toISOString(),
  ai,
  reports: processed.map(({ embedding: _e, ...r }) => ({ ...r, cluster_id: assignment.get(r.id) ?? null })),
  clusters,
};
writeFileSync(file, JSON.stringify(out));
console.log(`  ${clusters.length} clusters, total ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file}\n`);
for (const c of clusters) {
  console.log(`  [sev ${c.severity}] ${c.title}  (${c.report_count} reports, trapped ~${c.trapped_count} / confirmed ${c.trapped_confirmed}, children ${c.children_count}, injured ${c.injured_count})`);
}
