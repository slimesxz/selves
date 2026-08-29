// P9-E — projection worker composition root (decision 0011 Q10, Q12).
//
// A polling loop over exactly the two functions on selves_worker's EXECUTE
// surface: proj.process_outbox(integer) and proj.outbox_depth(). Both return
// scalars only — no row, payload, recipient identity, Self id, or artifact
// content ever reaches this process (containment ruling). Logs are
// infrastructure telemetry only (closed classification, 0011 B.4): pass counts,
// queue depth, dead-letter count, lag age. Never event contents.
import { workerPool } from './db.ts';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
const BATCH_LIMIT = Number(process.env.WORKER_BATCH_LIMIT ?? 100);

function log(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
}

// P13-D (ruling E.5) — allowlisted error classification. A database or runtime
// error message can carry row values, DEFINER-function context, or internal
// SQL: a connection failure names the database, and a constraint failure's
// detail renders the offending row. None of that is operational telemetry, so
// the worker emits the classification only, on the same rule as the server's
// err serializer. Kept local rather than shared: there are exactly two call
// sites, on opposite sides of the credential boundary (0011 Q10), and a shared
// module would exist only to deduplicate four lines.
function errorClass(err: unknown): { type: string; code?: string } {
  const e = err as { constructor?: { name?: string }; name?: string; code?: unknown };
  const type = e?.constructor?.name ?? e?.name ?? 'Error';
  return typeof e?.code === 'string' ? { type, code: e.code } : { type };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const pool = workerPool();
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

log({ msg: 'worker started', pollIntervalMs: POLL_INTERVAL_MS, batchLimit: BATCH_LIMIT });

while (!stopping) {
  try {
    const pass = await pool.query<{ processed: string | number; failed: string | number }>(
      'SELECT processed, failed FROM proj.process_outbox($1)',
      [BATCH_LIMIT],
    );
    const processed = Number(pass.rows[0]?.processed ?? 0);
    const failed = Number(pass.rows[0]?.failed ?? 0);
    if (processed > 0 || failed > 0) {
      const depth = await pool.query<{
        unclaimed: string | number;
        dead: string | number;
        oldest_unclaimed_age: string | null;
      }>('SELECT unclaimed, dead, oldest_unclaimed_age::text AS oldest_unclaimed_age FROM proj.outbox_depth()');
      log({
        msg: 'pass',
        processed,
        failed,
        unclaimed: Number(depth.rows[0]?.unclaimed ?? 0),
        dead: Number(depth.rows[0]?.dead ?? 0),
        oldestUnclaimedAge: depth.rows[0]?.oldest_unclaimed_age ?? null,
      });
    }
  } catch (err) {
    log({ msg: 'pass failed', ...errorClass(err) });
  }
  await sleep(POLL_INTERVAL_MS);
}

log({ msg: 'worker stopping' });
await pool.end();
