/**
 * The same routes as server/index.ts, run inside the page. Used when there is no backend (the kellymartin.dev build): the agents call the visitor's own provider with the visitor's own key, or, with no key, every call fails fast and each player falls back to its rule-based part (the house band).
 */
import { z } from 'zod';
import { VOX_ENABLED } from '../../shared/flags.js';
import { meterOf } from '../../shared/meter.js';
import type { ConductorSettings, GraphPayload } from '../../shared/types.js';
import { bassAgent, conductorAgent, conductorSteerAgent, drumsAgent, keysAgent, melodyAgent, voxAgent } from '../../server/agents.js';
import { BARS, bassBarSchema, blockPlanSchema, conductorRequestSchema, drumBarSchema, jamStateSchema, keysBarSchema, melodyBarSchema } from '../../server/schemas.js';
import { discardBlocks, loadGraph, memoryCtxSchema, rememberRecording, rememberSession, rememberSteer, sessionIdSchema } from './memory.js';

type Body = Record<string, unknown>;
const four = <T extends z.ZodType>(schema: T) => z.array(schema).length(BARS);
const stepsFor = (state: z.infer<typeof jamStateSchema>) => meterOf(state.timeSignature).stepsPerBar;
const memoryOf = (b: Body) => memoryCtxSchema.safeParse(b.memory).data;
const planOf = (b: Body) => blockPlanSchema.safeParse(b.plan).data;

const routes: Record<string, (b: Body) => Promise<unknown>> = {
  '/api/agents/conductor': async (b) => {
    const { vibe, overrides, sessionId, steer } = conductorRequestSchema.parse(b);
    if (steer) {
      const out = await conductorSteerAgent(vibe, steer.current as ConductorSettings, steer.text);
      if (sessionId && out.why) {
        rememberSteer(sessionId, { id: steer.id ?? String(Date.now()), text: steer.text, atBlock: steer.atBlock ?? 0, why: out.why }, { bpm: out.bpm, key: out.key, timeSignature: out.timeSignature, preset: out.preset });
      }
      return out;
    }
    const reply = await conductorAgent(vibe, overrides);
    if (sessionId) rememberSession(sessionId, { vibe, bpm: reply.bpm, key: reply.key, timeSignature: reply.timeSignature, preset: reply.preset });
    return reply;
  },
  '/api/memory/discard': async (b) => {
    const { sessionId, blocks } = z.object({ sessionId: sessionIdSchema, blocks: z.array(z.number().int().min(1).max(100000)).max(64) }).parse(b);
    discardBlocks(sessionId, blocks);
    return { ok: true };
  },
  '/api/recording': async (b) => {
    const r = z.object({ sessionId: sessionIdSchema, id: z.string(), startBar: z.number(), endBar: z.number(), durationSec: z.number() }).parse(b);
    rememberRecording(r.sessionId, { id: r.id, startBar: r.startBar, endBar: r.endBar, durationSec: Math.round(r.durationSec) });
    return { ok: true };
  },
  '/api/agents/drums': async (b) => drumsAgent(jamStateSchema.parse(b.state), memoryOf(b), planOf(b)),
  '/api/agents/bass': async (b) => {
    const state = jamStateSchema.parse(b.state);
    return bassAgent(state, four(drumBarSchema(stepsFor(state))).parse(b.drums), memoryOf(b), planOf(b));
  },
  '/api/agents/keys': async (b) => {
    const state = jamStateSchema.parse(b.state);
    const steps = stepsFor(state);
    return keysAgent(state, four(drumBarSchema(steps)).parse(b.drums), four(bassBarSchema(steps)).parse(b.bass), memoryOf(b), planOf(b));
  },
  '/api/agents/melody': async (b) => {
    const state = jamStateSchema.parse(b.state);
    const steps = stepsFor(state);
    return melodyAgent(state, four(drumBarSchema(steps)).parse(b.drums), four(bassBarSchema(steps)).parse(b.bass), four(keysBarSchema(steps)).parse(b.keys), memoryOf(b), planOf(b));
  },
  '/api/agents/vox': async (b) => {
    if (!VOX_ENABLED) return { why: '', bars: [[], [], [], []], latencyMs: 0 };
    const state = jamStateSchema.parse(b.state);
    const steps = stepsFor(state);
    return voxAgent(state, four(drumBarSchema(steps)).parse(b.drums), four(keysBarSchema(steps)).parse(b.keys), four(melodyBarSchema(steps)).parse(b.melody), memoryOf(b), planOf(b));
  },
};

/** POST one of the API routes in-page. Throws with the same message the server would have sent. */
export async function localPost<T>(url: string, body: unknown): Promise<T> {
  const route = routes[url];
  if (!route) throw new Error(`No local route for ${url}`);
  return (await route((body ?? {}) as Body)) as T;
}

export async function localGraph(sessionId: string): Promise<GraphPayload> {
  const id = sessionIdSchema.safeParse(sessionId);
  return id.success ? loadGraph(id.data) : { nodes: [], links: [], available: true };
}
