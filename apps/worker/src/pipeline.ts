import { createHash, randomUUID } from 'node:crypto';
import type { Cluster, ClusterStatus, Report } from '@dw/shared';
import { aggregate, type Member } from './aggregate.js';
import { clusterPoints, matchIds, type ClusterParams } from './cluster.js';
import { config } from './config.js';
import { normalize } from './geo.js';
import { keywordEmbed } from './keywords.js';
import { reportText } from './extract.js';
import { summarise } from './summarise.js';

export type ProcessedReport = Report & { embedding: number[] | null };

export function memberHash(ids: string[]): string {
  return createHash('sha1').update([...ids].sort().join(',')).digest('hex');
}

/** Neighbour threshold on the blended similarity (see vectorsFor). */
const MIN_SIMILARITY = 0.5;
/** Weight of the neural embedding in the blend; the rest is the fact/topic vector. */
const EMBED_WEIGHT = 0.35;

/** Words for the facts the LLM normalised (works for any input language). */
function factWords(r: ProcessedReport): string {
  const x = r.extracted;
  if (!x) return '';
  return [...x.hazards, ...x.needs, x.trapped_count > 0 ? 'trapped' : '', x.injured_count > 0 ? 'injured' : '', x.urgency <= 1 ? 'safe' : '']
    .join(' ')
    .replace(/_/g, ' ');
}

/**
 * The vector each report is compared with.
 *
 * We measured raw nomic-embed-text cosine on our scenario: reports from
 * different incidents scored ~0.79, the same as reports from one incident,
 * because every report shares the "disaster report" direction. So:
 *   1. a topic vector built from the text PLUS the facts the LLM extracted
 *      (hazards, needs, trapped) carries most of the weight. The LLM is what
 *      turns "chhat gir gayi, log dabe hain" into collapse + trapped;
 *   2. the neural embedding, mean-centred over the batch to remove the shared
 *      direction, is blended in for meaning the keywords miss.
 * Concatenating two unit vectors scaled by sqrt(w) makes the cosine a
 * weighted average of the two cosines.
 */
export function vectorsFor(reports: ProcessedReport[]): { vecs: number[][]; minSimilarity: number } {
  const topic = reports.map((r) => keywordEmbed(`${reportText(r)} ${factWords(r)}`));
  const dim = reports[0]?.embedding?.length ?? 0;
  const allReal = dim > 0 && reports.every((r) => r.embedding?.length === dim);
  if (!allReal) return { vecs: topic, minSimilarity: MIN_SIMILARITY };

  const mean = new Array<number>(dim).fill(0);
  for (const r of reports) r.embedding!.forEach((x, k) => (mean[k] += x / reports.length));
  const centred = reports.map((r) => normalize(r.embedding!.map((x, k) => x - mean[k])));
  const a = Math.sqrt(1 - EMBED_WEIGHT), b = Math.sqrt(EMBED_WEIGHT);
  return {
    vecs: reports.map((_, i) => [...topic[i].map((x) => x * a), ...centred[i].map((x) => x * b)]),
    minSimilarity: MIN_SIMILARITY * (1 - EMBED_WEIGHT) + 0.1 * EMBED_WEIGHT,
  };
}

export interface RunResult {
  clusters: Cluster[];
  /** report id → cluster id (null = not in any cluster) */
  assignment: Map<string, string | null>;
  /** clusters whose summary was (re)written this run */
  resummarised: number;
}

/**
 * Cluster all processed reports, compute totals, and (re)summarise clusters
 * whose membership changed. `previous` keeps ids, statuses and summaries stable.
 */
export async function runClustering(
  reports: ProcessedReport[],
  previous: Cluster[],
  previousMembers: Map<string, string[]>,
  overrides: Partial<ClusterParams> = {},
): Promise<RunResult> {
  const usable = reports.filter((r) => r.extracted);
  const { vecs, minSimilarity } = vectorsFor(usable);
  const params: ClusterParams = {
    epsMeters: config.epsMeters,
    sameSpotMeters: 50,
    minSimilarity,
    minPoints: config.minPoints,
    ...overrides,
  };
  const groups = clusterPoints(
    usable.map((r, i) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      vec: vecs[i],
      urgency: r.extracted!.urgency,
      trapped: r.extracted!.trapped_count,
    })),
    params,
  );

  const idGroups = groups.map((g) => g.map((i) => usable[i].id));
  const ids = matchIds(
    idGroups,
    previous.map((c) => ({ id: c.id, members: previousMembers.get(c.id) ?? [] })),
    randomUUID,
  );
  const prevById = new Map(previous.map((c) => [c.id, c]));

  const assignment = new Map<string, string | null>(usable.map((r) => [r.id, null]));
  const clusters: Cluster[] = [];
  let resummarised = 0;
  const now = new Date().toISOString();

  for (let g = 0; g < groups.length; g++) {
    const members = groups[g].map((i) => {
      const r = usable[i];
      return {
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        vec: vecs[i],
        disaster_type: r.disaster_type,
        about: r.about,
        reported_at: r.reported_at,
        x: r.extracted!,
        text: r.text || r.extracted!.summary_line,
      } satisfies Member & { text: string };
    });
    const id = ids[g];
    for (const m of members) assignment.set(m.id, id);

    const totals = aggregate(members);
    const hash = memberHash(members.map((m) => m.id));
    const prev = prevById.get(id);
    let title = prev?.title ?? '';
    let summary = prev?.summary ?? '';
    if (!prev || prev.member_hash !== hash || !summary) {
      ({ title, summary } = await summarise({ totals, members }));
      resummarised++;
    }
    const { distinct_sources: _ignored, ...cols } = totals;
    clusters.push({
      id,
      ...cols,
      title,
      summary,
      member_hash: hash,
      status: (prev?.status ?? 'new') as ClusterStatus,
      updated_at: prev && prev.member_hash === hash ? prev.updated_at : now,
    });
  }
  clusters.sort((a, b) => b.severity - a.severity || b.trapped_count - a.trapped_count || b.report_count - a.report_count);
  return { clusters, assignment, resummarised };
}
