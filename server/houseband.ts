/**
 * The house band: the rule-based players that play when there's no API key (the kellymartin.dev build without a visitor key).
 * They follow the song plan like the AI band does: each section has its own part (sparse intro, rising build, full drop, kick-less breakdown), every 4-bar block varies a little, the last bar of a block gets a fill, the drop has a hook that comes back in the next drop (as an ECHO in the band's memory), and each time the song loops the parts develop (new drum variation, the hook moves up).
 * Each player says one short line when a section starts, so the band chat shows who's playing.
 * Pure functions plus a small per-session map; no network, no model.
 */
import { parseChord, type BlockPlan, type SectionName } from '../shared/arrangement.js';
import type { Meter } from '../shared/meter.js';
import type { BassBar, ChordBar, DrumBar, MelodyBar } from '../shared/types.js';
import type { EchoClaim } from './schemas.js';
import { motifId, type MemoryAgent, type MemoryCtx } from './memory-core.js';
import { isMinorKey, nameOf, tonicOf } from './fallback.js';

const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'E#': 5, Fb: 4, 'B#': 0 };
const midi = (pc: number, octave: number) => (octave + 1) * 12 + (((pc % 12) + 12) % 12);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length) % items.length];

// ---------- Where the block sits in the song ----------

interface Occurrence { startBar: number; blocks: Partial<Record<MemoryAgent, number>> }
/** Per session: each section name's occurrences in order (first drop, second drop, ...), with the block each player wrote at its start. */
const sessions = new Map<string, Map<SectionName, Occurrence[]>>();

export interface HouseSpot {
  section: SectionName;
  /** 0 for the section's first 4-bar block, 1 for the next, ... */
  blockInSection: number;
  /** True for the section's last block (its last bar gets the big fill) */
  lastBlock: boolean;
  /** 0 the first time this section plays, 1 the second time (second drop, or the song looping), ... */
  occurrence: number;
  seed: string;
  /** What the listener's latest steer asked for, in the words the house band understands */
  mood: { half: boolean; dark: boolean; bright: boolean; busy: boolean; sparse: boolean };
}

/** Reads a steer the way the house band can: a few plain words, nothing more. */
export function moodOf(text: string | undefined): HouseSpot['mood'] {
  const t = (text ?? '').toLowerCase();
  return {
    half: /half[- ]?time|halftime|slower feel/.test(t),
    dark: /dark|moody|minor|sad|heavy|deeper/.test(t),
    bright: /bright|happy|light|uplift|major|sunny/.test(t),
    busy: /busy|busier|more energy|faster feel|intense|hype|harder/.test(t),
    sparse: /sparse|minimal|chill|calm|quiet|space|strip/.test(t),
  };
}

export function spotOf(plan: BlockPlan | undefined, ctx: MemoryCtx | undefined, steerText?: string): HouseSpot {
  const section = plan?.section ?? 'drop';
  const blockInSection = plan ? Math.floor((plan.sectionBar - 1) / 4) : 0;
  const lastBlock = plan ? plan.sectionBar + 4 > plan.sectionBars : true;
  let occurrence = 0;
  if (ctx?.section) {
    let byName = sessions.get(ctx.sessionId);
    if (!byName) sessions.set(ctx.sessionId, (byName = new Map()));
    const list = byName.get(section) ?? [];
    let i = list.findIndex((o) => o.startBar === ctx.section!.startBar);
    if (i < 0) {
      list.push({ startBar: ctx.section.startBar, blocks: {} });
      i = list.length - 1;
    }
    byName.set(section, list);
    occurrence = i;
  }
  return { section, blockInSection, lastBlock, occurrence, seed: ctx?.sessionId ?? 'house', mood: moodOf(steerText) };
}

