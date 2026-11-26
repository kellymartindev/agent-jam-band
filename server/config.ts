/**
 * Model settings. On the server they come from .env (loaded by the entry points). In the browser build on kellymartin.dev there is no .env: the visitor's own settings are set with setLlmSettings, and with none set every agent call fails fast, so the band plays its rule-based parts (the "house band").
 */
export interface LlmSettings {
  baseURL: string;
  apiKey: string;
  model: string;
  /** "low", "medium", "high" or "off" */
  reasoningEffort?: string;
}

let override: LlmSettings | null = null;
let browserMode = false;

/** Browser build: settings come only from the visitor. Pass null for the house band. */
export function setLlmSettings(settings: LlmSettings | null) {
  browserMode = true;
  override = settings;
}

const env = (name: string): string | undefined => (typeof process !== 'undefined' && process.env ? process.env[name] : undefined);

export function requireEnv(name: string): string {
  if (browserMode) throw new Error('No API key set, so the house band is playing.');
  const value = env(name)?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env (see .env.example).`);
  }
  return value;
}

export const config = {
  get baseURL() { return override?.baseURL.trim() || requireEnv('AIAND_BASE_URL'); },
  get apiKey() { return override?.apiKey.trim() || requireEnv('AIAND_API_KEY'); },
  get model() { return override?.model.trim() || requireEnv('AIAND_MODEL'); },
  /** From AIAND_REASONING_EFFORT; defaults to "low"; "off" returns null so the parameter is omitted. */
  get reasoningEffort(): string | null {
    const value = (override ? override.reasoningEffort : env('AIAND_REASONING_EFFORT'))?.trim().toLowerCase() || 'low';
    return value === 'off' ? null : value;
  },
  port: Number(env('PORT') ?? 8787),
};
