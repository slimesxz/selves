// Loads server/.env into process.env for the test process without adding a
// dotenv dependency. Imported for side effect by the db helper so every Vitest
// worker has TEST_DATABASE_URL regardless of how the runner spawned it.
// Externally-provided env (e.g. CI, Phase 13) takes precedence — we never
// overwrite a variable that is already set.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../.env'); // server/.env

try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? '';
    if (key !== undefined && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env is optional; env may be supplied by the environment instead.
}
