import type { Report } from '@dw/shared';
import { embedMany, extractOne, mapLimit, reportText } from './extract.js';
import { ollamaAvailable } from './ollama.js';
import type { ProcessedReport } from './pipeline.js';

/** Extract facts and embed text for reports that have not been processed yet. */
export async function processReports(reports: Report[], onProgress?: (done: number) => void): Promise<ProcessedReport[]> {
  let done = 0;
  const parallel = (await ollamaAvailable()) ? 3 : 32;
  const extracted = await mapLimit(reports, parallel, async (r) => {
    const x = await extractOne(r);
    onProgress?.(++done);
    return x;
  });
  const real = await ollamaAvailable();
  const vectors = real ? await embedMany(reports.map(reportText)) : reports.map(() => null);
  const now = new Date().toISOString();
  return reports.map((r, i) => ({ ...r, extracted: extracted[i], embedding: vectors[i], processed_at: now }));
}