/** Remembers this player's first block of a section occurrence and, when the same section played before, points back at that earlier phrase. */
export function echoFor(agent: MemoryAgent, spot: HouseSpot, ctx: MemoryCtx | undefined): EchoClaim | null {
  if (!ctx?.section || spot.blockInSection !== 0) return null;
  const list = sessions.get(ctx.sessionId)?.get(spot.section);
  if (!list) return null;
  const mine = list[spot.occurrence];
  if (mine && mine.blocks[agent] === undefined) mine.blocks[agent] = ctx.block;
  const earlier = spot.occurrence > 0 ? list[spot.occurrence - 1]?.blocks[agent] : undefined;
  if (earlier === undefined) return null;
  const what: Record<MemoryAgent, string> = { drums: 'the same groove, new fill', bass: 'that bassline again', keys: 'those chords again', melody: 'the hook again', vox: 'those chops again' };
  return { id: motifId(ctx.sessionId, earlier, agent), reason: `${what[agent]}, last ${spot.section}` };
}

// ---------- What each player says when a section starts ----------

const LINES: Record<SectionName, Record<'drums' | 'bass' | 'keys' | 'melody', string[]>> = {
  intro: {
    drums: ['Just kick and a few hats while everyone settles in.', 'Keeping it light: kick, hats, nothing else yet.'],
    bass: ['Holding the root, long and low.', 'One note per chord to start.'],
    keys: ['Soft pads, leaving room.', 'Long chords, nice and slow.'],
    melody: ['Sitting out for now, then a little hint of the hook.', 'Waiting, then just a taste.'],
  },
  build: {
    drums: ['More hats, and a snare roll into the drop.', 'Building: snare comes in, roll at the end.'],
    bass: ['Walking up toward the drop.', 'Eighth notes now, pushing forward.'],
    keys: ['Chords on every beat, pushing.', 'Stabbing every beat to build it up.'],
    melody: ['Climbing the hook a step at a time.', 'Teasing the hook, higher each bar.'],
  },
  drop: {
    drums: ['Full kit, lazy swing, ghost snares.', 'Here we go: kick, snare, ghost notes.'],
    bass: ['Locked to the kick, with octave jumps.', 'On the kick, bouncing up the octave.'],
    keys: ['Offbeat stabs.', 'Chopping the chords on the offbeats.'],
    melody: ["Here's the hook.", 'Hook time.'],
  },
  breakdown: {
    drums: ['Kick out. Just rim and hats.', 'Dropping the kick, keeping a pulse.'],
    bass: ['One long note per chord.', 'Laying back, whole notes.'],
    keys: ['Back to pads, wide and slow.', 'Open chords, lots of space.'],
    melody: ['Hook at half speed.', 'Slowing the hook right down.'],
  },
};
const AGAIN: Record<'drums' | 'bass' | 'keys' | 'melody', string> = {
  drums: 'Same groove as last time, with a new fill.',
  bass: 'Same line as last time, a bit busier.',
  keys: 'Same chords, new voicing.',
  melody: 'Hook again, ending higher this time.',
};

/** The line a player says: only on the first block of a section. */
const heardSteer = new Map<string, string>();
const STEER_LINES: Record<'half' | 'dark' | 'bright' | 'busy' | 'sparse', Record<'drums' | 'bass' | 'keys' | 'melody', string>> = {
  half: { drums: 'Half-time: kick on the one, snare on three.', bass: 'Laying back with it.', keys: 'Letting the chords ring longer.', melody: 'Giving the hook more room.' },
  dark: { drums: 'Thinning the hats, keeping it low.', bass: 'Staying low and heavy.', keys: 'Dropping the chords an octave.', melody: 'Taking the hook down low.' },
  bright: { drums: 'Opening it up.', bass: 'Lifting it a little.', keys: 'Chords up an octave, brighter.', melody: 'Hook up high.' },
  busy: { drums: 'Sixteenth hats, more push.', bass: 'Keeping it locked under all that.', keys: 'Staying on the offbeats.', melody: 'Riding it.' },
  sparse: { drums: 'Pulling back to the essentials.', bass: 'Just the roots.', keys: 'Lots of space.', melody: 'Fewer notes.' },
};

export function houseWhy(agent: 'drums' | 'bass' | 'keys' | 'melody', spot: HouseSpot, steerText?: string): string {
  // The first block after a steer: each player says how it's following it.
  const key = `${spot.seed}:${agent}`;
  if ((steerText ?? '') !== (heardSteer.get(key) ?? '')) {
    heardSteer.set(key, steerText ?? '');
    const m = (['half', 'dark', 'bright', 'busy', 'sparse'] as const).find((k) => spot.mood[k]);
    if (m) return STEER_LINES[m][agent];
  }
  if (spot.blockInSection !== 0) return '';
  if (spot.occurrence > 0) return AGAIN[agent];
  return pick(rng(`${spot.seed}:${spot.section}:${agent}:line`), LINES[spot.section][agent]);
}

