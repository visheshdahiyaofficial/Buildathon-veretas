/**
 * Offline fallbacks used when Ollama is not running: keyword extraction and a
 * small "topic + words" embedding. Good enough to keep the pipeline working;
 * Ollama gives much better results on messy, multilingual text.
 */
import type { Extraction, Hazard, Need } from '@dw/shared';
import { normalize } from './geo.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, dozen: 12,
  several: 3, few: 3, some: 2, many: 10, dozens: 24, hundreds: 100, couple: 2,
};

const HAZARD_WORDS: Record<Hazard, RegExp> = {
  collapse: /collaps|rubble|debris of|caved|fell down|crushed|pancak/,
  fire: /fire|flame|burning|smoke|blaze/,
  gas_leak: /gas (leak|smell)|smell of gas|lpg|cylinder/,
  flooding: /flood|water (rising|level|everywhere)|submerged|waterlog|knee.deep|waist.deep/,
  power_lines: /power line|live wire|electric(al)? (wire|pole)|transformer|sparking/,
  chemical: /chemical|toxic|fumes/,
  landslide: /landslide|mudslide|slope gave way/,
  debris: /road (blocked|cracked)|blocked road|fallen tree|crack(s|ed)? in the road|bridge/,
};

const NEED_WORDS: Record<Need, RegExp> = {
  rescue: /trapped|stuck|under (the )?rubble|can.?t get out|need rescue|dig|buried|pinned/,
  medical: /injur|bleed|ambulance|doctor|medic|broken (leg|arm|bone)|unconscious|wounded|hospital|first aid|insulin|oxygen/,
  water: /water to drink|drinking water|no water|thirst|need water/,
  food: /food|hungry|nothing to eat|milk|ration/,
  shelter: /shelter|tent|blanket|homeless|nowhere to (sleep|stay)|sleeping outside|cold/,
  evacuation: /evacuat|get us out|move (us|people)|boat|stranded/,
  power: /no (power|electricity)|blackout|charge (my )?phone|power cut/,
};

const CHILD_RE = /\b(child|children|kid|kids|baby|babies|infant|toddler|boy|girl|students?|school ?kids|son|daughter)\b/;

function parseCount(word: string | undefined): number | null {
  if (!word) return null;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** Find a number that appears right before any of the given nouns, e.g. "3 people", "two kids". */
function countBefore(text: string, nouns: string): number {
  const re = new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:\\w+\\s+){0,2}?(?:${nouns})\\b`, 'g');
  let best = 0;
  for (const m of text.matchAll(re)) best = Math.max(best, parseCount(m[1]) ?? 0);
  return best;
}

export function keywordExtract(raw: string): Extraction {
  const text = raw.toLowerCase();
  const hazards = (Object.keys(HAZARD_WORDS) as Hazard[]).filter((h) => HAZARD_WORDS[h].test(text));
  const needs = (Object.keys(NEED_WORDS) as Need[]).filter((n) => NEED_WORDS[n].test(text));

  const trappedMentioned = /trapped|stuck|under (the )?rubble|buried|pinned|can.?t get out/.test(text);
  let trapped = countBefore(text, 'people|persons|men|women|family members|of us|workers|students|children|kids|residents|labourers')
  if (!trappedMentioned) trapped = 0;
  else if (trapped === 0) trapped = 1;
  const trappedSpecific = text.match(/(\d+|\w+) (?:\w+ )?(?:are |is )?(?:still )?trapped/);
  const tn = parseCount(trappedSpecific?.[1]);
  if (trappedMentioned && tn) trapped = tn;

  let children = countBefore(text, 'children|kids|babies|infants|students|boys|girls|school ?kids');
  if (children === 0 && CHILD_RE.test(text)) children = 1;

  let injured = countBefore(text, 'injured|hurt|wounded|bleeding|people injured');
  const injuredSpecific = text.match(/(\d+|\w+) (?:people |persons )?(?:are |is )?(?:badly |seriously )?(?:injured|hurt|wounded)/);
  injured = Math.max(injured, parseCount(injuredSpecific?.[1]) ?? 0);
  if (injured === 0 && /injur|bleed|wounded|broken (leg|arm)|unconscious/.test(text)) injured = 1;

  const people = countBefore(text, 'people|persons|of us|families|residents|family members') || null;

  let urgency = 2;
  if (/safe|minor|no damage|all fine|felt (the )?(shaking|tremor)/.test(text)) urgency = 1;
  if (needs.length || hazards.length) urgency = 3;
  if (injured > 0 || hazards.includes('fire') || hazards.includes('gas_leak')) urgency = 4;
  if (trapped > 0 || /unconscious|not breathing|dying|critical/.test(text)) urgency = 5;

  const first = raw.split(/[.!?\n]/)[0]?.trim() ?? '';
  return {
    people_count: people,
    trapped_count: trapped,
    children_count: children,
    injured_count: injured,
    hazards,
    needs,
    urgency,
    summary_line: first.slice(0, 160),
  };
}

// ---- Fallback embedding --------------------------------------------------

const TOPICS: Record<string, RegExp> = {
  collapse: /collaps|rubble|trapped|buried|crushed|caved|pinned|debris|pancak|fallen wall|building fell|dig/,
  fire: /fire|flame|smoke|burning|blaze|cylinder|explosion|sparking/,
  flood: /flood|water rising|submerged|waterlog|deep water|boat/,
  medical: /injur|bleed|hospital|doctor|ambulance|medic|wounded|patients|stretcher|blood/,
  shelter: /shelter|camp|tent|blanket|food|ration|hungry|sleeping outside|park/,
  road: /road|bridge|highway|traffic|crack|blocked|flyover/,
  school: /school|students|classroom|teacher/,
  power: /power|electric|wire|transformer|blackout/,
  safe: /safe|fine|okay|minor|no damage|felt|shaking|tremor|scared/,
};
const DIM = 256;

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return Math.abs(h) % DIM;
}

const STOP = new Set('the a an and or of to in on at is are was were we our us i my me it this that there here have has with for from by be been all very please help need'.split(' '));

/** Topic-weighted bag-of-words vector. Similar topics → high cosine. */
export function keywordEmbed(raw: string): number[] {
  const text = raw.toLowerCase();
  const topicKeys = Object.keys(TOPICS);
  const v = new Array(topicKeys.length + DIM).fill(0);
  topicKeys.forEach((k, i) => {
    if (TOPICS[k].test(text)) v[i] = 4;
  });
  for (const w of text.split(/[^a-z]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    v[topicKeys.length + hash(w.slice(0, 6))] += 0.5;
  }
  return normalize(v);
}
