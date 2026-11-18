import { z } from 'zod';

export const DISASTER_TYPES = [
  'earthquake',
  'flood',
  'storm',
  'tornado',
  'fire',
  'landslide',
  'tsunami',
  'other',
] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export const NEEDS = ['rescue', 'medical', 'water', 'food', 'shelter', 'evacuation', 'power'] as const;
export type Need = (typeof NEEDS)[number];

export const HAZARDS = [
  'collapse',
  'fire',
  'gas_leak',
  'flooding',
  'power_lines',
  'chemical',
  'landslide',
  'debris',
] as const;
export type Hazard = (typeof HAZARDS)[number];

export const CLUSTER_STATUSES = ['new', 'dispatched', 'resolved'] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];

export const LABELS: Record<DisasterType | Need | Hazard, string> = {
  earthquake: 'Earthquake',
  flood: 'Flood',
  storm: 'Storm',
  tornado: 'Tornado',
  fire: 'Fire',
  landslide: 'Landslide',
  tsunami: 'Tsunami',
  other: 'Other',
  rescue: 'Rescue',
  medical: 'Medical help',
  water: 'Water',
  food: 'Food',
  shelter: 'Shelter',
  evacuation: 'Evacuation',
  power: 'Power',
  collapse: 'Building collapse',
  gas_leak: 'Gas leak',
  flooding: 'Flooding',
  power_lines: 'Downed power lines',
  chemical: 'Chemical spill',
  debris: 'Debris / blocked road',
};

const count = z.number().int().min(0).max(10000);

/** What the phone sends. Mirrors the columns the app may insert. */
export const ReportInputSchema = z.object({
  client_id: z.string().min(8).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).nullable(),
  disaster_type: z.enum(DISASTER_TYPES),
  /** 'self' = counts describe the reporter's own group; 'others' = what they can see around them. */
  about: z.enum(['self', 'others']),
  text: z.string().max(4000),
  people_count: count.nullable(),
  trapped_count: count,
  has_children: z.boolean(),
  injured_count: count,
  needs: z.array(z.enum(NEEDS)),
  photo_paths: z.array(z.string()).max(3),
  reported_at: z.string(),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;

/** What the AI extracts from one report's free text. */
export const ExtractionSchema = z.object({
  people_count: count.nullable().catch(null),
  trapped_count: count.catch(0),
  children_count: count.catch(0),
  injured_count: count.catch(0),
  hazards: z.array(z.enum(HAZARDS)).catch([]),
  needs: z.array(z.enum(NEEDS)).catch([]),
  urgency: z.number().int().min(1).max(5).catch(3),
  summary_line: z.string().max(300).catch(''),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** A report row as the worker and dashboard see it. */
export interface Report extends ReportInput {
  id: string;
  created_at: string;
  extracted: Extraction | null;
  cluster_id: string | null;
  processed_at: string | null;
}

export interface Cluster {
  id: string;
  lat: number;
  lng: number;
  radius_m: number;
  report_count: number;
  disaster_type: DisasterType;
  severity: number; // 1–5
  people_count: number;
  /** Best estimate of people trapped (see aggregate.ts in the worker). */
  trapped_count: number;
  /** Trapped people who reported themselves (first-hand). */
  trapped_confirmed: number;
  /** Highest trapped number any single report claimed (may be uncorroborated). */
  trapped_reported_max: number;
  children_count: number;
  injured_count: number;
  needs: Need[];
  hazards: Hazard[];
  title: string;
  summary: string;
  member_hash: string;
  status: ClusterStatus;
  first_report_at: string;
  last_report_at: string;
  updated_at: string;
}

/** Shape of the demo file the worker writes and the dashboard reads. */
export interface DemoData {
  generated_at: string;
  ai: 'ollama' | 'fallback';
  reports: Report[];
  clusters: Cluster[];
}

export const SEVERITY_LABELS = ['', 'Low', 'Moderate', 'Serious', 'Severe', 'Critical'] as const;