// ---------- Chords from the plan ----------

function chordsFor(plan: BlockPlan | undefined, key: string): { root: number; tones: number[] }[] {
  const symbols = plan?.chords?.length ? plan.chords : [];
  const start = plan ? plan.sectionBar - 1 : 0;
  return Array.from({ length: 4 }, (_, i) => {
    const c = symbols.length ? parseChord(symbols[(start + i) % symbols.length]) : null;
    if (c) {
      const tones = c.tones.map((t) => PC[t] ?? 0);
      return { root: tones[0], tones };
    }
    const root = tonicOf(key);
    return { root, tones: [root, root + (isMinorKey(key) ? 3 : 4), root + 7] };
  });
}

// ---------- Drums ----------

export function houseDrums(m: Meter, spot: HouseSpot): DrumBar[] {
  const n = m.stepsPerBar;
  const a = m.accentSteps;
  const four = a.length >= 4;
  const beats = a;
  const backbeat = four ? [a[1], a[3]] : a.slice(1);
  const row = (steps: number[]) => Array.from({ length: n }, (_, i) => (steps.includes(i) ? 1 : 0));
  const every = (k: number, offset = 0) => Array.from({ length: n }, (_, i) => i).filter((i) => i % k === offset % k);
  const r = rng(`${spot.seed}:drums:${spot.section}:${spot.occurrence}`);
  // A few lo-fi kick shapes; which one a drop uses changes each time the song loops.
  const kickShapes = four
    ? [[a[0], a[2]], [a[0], a[0] + 3 < a[1] ? a[0] + 3 : a[0], a[2]], [a[0], a[2], a[2] + 2 < n ? a[2] + 2 : a[2]], [a[0], a[1] + 2 < a[2] ? a[1] + 2 : a[1], a[2]]]
    : [[a[0]], [a[0], Math.min(n - 1, a[0] + 2)]];
  const kicks = kickShapes[(spot.occurrence + Math.floor(r() * 2)) % kickShapes.length];

  return Array.from({ length: 4 }, (_, bar) => {
    const lastBar = bar === 3;
    let kick: number[] = [];
    let snare: number[] = [];
    let hat: number[] = [];
    const ghost: number[] = [];
    switch (spot.section) {
      case 'intro':
        kick = spot.blockInSection === 0 && bar < 2 ? [a[0]] : [a[0], ...(four ? [a[2]] : [])];
        hat = every(spot.blockInSection === 0 ? 4 : 2);
        if (spot.blockInSection > 0 && lastBar) snare = [backbeat[backbeat.length - 1]];
        break;
      case 'build': {
        kick = [...beats];
        snare = bar >= 1 || spot.blockInSection > 0 ? backbeat : [];
        hat = every(spot.blockInSection === 0 ? 2 : 1);
        if (lastBar && spot.lastBlock) snare = [...backbeat, ...every(2).filter((s) => s >= n / 2), ...every(1).filter((s) => s >= (3 * n) / 4)];
        break;
      }
      case 'drop':
        kick = kicks;
        snare = backbeat;
        hat = every(2);
        if (n >= 16) ghost.push(...backbeat.map((s) => s + 3).filter((s) => s < n && !kicks.includes(s)));
        if (spot.occurrence % 2 === 1 && n >= 16) hat = every(1).filter((s) => s % 4 !== 1); // the repeat drop rides busier hats
        if (lastBar) snare = [...backbeat, ...(spot.occurrence % 2 ? [n - 4, n - 2, n - 1] : [n - 3, n - 1]).filter((s) => s >= 0)];
        break;
      case 'breakdown':
        kick = [];
        snare = bar % 2 === 1 ? [backbeat[backbeat.length - 1]] : [];
        hat = every(4, 2);
        if (lastBar && spot.lastBlock) kick = [a[0]];
        break;
    }
    if (spot.mood.half && spot.section !== 'breakdown') {
      // Half-time: kick on the one, snare only on beat three, hats thinned to quarters.
      kick = kick.length ? [a[0]] : [];
      snare = four && snare.length ? [a[2]] : snare.slice(0, 1);
      ghost.length = 0;
      hat = hat.filter((s) => beats.includes(s) || s % 4 === 0);
    }
    if (spot.mood.sparse) { hat = hat.filter((s) => s % 4 === 0); ghost.length = 0; }
    if (spot.mood.busy && spot.section !== 'breakdown') hat = every(1);
    if (spot.mood.dark) hat = hat.filter((s) => s % 2 === 0);
    const snareAll = [...new Set([...snare, ...ghost])].sort((x, y) => x - y);
    const snareVel = Array.from({ length: n }, (_, i) => (ghost.includes(i) && !snare.includes(i) ? 0.3 : spot.section === 'breakdown' ? 0.5 : 0.8));
    const hatVel = Array.from({ length: n }, (_, i) => (beats.includes(i) ? 0.7 : 0.45 + (rng(`${spot.seed}:h:${bar}:${i}`)() * 0.2)));
    return { kick: row(kick), snare: row(snareAll), hat: row(hat), velocity: { snare: snareVel, hat: hatVel } };
  });
}

