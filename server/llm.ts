import OpenAI from 'openai';
import { config } from './config.js';

let client: OpenAI | undefined;
let clientFor = '';

/**
 * OpenAI-compatible client pointed at AIAND_BASE_URL (or the visitor's own provider in the browser build). Created lazily so missing settings give a clear error, and rebuilt when the settings change.
 * In the browser the key belongs to the visitor and goes only to the provider they chose, hence dangerouslyAllowBrowser.
 */
export function getClient(): OpenAI {
  const baseURL = config.baseURL;
  const apiKey = config.apiKey;
  if (!client || clientFor !== `${baseURL}\n${apiKey}`) {
    client = new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: typeof window !== 'undefined' });
    clientFor = `${baseURL}\n${apiKey}`;
  }
  return client;
}

type Effort = NonNullable<OpenAI.Chat.ChatCompletionCreateParams['reasoning_effort']>;

/**
 * Spread into every chat.completions.create call: `{ reasoning_effort: "low" }` unless AIAND_REASONING_EFFORT says otherwise.
 * Pass `pinned` to force one agent to a fixed effort; AIAND_REASONING_EFFORT=off still omits the parameter for providers that reject it.
 */
export function reasoningParams(pinned?: string): { reasoning_effort?: Effort } {
  const configured = config.reasoningEffort;
  if (configured === null) return {};
  return { reasoning_effort: (pinned ?? configured) as Effort };
}
