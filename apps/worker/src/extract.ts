import { ExtractionSchema, HAZARDS, NEEDS, type Extraction, type ReportInput } from '@dw/shared';
import { keywordEmbed, keywordExtract } from './keywords.js';
import { chatJson, embed, ollamaAvailable } from './ollama.js';

const SYSTEM = `You read one emergency report sent from a phone during a natural disaster.
Extract only facts stated or clearly implied in the text. Never invent people.
- trapped_count: people who cannot get out (under rubble, stuck in a building, stranded by water).
- children_count: children, babies or students mentioned as present or affected.
- injured_count: people hurt.
- people_count: total people the reporter says are with them or affected, or null if not said.
- urgency: 1 = safe / informational, 3 = needs help soon, 5 = life-threatening right now.
- summary_line: one short English sentence describing the situation (translate if needed).
Use 0 when a count is not mentioned.`;

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    people_count: { type: ['integer', 'null'] },
    trapped_count: { type: 'integer' },
    children_count: { type: 'integer' },
    injured_count: { type: 'integer' },
    hazards: { type: 'array', items: { type: 'string', enum: [...HAZARDS] } },
    needs: { type: 'array', items: { type: 'string', enum: [...NEEDS] } },
    urgency: { type: 'integer', minimum: 1, maximum: 5 },
    summary_line: { type: 'string' },
  },
  required: ['people_count', 'trapped_count', 'children_count', 'injured_count', 'hazards', 'needs', 'urgency', 'summary_line'],
};

/** The words the AI reads: free text plus what the reporter ticked. */
export function reportText(r: Pick<ReportInput, 'text' | 'disaster_type' | 'needs' | 'trapped_count' | 'has_children' | 'injured_count'>): string {
  const ticks: string[] = [];
  if (r.trapped_count > 0) ticks.push(`${r.trapped_count} trapped`);
  if (r.has_children) ticks.push('children present');
  if (r.injured_count > 0) ticks.push(`${r.injured_count} injured`);
  if (r.needs.length) ticks.push(`needs: ${r.needs.join(', ')}`);
  return `[${r.disaster_type}] ${r.text}${ticks.length ? ` (${ticks.join('; ')})` : ''}`;
}

/**
 * The reporter's own answers are ground truth; the AI only fills gaps.
 * e.g. ticking "children present" guarantees children_count >= 1.
 */
export function mergeWithReporter(x: Extraction, r: ReportInput): Extraction {
  return {
    ...x,
    people_count: r.people_count ?? x.people_count,
    trapped_count: r.trapped_count > 0 ? r.trapped_count : x.trapped_count,
    children_count: r.has_children ? Math.max(1, x.children_count) : x.children_count,
    injured_count: Math.max(r.injured_count, x.injured_count),
    needs: [...new Set([...r.needs, ...x.needs])],
    urgency: Math.max(x.urgency, r.trapped_count > 0 ? 5 : r.injured_count > 0 ? 4 : 1),
  };
}

export async function extractOne(r: ReportInput): Promise<Extraction> {
  let x: Extraction;
  if (await ollamaAvailable()) {
    try {
      x = ExtractionSchema.parse(await chatJson(SYSTEM, r.text || '(no text, only checkboxes)', JSON_SCHEMA, 60_000));
    } catch (e) {
      console.warn('[extract] LLM failed, using keywords:', (e as Error).message);
      x = keywordExtract(r.text);
    }
  } else {
    x = keywordExtract(r.text);
  }
  return mergeWithReporter(x, r);
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (await ollamaAvailable()) {
    try {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) out.push(...(await embed(texts.slice(i, i + 64))));
      return out;
    } catch (e) {
      console.warn('[embed] Ollama failed, using keyword vectors:', (e as Error).message);
    }
  }
  return texts.map(keywordEmbed);
}

/** Run `fn` over items with at most `limit` in flight (Ollama handles a few in parallel). */
export async function mapLimit<T, U>(items: T[], limit: number, fn: (t: T, i: number) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
