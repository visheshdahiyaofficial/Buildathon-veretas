import type { DisasterType, Extraction, Hazard, Need } from '@dw/shared';
import { cosine, haversine } from './geo.js';

export interface Member {
  id: string;
  lat: number;
  lng: number;
  vec: number[];
  disaster_type: DisasterType;
  about: 'self' | 'others';
  reported_at: string;
  x: Extraction;
  /** Raw text, used to spot re-sends of the same message. */
  text?: string;
}

export interface Totals {
  lat: number;
  lng: number;
  radius_m: number;
  report_count: number;
  disaster_type: DisasterType;
  severity: number;
  people_count: number;
  trapped_count: number;
  trapped_confirmed: number;
  trapped_reported_max: number;
  children_count: number;
  injured_count: number;
  needs: Need[];
  hazards: Hazard[];
  first_report_at: string;
  last_report_at: string;
  /** Number of distinct situations after merging duplicate reports. */
  distinct_sources: number;
}

/** Reports within this distance AND this similar are treated as the same people. */
export const DUPLICATE_METERS = 40;
export const DUPLICATE_SIMILARITY = 0.8;
/** Near-identical text from a bit further away is still a re-send (phone GPS drifts tens of metres). */
export const RESEND_METERS = 150;
export const RESEND_WORD_OVERLAP = 0.8;

const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

/** Share of words two messages have in common (Jaccard). 1 = same message. */
export function wordOverlap(a: string, b: string): number {
  const A = words(a), B = words(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/**
 * Group reports that almost certainly describe the same people: sent from
 * the same spot with near-identical content (a family where three members all
 * report "we are 4, my son is trapped"). Union-find over pairs.
 */
export function duplicateGroups(members: Member[]): number[][] {
  const parent = members.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      const d = haversine(a.lat, a.lng, b.lat, b.lng);
      const sim = cosine(a.vec, b.vec);
      const resend = d <= RESEND_METERS && !!a.text && !!b.text && wordOverlap(a.text, b.text) >= RESEND_WORD_OVERLAP;
      // Same spot + same topic + some shared wording. When unsure we keep them
      // separate: over-counting trapped people is safer than missing someone.
      const sameSpot = d <= DUPLICATE_METERS && sim >= DUPLICATE_SIMILARITY && (!a.text || !b.text || wordOverlap(a.text, b.text) >= 0.3);
      if (sameSpot || resend) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  members.forEach((_, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  });
  return [...groups.values()];
}

/** Most-mentioned first; `minShare` drops items only a few reports mention (one bad extraction). */
function ranked<T extends string>(lists: T[][], minShare = 0): T[] {
  const freq = new Map<T, number>();
  for (const l of lists) for (const x of new Set(l)) freq.set(x, (freq.get(x) ?? 0) + 1);
  const min = Math.max(1, Math.ceil(lists.length * minShare));
  return [...freq.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export function severityOf(t: Omit<Totals, 'severity'>, meanUrgency: number): number {
  let s = Math.round(meanUrgency);
  if (t.report_count >= 5) s = Math.max(s, 2);
  if (t.needs.length && t.report_count >= 5) s = Math.max(s, 3);
  if (t.injured_count > 0) s = Math.max(s, 3);
  if (t.injured_count >= 5) s = Math.max(s, 4);
  if (t.hazards.some((h) => h === 'fire' || h === 'gas_leak' || h === 'chemical' || h === 'collapse')) s = Math.max(s, 4);
  if (t.trapped_count > 0) s = Math.max(s, 4);
  if (t.trapped_count >= 3 || (t.trapped_count > 0 && t.children_count > 0)) s = 5;
  return Math.min(5, Math.max(1, s));
}

type Metric = 'trapped_count' | 'children_count' | 'injured_count' | 'people_count';

/**
 * What the witnesses agree on. The highest number given by at least two
 * witnesses (corroborated), or the upper quartile if nobody agrees. A single
 * wild "100 trapped" is ignored, but a vaguer witness ("people inside") does
 * not pull down a specific, repeated "8 children trapped".
 */
export function witnessEstimate(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const corroborated = [...counts.entries()].filter(([, n]) => n >= 2).map(([x]) => x);
  const quartile = v[Math.min(v.length - 1, Math.floor(v.length * 0.75))];
  return corroborated.length ? Math.max(quartile, ...corroborated) : quartile;
}

/**
 * Numbers are computed here, in code, never by the LLM. This is the part that
 * matters most to a rescuer, so it is deliberately conservative about double
 * counting:
 *
 * - "self" reports describe the reporter's own group ("we are 4, my son is
 *   trapped"). Different groups are different people, so they are SUMMED,
 *   after merging duplicates (same spot + same content = same family sending
 *   twice, take the max).
 * - "others" (witness) reports describe what someone sees ("about 6 people
 *   trapped in the building"). Twenty witnesses of one collapse are describing
 *   the SAME 6 people, so witnesses are never summed; we take their upper
 *   quartile as the estimate.
 * - The cluster estimate is max(self total, witness estimate): witnesses may be
 *   describing the very people who also reported themselves.
 */
export function aggregate(members: Member[]): Totals {
  const self = members.filter((m) => m.about === 'self');
  const witnesses = members.filter((m) => m.about !== 'self');
  const groups = duplicateGroups(self);

  const selfSum = (k: Metric, floor = 0) =>
    groups.reduce((sum, g) => sum + Math.max(floor, ...g.map((i) => self[i].x[k] ?? 0)), 0);
  const estimate = (k: Metric, floor = 0) =>
    Math.max(selfSum(k, floor), witnessEstimate(witnesses.map((m) => m.x[k] ?? 0)));

  const trappedConfirmed = selfSum('trapped_count');
  const trapped = estimate('trapped_count');
  const children = estimate('children_count');
  const injured = estimate('injured_count');
  const people = estimate('people_count', 1); // each self report is at least the reporter

  const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
  const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
  const dists = members.map((m) => haversine(lat, lng, m.lat, m.lng)).sort((a, b) => a - b);
  // 90th percentile so one far-off report doesn't blow up the circle.
  const radius = Math.max(60, dists[Math.floor(dists.length * 0.9)] ?? 0);

  const typeFreq = ranked(members.map((m) => [m.disaster_type]));
  const times = members.map((m) => m.reported_at).sort();
  const base = {
    lat,
    lng,
    radius_m: Math.round(radius),
    report_count: members.length,
    disaster_type: typeFreq[0] ?? 'other',
    people_count: Math.max(people, trapped + injured),
    trapped_count: trapped,
    trapped_confirmed: trappedConfirmed,
    trapped_reported_max: Math.max(0, ...members.map((m) => m.x.trapped_count)),
    children_count: children,
    injured_count: injured,
    needs: ranked(members.map((m) => m.x.needs)),
    hazards: ranked(members.map((m) => m.x.hazards), 0.12),
    first_report_at: times[0],
    last_report_at: times[times.length - 1],
    distinct_sources: groups.length + witnesses.length,
  };
  const meanUrgency = members.reduce((s, m) => s + m.x.urgency, 0) / members.length;
  return { ...base, severity: severityOf(base, meanUrgency) };
}
