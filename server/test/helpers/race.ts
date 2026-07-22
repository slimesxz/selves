import './env';
import pg from 'pg';

// Deterministic two-connection race harness — no timing sleeps. One operation is
// held mid-transaction (holding the stable public.accounts row lock); the racer
// then blocks on that lock. We wait for the racer to be OBSERVED waiting on a
// Lock (a definite condition, polled), then commit the holder and read the
// racer's outcome. This proves serialization rather than inferring it.

export async function connect(url: string | undefined): Promise<pg.Client> {
  if (!url) throw new Error('connection URL not set');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function waitForLockWait(probe: pg.Client, pid: number): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { rows } = await probe.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [pid],
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('racer never blocked on the account lock');
}

export interface RaceOutcome {
  holdRows: Record<string, unknown>[];
  racer: { ok?: Record<string, unknown>[]; errCode?: string };
}

/** Hold `holdSql` uncommitted (it takes the account lock), fire `raceSql` which
 *  blocks on it, wait until it is observed blocked, commit the holder, then
 *  return the holder's rows and the racer's committed outcome. */
export async function race(
  hold: { client: pg.Client; sql: string; params: unknown[] },
  racer: { client: pg.Client; sql: string; params: unknown[] },
  probe: pg.Client,
): Promise<RaceOutcome> {
  await hold.client.query('BEGIN');
  const held = await hold.client.query(hold.sql, hold.params);
  const pid = (await racer.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  const pending = racer.client
    .query(racer.sql, racer.params)
    .then((r) => ({ ok: r.rows as Record<string, unknown>[] }))
    .catch((e: { code?: string }) => ({ errCode: e.code ?? 'unknown' }));
  await waitForLockWait(probe, pid);
  await hold.client.query('COMMIT');
  const racerOutcome = await pending;
  return { holdRows: held.rows as Record<string, unknown>[], racer: racerOutcome };
}
