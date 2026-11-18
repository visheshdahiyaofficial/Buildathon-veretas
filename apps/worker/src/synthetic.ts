/**
 * A synthetic M6.4 earthquake in Gurugram, used for the demo and for seeding.
 * Each incident has a spot, a spread, and report templates written the way
 * people actually type in an emergency (short, partial, sometimes repeated).
 */
import type { DisasterType, Need, Report } from '@dw/shared';

type Template = {
  text: string;
  about?: 'self' | 'others';
  trapped?: number;
  children?: boolean;
  injured?: number;
  people?: number;
  needs?: Need[];
};

interface Incident {
  name: string;
  lat: number;
  lng: number;
  spreadM: number;
  count: number;
  type: DisasterType;
  templates: Template[];
}

export const EPICENTRE = { lat: 28.4595, lng: 77.0266 };

const INCIDENTS: Incident[] = [
  {
    name: 'Apartment collapse, Sector 29',
    lat: 28.4672, lng: 77.0645, spreadM: 90, count: 34, type: 'earthquake',
    templates: [
      { text: 'Tower B of Sunrise Apartments collapsed, at least 6 people trapped under rubble, we can hear them calling', about: 'others', trapped: 6, needs: ['rescue'] },
      { text: 'Building fell down near Sector 29 market. People trapped inside. Need cranes and rescue team', about: 'others', trapped: 5, needs: ['rescue'] },
      { text: 'I am trapped on 2nd floor stairwell with my daughter, door jammed, debris everywhere. Please hurry', about: 'self', trapped: 2, children: true, needs: ['rescue'] },
      { text: 'My mother and I are stuck under the collapsed roof in flat B-204, she is bleeding from head', about: 'self', trapped: 2, injured: 1, needs: ['rescue', 'medical'] },
      { text: 'Sunrise apartments tower B pancaked. 4 kids from the daycare on ground floor missing', about: 'others', trapped: 4, children: true, needs: ['rescue'] },
      { text: 'collapsed building sector 29, around 7 people under debris, locals digging with hands', about: 'others', trapped: 7, needs: ['rescue'] },
      { text: 'Huge dust cloud, the building is gone. Several people injured lying on the road', about: 'others', injured: 5, needs: ['medical', 'rescue'] },
      { text: 'We are 3 people stuck in the basement parking of tower B, phone battery low', about: 'self', trapped: 3, people: 3, needs: ['rescue'] },
      { text: 'Rubble blocking the road to Sunrise Apartments, ambulances cannot enter', about: 'others', needs: ['rescue'] },
      { text: 'Smell of gas near the collapsed tower, please send fire brigade before it explodes', about: 'others', needs: ['rescue'] },
    ],
  },
  {
    name: 'Gas cylinder fire, DLF Phase 3 market',
    lat: 28.4935, lng: 77.0937, spreadM: 80, count: 18, type: 'earthquake',
    templates: [
      { text: 'Fire broke out in the market after LPG cylinders fell, shops burning', about: 'others', needs: ['evacuation'] },
      { text: 'Big fire at U block market, black smoke, people running', about: 'others', injured: 2 },
      { text: 'Gas leak and flames in the food stalls, 2 people with burns', about: 'others', injured: 2, needs: ['medical'] },
      { text: 'Fire spreading to the residential floors above the shops, we are on 3rd floor smoke coming in', about: 'self', people: 5, trapped: 5, children: true, needs: ['rescue', 'evacuation'] },
      { text: 'blaze at DLF phase 3 market, fire tenders not here yet', about: 'others' },
    ],
  },
  {
    name: 'School wall collapse, Sector 14',
    lat: 28.4722, lng: 77.0436, spreadM: 70, count: 16, type: 'earthquake',
    templates: [
      { text: 'Boundary wall and one classroom of the government school collapsed, students inside', about: 'others', trapped: 8, children: true, needs: ['rescue'] },
      { text: 'Around 8 children trapped in the school classroom, teachers trying to pull them out', about: 'others', trapped: 8, children: true, needs: ['rescue', 'medical'] },
      { text: 'My son is in that school, nobody is telling us anything, parents gathered outside', about: 'others', children: true },
      { text: 'Several kids injured at the Sector 14 school, need ambulance urgently', about: 'others', injured: 6, children: true, needs: ['medical'] },
    ],
  },
  {
    name: 'Crowding and injuries at Civil Hospital',
    lat: 28.4594, lng: 77.0297, spreadM: 120, count: 22, type: 'earthquake',
    templates: [
      { text: 'Civil hospital overflowing, injured people lying outside on the ground', about: 'others', injured: 30, needs: ['medical'] },
      { text: 'Hospital has no power, operating on torch light, need generator and blood', about: 'others', needs: ['medical', 'power'] },
      { text: 'brought my injured father, waiting for 2 hours, no doctor', about: 'self', injured: 1, needs: ['medical'] },
      { text: 'Part of the old hospital building cracked, patients moved to the courtyard', about: 'others', needs: ['shelter', 'medical'] },
    ],
  },
  {
    name: 'Relief camp, Leisure Valley Park',
    lat: 28.4717, lng: 77.0716, spreadM: 150, count: 28, type: 'earthquake',
    templates: [
      { text: 'Hundreds of families sleeping in Leisure Valley park, no food or drinking water', about: 'others', people: 300, children: true, needs: ['food', 'water', 'shelter'] },
      { text: 'We are 6 people in the park since last night, kids are hungry, need milk and blankets', about: 'self', people: 6, children: true, needs: ['food', 'shelter'] },
      { text: 'No toilets or tents at the park, elderly people sitting in cold', about: 'others', needs: ['shelter'] },
      { text: 'need drinking water at Leisure Valley, many babies here', about: 'others', children: true, needs: ['water'] },
      { text: 'Our house cracked, we are staying in the park with 4 family members', about: 'self', people: 4, needs: ['shelter'] },
    ],
  },
  {
    name: 'Cracked flyover, NH-48',
    lat: 28.4823, lng: 77.0702, spreadM: 200, count: 12, type: 'earthquake',
    templates: [
      { text: 'Large cracks in the NH-48 flyover near IFFCO chowk, traffic stopped', about: 'others' },
      { text: 'Road cracked and blocked on highway, cars abandoned, nobody hurt here', about: 'others' },
      { text: 'Flyover pillar damaged, police closing the road', about: 'others' },
    ],
  },
  {
    // Same street as the collapse but a different event: should be its own cluster.
    name: 'Transformer fire next to Sector 29 market',
    lat: 28.4688, lng: 77.0672, spreadM: 25, count: 6, type: 'earthquake',
    templates: [
      { text: 'Electric transformer on fire and sparking, live wires on the road', about: 'others', needs: ['power'] },
      { text: 'Power lines fell and transformer burning near the market gate', about: 'others' },
      { text: 'Sparking wires and fire at the transformer, keep people away', about: 'others' },
    ],
  },
];

