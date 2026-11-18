import { LABELS, SEVERITY_LABELS } from '@dw/shared';
import { z } from 'zod';
import type { Member, Totals } from './aggregate.js';
import { chatJson, ollamaAvailable } from './ollama.js';

export interface SummaryInput {
  totals: Totals;
  members: (Member & { text: string })[];
}

const SYSTEM = `You are a disaster-response analyst. You receive the citizen reports that an
algorithm grouped as one incident area, plus FIXED NUMBERS that were already counted
carefully (duplicates removed). Write a short situation report for a rescue coordinator.

Rules:
- NEVER write any count of people (trapped, injured, children, affected, families). The verified
  numbers are shown separately; numbers you add up from reports would double count. Say "people are
  trapped", "children are among them", not how many.
- Say clearly whether children are present.
- Mention concrete places, hazards and what people need, taken from the reports.
- Plain English, no markdown, no speculation beyond the reports.
- Only mention place names that appear in the reports. Never invent a sector or street.
- title: max 8 words: the main event, the place if reports name one, and the key risk (e.g. "<event>, <place> – <key risk>").
  Only say "trapped" in the title if trapped (estimate) is above 0.
- summary: 2–4 sentences: what is happening and where, who is affected (without numbers), hazards, needs, recommended first action.`;

const OutSchema = z.object({ title: z.string().min(3).max(120), summary: z.string().min(20).max(1500) });

const JSON_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, summary: { type: 'string' } },
  required: ['title', 'summary'],
};

const list = (xs: string[]) => xs.map((x) => LABELS[x as keyof typeof LABELS] ?? x).join(', ');

function facts(t: Totals): string {
  return [
    `disaster type: ${t.disaster_type}`,
    `reports: ${t.report_count} (from about ${t.distinct_sources} distinct sources)`,
    `area radius: ~${t.radius_m} m`,
    `trapped (estimate): ${t.trapped_count}`,
    `trapped (confirmed, self-reported): ${t.trapped_confirmed}`,
    `highest number of trapped claimed by a single report (uncorroborated): ${t.trapped_reported_max}`,
    `children present: ${t.children_count > 0 ? `yes, about ${t.children_count}` : 'none reported'}`,
    `injured: ${t.injured_count}`,
    `people affected (estimate): ${t.people_count}`,
    `hazards: ${list(t.hazards) || 'none reported'}`,
    `needs (most requested first): ${list(t.needs) || 'none stated'}`,
    `severity: ${t.severity}/5 (${SEVERITY_LABELS[t.severity]})`,
    `first report: ${t.first_report_at}, latest: ${t.last_report_at}`,
  ].join('\n');
}

/** Pick the most informative reports to show the model (urgent first, then varied). */
function sample(members: SummaryInput['members'], max = 15) {
  return [...members].sort((a, b) => b.x.urgency - a.x.urgency || b.text.length - a.text.length).slice(0, max);
}

/** The numbers sentence, written in code from the verified totals. */
export function numbersLine(t: Totals): string {
  const parts: string[] = [];
  if (t.trapped_count) {
    let s = `About ${t.trapped_count} trapped (${t.trapped_confirmed} confirmed by their own reports`;
    if (t.trapped_reported_max > t.trapped_count) s += `; one report says up to ${t.trapped_reported_max}`;
    parts.push(`${s})`);
  }
  parts.push(t.children_count ? `children present (about ${t.children_count})` : 'no children reported');
  if (t.injured_count) parts.push(`${t.injured_count} injured`);
  parts.push(`${t.report_count} reports`);
  const line = parts.join(', ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

const COUNT_SENTENCE = /\b(\d+|several|dozens|hundreds)\s+(?:\w+\s+){0,2}?(people|persons|children|kids|injured|trapped|families|individuals|victims)\b/i;

/** Remove any sentence where the model still stated a people count. */
export function stripCounts(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !COUNT_SENTENCE.test(sentence))
    .join(' ');
}

export function templateSummary({ totals: t }: SummaryInput): { title: string; summary: string } {
  const what = t.hazards.length
    ? list(t.hazards.slice(0, 2))
    : t.needs.length
      ? `${list(t.needs.slice(0, 2))} needed`
      : `${LABELS[t.disaster_type]} reports`;
  const title = `${what}${t.trapped_count ? ' – people trapped' : t.injured_count ? ' – injuries' : ''}`;
  const parts = [
    `${t.report_count} reports describe ${what.toLowerCase()} in this area (radius ~${t.radius_m} m).`,
  ];
  if (t.trapped_count)
    parts.push(
      `About ${t.trapped_count} people are reported trapped` +
        (t.trapped_confirmed ? `, ${t.trapped_confirmed} of them confirmed by their own reports.` : '.'),
    );
  parts.push(t.children_count ? `Children are present (about ${t.children_count}).` : 'No children reported.');
  if (t.injured_count) parts.push(`${t.injured_count} injured.`);
  if (t.needs.length) parts.push(`Needs: ${list(t.needs.slice(0, 4))}.`);
  return { title, summary: parts.join(' ') };
}

const COMMON = new Set(
  'earthquake flood storm tornado fire landslide tsunami people trapped injured children affected need needs minor major damage shaking severe critical low area building collapse collapsed power lines downed road blocked traffic disrupted shelter water food medical help rescue gas leak no and in at near with of the'.split(' '),
);

/**
 * Drop title parts that name a place no report mentioned ("Downtown Area").
 * LLMs like to invent locations; a wrong sector sends a team to the wrong place.
 */
export function dropInventedPlaces(title: string, texts: string[]): string {
  const corpus = texts.join(' ').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
  const parts = title.split(/\s*(?:,|–|-|:)\s+/);
  const kept = parts.filter((part) =>
    part.split(/\s+/).every((w) => {
      const word = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      return !word || COMMON.has(word) || corpus.includes(word);
    }),
  );
  return (kept.length ? kept : parts.slice(0, 1)).join(' – ');
}

export async function summarise(input: SummaryInput): Promise<{ title: string; summary: string; ai: boolean }> {
  if (await ollamaAvailable()) {
    const reports = sample(input.members)
      .map((m, i) => `${i + 1}. [${m.about === 'self' ? 'about themselves' : 'witness'}] ${m.text}`)
      .join('\n');
    try {
      const out = OutSchema.parse(
        await chatJson(SYSTEM, `FIXED NUMBERS:\n${facts(input.totals)}\n\nREPORTS:\n${reports}`, JSON_SCHEMA),
      );
      let title = dropInventedPlaces(out.title, input.members.map((m) => m.text));
      // The title must not claim people are trapped when the verified count is 0.
      if (!input.totals.trapped_count) title = title.split(' – ').filter((p) => !/trapped/i.test(p)).join(' – ') || title;
      return {
        title,
        summary: `${numbersLine(input.totals)} ${stripCounts(out.summary)}`.trim(),
        ai: true,
      };
    } catch (e) {
      console.warn('[summarise] LLM failed, using template:', (e as Error).message);
    }
  }
  return { ...templateSummary(input), ai: false };
}
