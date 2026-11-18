import { createHash, randomUUID } from 'node:crypto';
import type { Cluster, ClusterStatus, Report } from '@dw/shared';
import { aggregate, type Member } from './aggregate.js';
import { clusterPoints, matchIds, type ClusterParams } from './cluster.js';
import { config } from './config.js';
import { keywordEmbed } from './keywords.js';
import { reportText } from './extract.js';
import { summarise } from './summarise.js';

export type ProcessedReport = Report & { embedding: number[] | null };

/** Similarity thresholds differ between real embeddings and the keyword fallback. */
const OLLAMA_SIMILARITY = 0.62;
const KEYWORD_SIMILARITY = 0.5;

export function memberHash(ids: string[]): string {
  return createHash('sha1').update([...ids].sort().join(',')).digest('hex');
}

/**
 * Choose one vector space for the whole run. If every report has a real
 * embedding use those; otherwise fall back to keyword vectors for all, so
 * cosine similarity is always comparing like with like.
 */
export function vectorsFor(reports: ProcessedReport[]): { vecs: number[][]; minSimilarity: number } {
  const dim = reports[0]?.embedding?.length ?? 0;
  const allReal = dim > 0 && reports.every((r) => r.embedding?.length === dim);
  if (allReal) return { vecs: reports.map((r) => r.embedding!), minSimilarity: OLLAMA_SIMILARITY };
  return { vecs: reports.map((r) => keywordEmbed(reportText(r))), minSimilarity: KEYWORD_SIMILARITY };
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
