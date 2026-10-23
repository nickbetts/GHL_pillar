/** Admin-editable Pitch Sites settings (app_config key "pitch_sites"). */
import { DEFAULT_HOUSE_PROMPT } from './pitch-ai.js';
import { DEFAULT_GATE } from './pitch-render.js';

const KEY = 'pitch_sites';
export const DEFAULT_PITCH_CONFIG = { housePrompt: DEFAULT_HOUSE_PROMPT, gate: { ...DEFAULT_GATE }, expiryDays: 14 };

const str = (v, d, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);

export function normalizePitchConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const g = r.gate && typeof r.gate === 'object' ? r.gate : {};
  const days = Number.parseInt(r.expiryDays, 10);
  return {
    housePrompt: str(r.housePrompt, DEFAULT_HOUSE_PROMPT, 8000),
    gate: Object.fromEntries(Object.entries(DEFAULT_GATE).map(([k, d]) => [k, str(g[k], d, k === 'sub' ? 300 : 120)])),
    expiryDays: Number.isFinite(days) && days >= 0 && days <= 365 ? days : 14,
  };
}

export async function loadPitchConfig(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const rows = await sql`SELECT value FROM app_config WHERE key = ${KEY} LIMIT 1`;
  let parsed = {};
  try { parsed = rows[0]?.value ? JSON.parse(rows[0].value) : {}; } catch { parsed = {}; }
  return normalizePitchConfig(parsed);
}

export async function savePitchConfig(sql, config) {
  const clean = normalizePitchConfig(config);
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(clean)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return clean;
}