// ---------- Bass ----------

function houseBassRaw(key: string, plan: BlockPlan | undefined, drums: DrumBar[], m: Meter, spot: HouseSpot): BassBar[] {
  const chords = chordsFor(plan, key);
  const n = m.stepsPerBar;
  return chords.map((c, bar) => {
    const root = nameOf(midi(c.root, 2));
    const octave = nameOf(midi(c.root, 3));
    const fifth = nameOf(midi(c.tones[2] ?? c.root + 7, 2));
    const kicks = drums[bar]?.kick.flatMap((v, i) => (v ? [i] : [])) ?? [0];
    switch (spot.section) {
      case 'intro':
      case 'breakdown':
        return [{ step: 0, note: root, dur: '1m', velocity: 0.7 }];
      case 'build':
        return Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0).map((step, j) => ({ step, note: j % 4 === 3 ? fifth : root, dur: '8n', velocity: 0.6 + (bar * 0.08) }));
      case 'drop': {
        const notes = (kicks.length ? kicks : [0]).map((step) => ({ step, note: root, dur: '8n', velocity: 0.85 }));
        const jump = n - 4 + (spot.occurrence % 2 ? 2 : 0);
        if (jump < n && !kicks.includes(jump)) notes.push({ step: jump, note: octave, dur: '16n', velocity: 0.7 });
        if (bar === 3 && spot.occurrence > 0) notes.push({ step: n - 2, note: fifth, dur: '16n', velocity: 0.7 });
        return notes.sort((x, y) => x.step - y.step);
      }
    }
  });
}

// ---------- Keys ----------

function houseKeysRaw(key: string, plan: BlockPlan | undefined, m: Meter, spot: HouseSpot): ChordBar[] {
  const chords = chordsFor(plan, key);
  const n = m.stepsPerBar;
  const a = m.accentSteps;
  // The voicing opens up (root moves to the top) each time the song comes round again.
  const voice = (tones: number[]) => {
    const oct = spot.mood.dark ? 2 : spot.mood.bright ? 4 : 3;
    const base = tones.map((t, i) => midi(t, oct) + (i > 0 && midi(t, oct) < midi(tones[0], oct) ? 12 : 0));
    const inv = spot.occurrence % 3;
    const out = base.map((x, i) => (i < inv ? x + 12 : x));
    return out.sort((x, y) => x - y).map(nameOf);
  };
  return chords.map((c) => {
    const notes = voice(c.tones);
    switch (spot.section) {
      case 'intro':
      case 'breakdown':
        return [{ step: 0, notes, dur: '1m' }];
      case 'build':
        return a.map((step) => ({ step, notes, dur: '8n' }));
      case 'drop':
        return a.map((s) => s + Math.max(1, Math.round(n / a.length / 2))).filter((s) => s < n).map((step) => ({ step, notes, dur: '16n' }));
    }
  });
}

// ---------- Melody ----------

