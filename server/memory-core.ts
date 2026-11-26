import { VOX_ENABLED } from '../shared/flags.js';
import { z } from 'zod';
import { SECTION_NAMES } from '../shared/arrangement.js';
import type { BassBar, ChordBar, DrumBar, MelodyBar, VoxBar } from '../shared/types.js';

/** What both band-memory stores share (Neo4j on the server, an in-browser graph on kellymartin.dev): ids, schemas and how a phrase is described to the other players. */

export type MemoryAgent = 'drums' | 'bass' | 'keys' | 'melody' | 'vox';
export const MEMORY_AGENTS: readonly MemoryAgent[] = VOX_ENABLED ? ['drums', 'bass', 'keys', 'melody', 'vox'] : ['drums', 'bass', 'keys', 'melody'];

const idPart = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const sessionIdSchema = idPart;
export const memoryCtxSchema = z.object({
  sessionId: idPart,
  block: z.number().int().min(1).max(100000),
  /** The song section this block belongs to: its name and the song bar it started on (so two drops are two Section nodes) */
  section: z.object({ name: z.enum(SECTION_NAMES), startBar: z.number().int().min(1).max(100000) }).optional(),
});
export type MemoryCtx = z.infer<typeof memoryCtxSchema>;

export interface Echo {
  id: string;
  reason: string;
}

export interface BandMemoryItem {
  id: string;
  agent: string;
  block: number;
  summary: string;
}

/** Each part answers the one it is built on: bass locks to the kick, keys sit on the bass, the melody sits on the chords, and the vox chops the melody. */
export const LOCKS: Partial<Record<MemoryAgent, MemoryAgent>> = { bass: 'drums', keys: 'bass', melody: 'keys', vox: 'melody' };

export const motifId = (sessionId: string, block: number, agent: string) => `${sessionId}:${block}:${agent}`;

const MAX_SUMMARY = 240;

// ---------- Describing a phrase (this text is what other agents read as band memory) ----------

const stepsOf = (row: number[]) => row.flatMap((v, i) => (v ? [i] : []));

export function describeDrums(bars: DrumBar[]): string {
  const b = bars[0];
  if (!b) return '';
  return `bar 1: kick@${stepsOf(b.kick).join(',') || '-'} snare@${stepsOf(b.snare).join(',') || '-'} hats x${stepsOf(b.hat).length}`;
}

export function describeBass(bars: BassBar[]): string {
  const notes = (bars.find((b) => b.length) ?? []).slice(0, 6);
  return `bar 1: ${notes.map((n) => `${n.note}@${n.step}`).join(' ')}`;
}

export function describeKeys(bars: ChordBar[]): string {
  const chords = (bars.find((b) => b.length) ?? []).slice(0, 3);
  return `bar 1: ${chords.map((c) => `[${c.notes.join(' ')}]@${c.step}`).join(' ')}`;
}

export function describeMelody(bars: MelodyBar[]): string {
  const i = bars.findIndex((b) => b.length);
  if (i < 0) return 'rests';
  return `bar ${i + 1}: ${bars[i].slice(0, 8).map((n) => `${n.note}@${n.step}`).join(' ')}`;
}

export function describeVox(bars: VoxBar[]): string {
  const i = bars.findIndex((b) => b.length);
  if (i < 0) return 'silent';
  return `bar ${i + 1}: ${bars[i].slice(0, 8).map((n) => `${n.note}/${n.vowel}@${n.step}`).join(' ')}`;
}

export function summarize(agent: MemoryAgent, bars: unknown[], why: string, fallback: boolean): string {
  const b = bars as never[];
  const detail = agent === 'drums' ? describeDrums(b) : agent === 'bass' ? describeBass(b) : agent === 'keys' ? describeKeys(b) : agent === 'vox' ? describeVox(b) : describeMelody(b);
  const lead = fallback || !why ? '(repeated an earlier phrase)' : why;
  return `${lead} | ${detail}`.slice(0, MAX_SUMMARY);
}

