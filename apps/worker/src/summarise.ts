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
- Use the given numbers exactly. Never add up numbers from the reports yourself.
- "trapped (estimate)" comes from witnesses; "trapped (confirmed)" are people who reported themselves trapped. Mention both when they differ.
- Say clearly whether children are present.
- Mention concrete places, hazards and what people need, taken from the reports.
- Plain English, no markdown, no speculation beyond the reports.
- title: max 8 words, e.g. "Apartment collapse, Sector 29 – people trapped".
- summary: 3–5 sentences: what is happening, who is affected (trapped, children, injured), hazards, needs, recommended first action.`;

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

export async function summarise(input: SummaryInput): Promise<{ title: string; summary: string; ai: boolean }> {
  if (await ollamaAvailable()) {
    const reports = sample(input.members)
      .map((m, i) => `${i + 1}. [${m.about === 'self' ? 'about themselves' : 'witness'}] ${m.text}`)
      .join('\n');
    try {
      const out = OutSchema.parse(
        await chatJson(SYSTEM, `FIXED NUMBERS:\n${facts(input.totals)}\n\nREPORTS:\n${reports}`, JSON_SCHEMA),
      );
      return { ...out, ai: true };
    } catch (e) {
      console.warn('[summarise] LLM failed, using template:', (e as Error).message);
    }
  }
  return { ...templateSummary(input), ai: false };
}
