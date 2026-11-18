import { cosine, haversine } from './geo.js';

export interface Point {
  id: string;
  lat: number;
  lng: number;
  vec: number[];
  urgency: number;
  trapped: number;
}

export interface ClusterParams {
  /** Max distance between neighbouring reports (metres). */
  epsMeters: number;
  /** Reports this close are neighbours whatever they say (metres). */
  sameSpotMeters: number;
  /** Min text similarity for neighbours between sameSpot and eps. */
  minSimilarity: number;
  /** DBSCAN core-point size, counting the point itself. */
  minPoints: number;
}

/**
 * DBSCAN over a combined place + meaning distance.
 *
 * Two reports are neighbours if they are within `epsMeters` AND talk about the
 * same thing (cosine >= minSimilarity), or if they are practically on top of
 * each other. So a collapse and a fire on the same street stay separate, but
 * twenty people describing the same collapsed building merge.
 *
 * Returns groups of point indices. Noise points that are urgent (trapped or
 * urgency >= 4) are returned as their own singleton group so one person under
 * rubble is never hidden just because nobody else reported it.
 */
export function clusterPoints(points: Point[], p: ClusterParams): number[][] {
  const n = points.length;
  // Neighbour lists. O(n²) is fine for a few thousand reports; a grid index
  // limits comparisons to nearby cells.
  const cell = (lat: number, lng: number) => {
    const sizeDeg = p.epsMeters / 111_000;
    return `${Math.floor(lat / sizeDeg)}:${Math.floor(lng / sizeDeg)}`;
  };
  const grid = new Map<string, number[]>();
  points.forEach((pt, i) => {
    const k = cell(pt.lat, pt.lng);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const sizeDeg = p.epsMeters / 111_000;
  const neighbours: number[][] = points.map((a, i) => {
    const out: number[] = [];
    const cy = Math.floor(a.lat / sizeDeg);
    // Longitude cells shrink towards the poles; search wider in lng.
    const lngSpan = Math.ceil(1 / Math.max(0.2, Math.cos((a.lat * Math.PI) / 180)));
    const cx = Math.floor(a.lng / sizeDeg);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -lngSpan; dx <= lngSpan; dx++) {
        for (const j of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (j === i) continue;
          const b = points[j];
          const d = haversine(a.lat, a.lng, b.lat, b.lng);
          if (d > p.epsMeters) continue;
          const sim = cosine(a.vec, b.vec);
          // On the same spot a little shared topic is enough; further away it must clearly match.
          if ((d <= p.sameSpotMeters && sim >= 0.2) || sim >= p.minSimilarity) out.push(j);
        }
      }
    }
    return out;
  });

  const label = new Array<number>(n).fill(-1); // -1 unvisited, -2 noise
  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (label[i] !== -1) continue;
    if (neighbours[i].length + 1 < p.minPoints) {
      label[i] = -2;
      continue;
    }
    const g = groups.length;
    const members = [i];
    label[i] = g;
    const queue = [...neighbours[i]];
    while (queue.length) {
      const j = queue.pop()!;
      if (label[j] === -2) {
        label[j] = g; // border point
        members.push(j);
      }
      if (label[j] !== -1) continue;
      label[j] = g;
      members.push(j);
      if (neighbours[j].length + 1 >= p.minPoints) queue.push(...neighbours[j]);
    }
    groups.push(members);
  }

  // Keep urgent loners visible. Merge urgent loners that are on the same spot
  // (e.g. two neighbours reporting the same trapped person).
  const loners = points.map((_, i) => i).filter((i) => label[i] === -2 && (points[i].trapped > 0 || points[i].urgency >= 4));
  const used = new Set<number>();
  for (const i of loners) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (const j of loners) {
      if (used.has(j)) continue;
      if (haversine(points[i].lat, points[i].lng, points[j].lat, points[j].lng) <= p.sameSpotMeters * 2) {
        group.push(j);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

/** Jaccard overlap of two id sets. */
export function overlap(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Give new groups the id of the previous cluster they most resemble, so the
 * dashboard selection, status (dispatched/resolved) and summary survive re-runs.
 */
export function matchIds(
  groups: string[][],
  previous: { id: string; members: string[] }[],
  newId: () => string,
): string[] {
  const prevSets = previous.map((p) => ({ id: p.id, set: new Set(p.members) }));
  const pairs: { g: number; p: number; score: number }[] = [];
  groups.forEach((members, g) => {
    const set = new Set(members);
    prevSets.forEach((p, pi) => {
      const score = overlap(set, p.set);
      if (score >= 0.3) pairs.push({ g, p: pi, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const ids = new Array<string | null>(groups.length).fill(null);
  const takenPrev = new Set<number>();
  for (const { g, p } of pairs) {
    if (ids[g] || takenPrev.has(p)) continue;
    ids[g] = prevSets[p].id;
    takenPrev.add(p);
  }
  return ids.map((id) => id ?? newId());
}