/** The song's hook: a short phrase on the pentatonic scale of the key, the same every drop (so it can come back). */
function hook(seed: string, n: number): { step: number; deg: number; dur: string }[] {
  const r = rng(`${seed}:hook`);
  const slots = [0, 3, 6, 8, 10, 12, 14].filter((s) => s < n);
  const steps = slots.filter((_, i) => i === 0 || r() > 0.35).slice(0, 5);
  let deg = 2 + Math.floor(r() * 3);
  return steps.map((step, i) => {
    if (i > 0) deg = Math.max(0, Math.min(7, deg + pick(r, [-2, -1, 1, 1, 2])));
    return { step, deg, dur: i === steps.length - 1 ? '4n' : '8n' };
  });
}

function houseMelodyRaw(key: string, m: Meter, spot: HouseSpot): MelodyBar[] {
  const n = m.stepsPerBar;
  const tonic = tonicOf(key);
  const scale = isMinorKey(key) ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const note = (deg: number, lift = 0) => {
    const d = deg + lift;
    const oct = Math.floor(d / scale.length);
    return nameOf(midi(tonic + scale[((d % scale.length) + scale.length) % scale.length], spot.mood.dark ? 3 : spot.mood.bright ? 5 : 4) + 12 * oct);
  };
  const phrase = hook(spot.seed, n);
  // Each loop of the song, the hook's answer bar lifts a step.
  const lift = spot.occurrence;
  return Array.from({ length: 4 }, (_, bar) => {
    switch (spot.section) {
      case 'intro':
        if (spot.blockInSection === 0 || bar < 2) return [];
        return phrase.slice(0, 2).map((p) => ({ step: p.step, note: note(p.deg), dur: '4n', velocity: 0.5 }));
      case 'build': {
        const climb = bar + spot.blockInSection * 2;
        return phrase.slice(0, Math.min(phrase.length, 2 + bar)).map((p) => ({ step: p.step, note: note(p.deg, climb), dur: p.dur, velocity: 0.55 + bar * 0.08 }));
      }
      case 'drop': {
        if (bar === 1 || bar === 3) {
          // The answer: the hook's rhythm, resolving to the root (higher each loop).
          const answer = phrase.map((p, i) => ({ step: p.step, note: note(i === phrase.length - 1 ? 5 : p.deg - 1, bar === 3 ? lift : 0), dur: p.dur, velocity: 0.75 }));
          return spot.blockInSection % 2 === 1 && bar === 3 ? answer.slice(0, -1).concat([{ step: phrase[phrase.length - 1].step, note: note(5, lift + 1), dur: '2n', velocity: 0.8 }]) : answer;
        }
        return phrase.map((p) => ({ step: p.step, note: note(p.deg), dur: p.dur, velocity: 0.8 }));
      }
      case 'breakdown':
        if (bar % 2 === 1) return [];
        return phrase.filter((_, i) => i % 2 === 0).map((p, i) => ({ step: Math.min(n - 1, i * Math.floor(n / 2)), note: note(p.deg), dur: '2n', velocity: 0.6 }));
    }
  });
}

/** Every house part is tidied before it plays: inside the bar, in step order, one entry per step (the reply schemas require that, and a steer can change the meter under a part). */
function tidy<T extends { step: number }>(bars: T[][], n: number): T[][] {
  return bars.map((bar) => {
    const seen = new Set<number>();
    return bar
      .filter((x) => Number.isInteger(x.step) && x.step >= 0 && x.step < n)
      .sort((a, b) => a.step - b.step)
      .filter((x) => (seen.has(x.step) ? false : (seen.add(x.step), true)));
  });
}

export const houseBass = (key: string, plan: BlockPlan | undefined, drums: DrumBar[], m: Meter, spot: HouseSpot): BassBar[] => tidy(houseBassRaw(key, plan, drums, m, spot), m.stepsPerBar);
export const houseKeys = (key: string, plan: BlockPlan | undefined, m: Meter, spot: HouseSpot): ChordBar[] => tidy(houseKeysRaw(key, plan, m, spot), m.stepsPerBar);
export const houseMelody = (key: string, m: Meter, spot: HouseSpot): MelodyBar[] => tidy(houseMelodyRaw(key, m, spot), m.stepsPerBar);
