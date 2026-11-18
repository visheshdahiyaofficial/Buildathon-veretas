import { describe, expect, it } from 'vitest';
import type { Extraction } from '@dw/shared';
import { aggregate, witnessEstimate, type Member } from './aggregate.js';
import { clusterPoints, matchIds } from './cluster.js';
import { mergeWithReporter } from './extract.js';
import { keywordEmbed, keywordExtract } from './keywords.js';
import { runClustering } from './pipeline.js';
import { processReports } from './process.js';
import { syntheticReports } from './synthetic.js';

const X = (o: Partial<Extraction> = {}): Extraction => ({
  people_count: null, trapped_count: 0, children_count: 0, injured_count: 0,
  hazards: [], needs: [], urgency: 2, summary_line: '', ...o,
});
const M = (id: string, lat: number, lng: number, text: string, about: 'self' | 'others', x: Partial<Extraction>): Member => ({
  id, lat, lng, vec: keywordEmbed(text), disaster_type: 'earthquake', about, reported_at: '2026-11-18T10:00:00Z', x: X(x), text,
});
const P = (id: string, lat: number, lng: number, text: string, trapped = 0) => ({
  id, lat, lng, vec: keywordEmbed(text), urgency: trapped ? 5 : 2, trapped,
});
const params = { epsMeters: 500, sameSpotMeters: 50, minSimilarity: 0.5, minPoints: 3 };

describe('keyword extraction', () => {
  it('reads counts, children and needs', () => {
    const x = keywordExtract('Around 8 children trapped in the school classroom, need ambulance');
    expect(x.trapped_count).toBe(8);
    expect(x.children_count).toBe(8);
    expect(x.needs).toContain('rescue');
    expect(x.urgency).toBe(5);
  });
  it('ignores negations', () => {
    const x = keywordExtract('Tremor felt, things fell from shelves, no injuries');
    expect(x.injured_count).toBe(0);
    expect(x.urgency).toBe(1);
  });
  it('reporter checkboxes win over the AI', () => {
    const r = { people_count: 4, trapped_count: 2, has_children: true, injured_count: 1, needs: ['water'] } as never;
    const m = mergeWithReporter(X({ trapped_count: 0, needs: ['food'] }), r);
    expect(m).toMatchObject({ trapped_count: 2, children_count: 1, injured_count: 1, people_count: 4, urgency: 5 });
    expect(m.needs.sort()).toEqual(['food', 'water']);
  });
});

describe('clustering', () => {
  const collapse = Array.from({ length: 5 }, (_, i) => P(`c${i}`, 28.4672 + i * 1e-4, 77.0645, 'building collapsed people trapped under rubble', 2));
  const fire = Array.from({ length: 4 }, (_, i) => P(`f${i}`, 28.4675 + i * 1e-4, 77.0670, 'transformer on fire sparking live wires'));

  it('separates a fire and a collapse on the same street', () => {
    const groups = clusterPoints([...collapse, ...fire], params);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length).sort()).toEqual([4, 5]);
  });
  it('keeps a lone trapped report as its own cluster', () => {
    const lone = P('lone', 28.42, 77.10, 'my leg is pinned under a wall', 1);
    const calm = P('calm', 28.40, 77.00, 'felt shaking, we are safe');
    const groups = clusterPoints([...collapse, lone, calm], params);
    expect(groups).toContainEqual([5]);
    expect(groups.flat()).not.toContain(6); // safe loner stays noise
  });
  it('keeps cluster ids stable between runs', () => {
    const ids = matchIds([['a', 'b', 'c', 'd'], ['x']], [{ id: 'old', members: ['a', 'b', 'c'] }], () => 'new');
    expect(ids).toEqual(['old', 'new']);
  });
});

describe('aggregation (no double counting)', () => {
  it('witnesses of the same collapse are not summed', () => {
    const ms = [6, 5, 7, 6, 6].map((n, i) => M(`w${i}`, 28.4672 + i * 1e-3, 77.0645, `about ${n} people trapped in the building`, 'others', { trapped_count: n }));
    expect(aggregate(ms).trapped_count).toBe(6);
    expect(witnessEstimate([0, 6, 5, 7, 6])).toBe(7);
  });
  it('different families reporting themselves are summed, repeats are not', () => {
    const fam = 'I am trapped on 2nd floor with my daughter';
    const ms = [
      M('a1', 28.4669, 77.0641, fam, 'self', { trapped_count: 2, children_count: 1 }),
      M('a2', 28.46691, 77.0641, fam, 'self', { trapped_count: 2, children_count: 1 }), // same family again
      M('a3', 28.4675, 77.0641, fam, 'self', { trapped_count: 2, children_count: 1 }), // same family, GPS drifted ~65 m
      M('b', 28.4675, 77.0650, 'We are 3 people stuck in the basement', 'self', { trapped_count: 3 }),
    ];
    const t = aggregate(ms);
    expect(t.trapped_count).toBe(5);
    expect(t.trapped_confirmed).toBe(5);
    expect(t.children_count).toBe(1);
    expect(t.severity).toBe(5);
  });
});

describe('end to end on the synthetic earthquake (keyword fallback)', () => {
  it('finds the main incidents with sensible numbers', async () => {
    const processed = await processReports(syntheticReports());
    const { clusters } = await runClustering(processed, [], new Map());
    const school = clusters.find((c) => c.children_count >= 3 && c.trapped_confirmed === 0 && c.trapped_count === 8);
    expect(school).toBeTruthy();
    const lone = clusters.find((c) => c.report_count === 1 && c.trapped_count === 1);
    expect(lone).toBeTruthy();
    // No cluster should claim an absurd number of trapped people.
    expect(Math.max(...clusters.map((c) => c.trapped_count))).toBeLessThanOrEqual(10);
  }, 30_000);
});
