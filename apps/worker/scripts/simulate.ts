/**
 * Live demo feed: replays the synthetic earthquake into the local server as if
 * phones were sending reports, so the dashboard fills up in real time.
 *
 *   npm run local -w worker -- --reset --empty   # terminal 1
 *   npm run simulate                              # terminal 2  (RATE_MS=500 by default)
 */
import { syntheticReports } from '../src/synthetic.js';

const API = process.env.LOCAL_API ?? 'http://localhost:8787';
const RATE_MS = Number(process.env.RATE_MS) || 500;
const run = Date.now().toString(36);

// Order by when they "happened", but compress 3 hours into a few minutes.
const reports = syntheticReports(7).sort((a, b) => a.reported_at.localeCompare(b.reported_at));
console.log(`Sending ${reports.length} reports to ${API}, one every ${RATE_MS} ms…`);
for (const [i, r] of reports.entries()) {
  const { id: _i, created_at: _c, extracted: _x, cluster_id: _cl, processed_at: _p, ...input } = r;
  const body = { ...input, client_id: `sim-${run}-${i}`, reported_at: new Date().toISOString() };
  const res = await fetch(`${API}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  process.stdout.write(`\r  sent ${i + 1}/${reports.length}`);
  await new Promise((r) => setTimeout(r, RATE_MS));
}
console.log('\nDone.');