/** A single person trapped far from everyone else: must not be hidden as noise. */
const LONE: { lat: number; lng: number; type: DisasterType; t: Template } = {
  lat: 28.4211, lng: 77.1031, type: 'earthquake',
  t: { text: 'I am alone, my leg is pinned under a fallen wall in my house in Sector 56, cannot move. 71 years old', about: 'self', trapped: 1, injured: 1, needs: ['rescue', 'medical'] },
};

const SAFE_TEXTS = [
  'Felt strong shaking, we are all safe, minor cracks in walls',
  'Everyone fine here, just scared. No damage',
  'Tremor felt, things fell from shelves, no injuries',
  'We are safe, power is out in our block',
  'Shaking for 30 seconds, family is okay',
];

/** Deterministic random so demos and tests are reproducible. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(r: () => number, lat: number, lng: number, spreadM: number) {
  // Gaussian-ish spread.
  const g = () => (r() + r() + r() - 1.5) / 1.5;
  const dLat = (g() * spreadM) / 111_000;
  const dLng = (g() * spreadM) / (111_000 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function toReport(r: () => number, i: number, lat: number, lng: number, type: DisasterType, t: Template, start: number): Report {
  const at = new Date(start + r() * 3 * 3600_000).toISOString();
  return {
    id: `syn-${String(i).padStart(4, '0')}`,
    client_id: `synthetic-${i}-${Math.floor(r() * 1e9)}`,
    created_at: at,
    reported_at: at,
    lat,
    lng,
    accuracy_m: Math.round(5 + r() * 25),
    disaster_type: type,
    about: t.about ?? 'others',
    text: t.text,
    people_count: t.people ?? null,
    trapped_count: t.trapped && t.about === 'self' ? t.trapped : 0,
    has_children: !!t.children && t.about === 'self',
    injured_count: t.about === 'self' ? (t.injured ?? 0) : 0,
    needs: t.needs ?? [],
    photo_paths: [],
    extracted: null,
    cluster_id: null,
    processed_at: null,
  };
}

/**
 * Note: only "self" reports tick the checkboxes (as in the app, where the
 * checkboxes ask about "you / your group"). Witness numbers live in the text
 * and must be extracted by the AI.
 */
export function syntheticReports(seed = 42, start = Date.now() - 3 * 3600_000): Report[] {
  const r = rng(seed);
  const out: Report[] = [];
  let i = 0;
  for (const inc of INCIDENTS) {
    // Each first-person template is one real family, so it is sent once;
    // witness templates are repeated by many different onlookers.
    const self = inc.templates.filter((t) => t.about === 'self');
    const witness = inc.templates.filter((t) => t.about !== 'self');
    for (let k = 0; k < inc.count; k++) {
      const t = k < self.length ? self[k] : witness[Math.floor(r() * witness.length)];
      const p = jitter(r, inc.lat, inc.lng, inc.spreadM);
      out.push(toReport(r, i++, p.lat, p.lng, inc.type, t, start));
    }
  }
  // A family that sent the same report three times from the same spot.
  const fam: Template = INCIDENTS[0].templates[2];
  for (let k = 0; k < 3; k++) out.push(toReport(r, i++, 28.4669 + k * 1e-5, 77.0641, 'earthquake', fam, start));
  out.push(toReport(r, i++, LONE.lat, LONE.lng, LONE.type, LONE.t, start));
  // Background "we're fine" reports across the city.
  for (let k = 0; k < 45; k++) {
    const p = jitter(r, EPICENTRE.lat, EPICENTRE.lng, 4500);
    out.push(toReport(r, i++, p.lat, p.lng, 'earthquake', { text: SAFE_TEXTS[Math.floor(r() * SAFE_TEXTS.length)], about: 'self', people: 1 + Math.floor(r() * 5) }, start));
  }
  return out;
}

export const INCIDENT_NAMES = INCIDENTS.map((i) => i.name);
