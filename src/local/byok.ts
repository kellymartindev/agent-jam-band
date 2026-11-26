/**
 * Bring your own key (the kellymartin.dev build). When the page has no backend, the agents run in the page and call the visitor's own provider.
 * The key is kept in sessionStorage (gone when the tab closes) and is sent only to the base URL the visitor picks. With no key the band still plays: every player falls back to its rule-based part, the "house band".
 */
import { setLlmSettings, type LlmSettings } from '../../server/config.js';

const STORE = 'ajb.llm';

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
  { id: 'custom', name: 'Other (OpenAI-compatible)', baseURL: '' },
] as const;

let backend: Promise<boolean> | null = null;
let keyed = false;

/** True when the visitor has set a key (in-page mode only). */
export const hasKey = () => keyed;

/** True when there is no API server behind the page, so the agents run in the page. Checked once. */
export function inPage(): Promise<boolean> {
  backend ??= (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      const data = res.ok && (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
      return !(data && (data as { ok?: boolean }).ok);
    } catch {
      return true;
    }
  })();
  return backend;
}

function load(): LlmSettings | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    const s = raw ? (JSON.parse(raw) as LlmSettings) : null;
    return s && s.apiKey && s.baseURL && s.model ? s : null;
  } catch {
    return null;
  }
}

function save(s: LlmSettings | null) {
  try {
    if (s) sessionStorage.setItem(STORE, JSON.stringify(s));
    else sessionStorage.removeItem(STORE);
  } catch {
    // storage blocked: the settings still apply for this page
  }
}

/** Adds the "House band / Your key" button and its dialog. Only shown when the agents run in the page. */
export async function mountKeyControl(anchor: HTMLElement) {
  if (!(await inPage())) return;
  let current = load();
  setLlmSettings(current);
  keyed = !!current;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost key-btn';
  const label = () => {
    btn.textContent = current ? 'Your key ✓' : 'House band';
    btn.title = current ? `Playing with your ${current.model} key. Click to change or remove it.` : 'No API key: the band plays its built-in parts. Click to bring your own key.';
  };
  label();
  anchor.after(btn);

  const dlg = document.createElement('dialog');
  dlg.className = 'key-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="key-form">
      <h2>Bring your own key</h2>
      <p>The band's players are AI models. Paste a key from your own provider and they write the music live. Your key stays in this browser tab, goes only to the provider you pick, and is forgotten when you close the tab.</p>
      <p>No key? The house band plays simple built-in parts instead, so you can still hear it.</p>
      <label>Provider
        <select name="provider">${PROVIDERS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
      </label>
      <label class="key-base">Base URL <input name="baseURL" type="url" placeholder="https://…/v1" autocomplete="off" /></label>
      <label>API key <input name="apiKey" type="password" autocomplete="off" spellcheck="false" required /></label>
      <label>Model <input name="model" type="text" autocomplete="off" spellcheck="false" placeholder="A chat model your key can use" required /></label>
      <label>Reasoning effort
        <select name="effort"><option value="off">Off (most models)</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
      </label>
      <div class="key-actions">
        <button type="submit" value="save" class="primary">Use my key</button>
        <button type="submit" value="house" class="ghost">House band</button>
        <button type="submit" value="cancel" class="ghost">Cancel</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form')!;
  const provider = form.elements.namedItem('provider') as HTMLSelectElement;
  const base = form.elements.namedItem('baseURL') as HTMLInputElement;
  const syncBase = () => {
    const p = PROVIDERS.find((x) => x.id === provider.value)!;
    (form.querySelector('.key-base') as HTMLElement).hidden = p.id !== 'custom';
    if (p.id !== 'custom') base.value = p.baseURL;
  };
  provider.addEventListener('change', syncBase);

  btn.addEventListener('click', () => {
    const p = current ? PROVIDERS.find((x) => x.baseURL === current!.baseURL) ?? PROVIDERS[2] : PROVIDERS[0];
    provider.value = p.id;
    base.value = current?.baseURL ?? p.baseURL;
    (form.elements.namedItem('apiKey') as HTMLInputElement).value = current?.apiKey ?? '';
    (form.elements.namedItem('model') as HTMLInputElement).value = current?.model ?? '';
    (form.elements.namedItem('effort') as HTMLSelectElement).value = current?.reasoningEffort ?? 'off';
    syncBase();
    dlg.showModal();
  });

  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'save') {
      const f = new FormData(form);
      const next: LlmSettings = {
        baseURL: String(f.get('baseURL') ?? '').trim(),
        apiKey: String(f.get('apiKey') ?? '').trim(),
        model: String(f.get('model') ?? '').trim(),
        reasoningEffort: String(f.get('effort') ?? 'off'),
      };
      current = next.baseURL && next.apiKey && next.model ? next : null;
    } else if (dlg.returnValue === 'house') current = null;
    else return;
    save(current);
    setLlmSettings(current);
    keyed = !!current;
    label();
  });
  // "Use my key" needs the fields filled; the other two buttons close without checking.
  for (const b of form.querySelectorAll<HTMLButtonElement>('button[value="house"],button[value="cancel"]')) b.formNoValidate = true;
}
