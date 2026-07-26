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
    log({ msg: 'pass failed', error: err instanceof Error ? err.message : String(err) });
  }
  await sleep(POLL_INTERVAL_MS);
}

log({ msg: 'worker stopping' });
await pool.end();
