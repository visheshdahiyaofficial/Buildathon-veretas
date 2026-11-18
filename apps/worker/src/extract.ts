import { ExtractionSchema, HAZARDS, NEEDS, type Extraction, type ReportInput } from '@dw/shared';
import { keywordEmbed, keywordExtract } from './keywords.js';
import { chatJson, embed, ollamaAvailable } from './ollama.js';

const SYSTEM = `You read one emergency report sent from a phone during a natural disaster.
Extract only facts stated or clearly implied in the text. Never invent people.
- trapped_count: people who cannot get out (under rubble, stuck in a building, stranded by water).
- children_count: children, babies or students mentioned as present or affected.
- injured_count: people hurt.
- people_count: total people the reporter says are with them or affected, or null if not said.
- urgency: 1 = safe / informational, 3 = needs help soon, 4 = injuries or fire/gas/collapse, 5 = anyone trapped or life-threatening.
- Vague amounts: "several", "kai", "many" = at least 3; "a few" = 2.
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

const SERIOUS: Extraction['hazards'] = ['collapse', 'fire', 'gas_leak', 'chemical'];

/** Loose evidence (English + common Hindi) that a hazard the LLM named is really in the text. */
const HAZARD_HINTS: Record<Extraction['hazards'][number], RegExp> = {
  collapse: /collaps|fell|fall|rubble|malb|gir|crack|caved|pancak|debris|wall|roof|dabe|trapped/i,
  fire: /fire|flame|smoke|burn|blaze|aag|spark|explo/i,
  gas_leak: /gas|lpg|cylinder|smell/i,
  flooding: /flood|water|paani|pani|rain|baarish|submerg|river|drown/i,
  power_lines: /power|wire|electric|transformer|bijli|spark|pole/i,
  chemical: /chemical|toxic|fumes|acid|factory/i,
  landslide: /landslide|mud|slope|hill|pahad/i,
  debris: /debris|road|block|tree|rubble|malb|crack|bridge|flyover/i,
};

/**
 * Code guardrails on top of the LLM. A 7B model is good at reading messy,
 * mixed-language text but inconsistent with numbers and urgency, so:
 * explicit numbers found by the keyword reader act as a floor, hazards and
 * needs are merged, and urgency follows hard rules (anyone trapped = 5).
 */
export function guard(llm: Extraction, text: string): Extraction {
  const kw = keywordExtract(text);
  const x: Extraction = {
    ...llm,
    trapped_count: Math.max(llm.trapped_count, kw.trapped_count),
    children_count: Math.max(llm.children_count, kw.children_count),
    injured_count: Math.max(llm.injured_count, kw.injured_count),
    hazards: [...new Set([...llm.hazards.filter((h) => HAZARD_HINTS[h].test(text)), ...kw.hazards])],
    needs: [...new Set([...llm.needs, ...kw.needs])],
    summary_line: llm.summary_line || kw.summary_line,
  };
  let u = Math.max(llm.urgency, kw.urgency);
  if (x.injured_count > 0 || x.hazards.some((h) => SERIOUS.includes(h))) u = Math.max(u, 4);
  if (x.trapped_count > 0) u = 5;
  // Calm reports ("we are safe") stay low even if the model over-reacts.
  if (kw.urgency === 1 && !x.trapped_count && !x.injured_count && !x.hazards.length) u = Math.min(u, 2);
  return { ...x, urgency: u };
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
      x = guard(ExtractionSchema.parse(await chatJson(SYSTEM, r.text || '(no text, only checkboxes)', JSON_SCHEMA, 60_000)), r.text);
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
