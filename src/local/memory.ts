/**
 * The band's memory in the browser (the kellymartin.dev build, where there is no server and no Neo4j).
 * Same exports and the same behaviour as server/memory.ts, kept in plain arrays for the open tab: every phrase is a motif in its block, linked to the part it locks to and to any motif it calls back. Nothing is stored after the tab closes.
 */
import { VOX_ENABLED } from '../../shared/flags.js';
import type { GraphLink, GraphNode, GraphPayload } from '../../shared/types.js';
import { LOCKS, MEMORY_AGENTS, motifId, summarize, type BandMemoryItem, type Echo, type MemoryAgent, type MemoryCtx } from '../../server/memory-core.js';

export * from '../../server/memory-core.js';

interface Motif { id: string; agent: string; block: number; summary: string; fallback: boolean; at: number; lockId: string | null; echo: Echo | null }
interface Session {
  vibe: string;
  blocks: Set<number>;
  sections: Map<number, string>; // startBar -> name
  blockSection: Map<number, number>; // block -> section startBar
  motifs: Map<string, Motif>;
  steers: { id: string; text: string; why: string; atBlock: number }[];
  discarded: Set<number>;
}

const sessions = new Map<string, Session>();
let clock = 0;

function sessionOf(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { vibe: '', blocks: new Set(), sections: new Map(), blockSection: new Map(), motifs: new Map(), steers: [], discarded: new Set() };
    sessions.set(id, s);
  }
  return s;
}

export function rememberSession(sessionId: string, info: { vibe: string; bpm: number; key: string; timeSignature: string; preset: string }) {
  sessionOf(sessionId).vibe = info.vibe;
}

export function remember(ctx: MemoryCtx, agent: MemoryAgent, motif: { bars: unknown[]; why: string; echoes: Echo | null; fallback: boolean }) {
  if (agent === 'vox' && !VOX_ENABLED) return;
  const s = sessionOf(ctx.sessionId);
  if (s.discarded.has(ctx.block)) return;
  s.blocks.add(ctx.block);
  if (ctx.section) {
    s.sections.set(ctx.section.startBar, ctx.section.name);
    s.blockSection.set(ctx.block, ctx.section.startBar);
  }
  const lockAgent = LOCKS[agent];
  const id = motifId(ctx.sessionId, ctx.block, agent);
  s.motifs.set(id, {
    id,
    agent,
    block: ctx.block,
    summary: summarize(agent, motif.bars, motif.why, motif.fallback),
    fallback: motif.fallback,
    at: ++clock,
    lockId: lockAgent ? motifId(ctx.sessionId, ctx.block, lockAgent) : null,
    echo: motif.echoes && motif.echoes.id !== id ? motif.echoes : null,
  });
}

export function discardBlocks(sessionId: string, blocks: number[]) {
  const s = sessionOf(sessionId);
  for (const n of blocks) {
    s.discarded.add(n);
    s.blocks.delete(n);
    s.blockSection.delete(n);
    for (const [id, m] of s.motifs) if (m.block === n) s.motifs.delete(id);
  }
  const used = new Set(s.blockSection.values());
  for (const start of [...s.sections.keys()]) if (!used.has(start)) s.sections.delete(start);
}

/** Recordings only ever download to the listener's computer; the browser build keeps no summary of them. */
export function rememberRecording(_sessionId: string, _rec: { id: string; startBar: number; endBar: number; durationSec: number }) {}

export function rememberSteer(sessionId: string, steer: { id: string; text: string; atBlock: number; why: string }, _settings: { bpm: number; key: string; timeSignature: string; preset: string }) {
  sessionOf(sessionId).steers.push({ id: `${sessionId}:steer:${steer.id}`, text: steer.text, why: steer.why, atBlock: steer.atBlock });
}

export function ensureSchema() {}

/** The 3 most recent motifs from the OTHER players in this session, from earlier blocks (never fallback phrases). */
export async function recall(ctx: MemoryCtx, agent: MemoryAgent): Promise<BandMemoryItem[]> {
  const s = sessions.get(ctx.sessionId);
  if (!s) return [];
  return [...s.motifs.values()]
    .filter((m) => m.agent !== agent && m.block < ctx.block && !m.fallback)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3)
    .map(({ id, agent: a, block, summary }) => ({ id, agent: a, block, summary }));
}

export async function loadGraph(sessionId: string): Promise<GraphPayload> {
  const s = sessions.get(sessionId);
  if (!s) return { nodes: [], links: [], available: true };
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const sessionNode = `session:${sessionId}`;
  nodes.push({ id: sessionNode, type: 'session', label: 'session' });
  for (const index of [...s.blocks].sort((a, b) => a - b)) {
    nodes.push({ id: `block:${index}`, type: 'block', label: `block ${index}`, block: index });
    links.push({ source: `block:${index}`, target: sessionNode, type: 'IN_SESSION' });
  }
  for (const [startBar, name] of [...s.sections].sort((a, b) => a[0] - b[0])) {
    nodes.push({ id: `section:${startBar}`, type: 'section', label: name, summary: `${name} · from bar ${startBar}` });
    links.push({ source: `section:${startBar}`, target: sessionNode, type: 'IN_SESSION' });
  }
  for (const [block, startBar] of s.blockSection) if (s.sections.has(startBar)) links.push({ source: `block:${block}`, target: `section:${startBar}`, type: 'IN_SECTION' });
  const motifs = [...s.motifs.values()].sort((a, b) => a.block - b.block || a.at - b.at);
  const agents = new Set<string>();
  for (const m of motifs) {
    agents.add(m.agent);
    nodes.push({ id: m.id, type: 'motif', label: `${m.agent} ${m.block}`, agent: m.agent, block: m.block, summary: m.summary });
    links.push({ source: m.id, target: `block:${m.block}`, type: 'IN_BLOCK' });
  }
  for (const agent of MEMORY_AGENTS) if (agents.has(agent)) nodes.push({ id: `agent:${agent}`, type: 'agent', label: agent, agent });
  for (const m of motifs) links.push({ source: `agent:${m.agent}`, target: m.id, type: 'PLAYED' });
  for (const t of s.steers) {
    nodes.push({ id: t.id, type: 'steer', label: t.text.length > 24 ? `${t.text.slice(0, 23)}…` : t.text, summary: [t.text, t.why].filter(Boolean).join(' — '), block: t.atBlock });
    links.push({ source: t.id, target: sessionNode, type: 'CHANGED' });
  }
  for (const m of motifs) {
    if (m.lockId && s.motifs.has(m.lockId)) links.push({ source: m.id, target: m.lockId, type: 'LOCKS_TO' });
    if (m.echo && s.motifs.has(m.echo.id)) links.push({ source: m.id, target: m.echo.id, type: 'ECHOES', ...(m.echo.reason ? { reason: m.echo.reason } : {}) });
  }
  return { nodes, links, available: true };
}
