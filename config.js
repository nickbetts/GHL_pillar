import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
try {
  const envPath = resolve(__dirname, '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env not found — rely on actual environment variables
}

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!TOKEN) throw new Error('GHL_TOKEN is not set. Add it to CRM/.env or export it in your shell.');
if (!LOCATION_ID) throw new Error('GHL_LOCATION_ID is not set. Add it to CRM/.env or export it in your shell.');

export { TOKEN, LOCATION_ID };
