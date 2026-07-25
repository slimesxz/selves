import './env';
import pg from 'pg';

// Deterministic two-connection race harness — no timing sleeps. One mutation is
// held mid-transaction (holding the stable placement row lock via SELECT ... FOR
// UPDATE); the racer then blocks on that lock. We wait for the racer to be
// OBSERVED waiting on a Lock (a definite condition, polled), then commit the
// holder and read the racer's outcome. This proves serialization rather than
// inferring it.
//
// P8 L: mutations derive the acting Self from C3 context, so each side FIRST opens
// its transaction and establishes context (set_acting_self) — on its own backend,
// against the acting_self_context row keyed by (backend_pid, xid) — before the
// single-argument mutation runs. Context establishment writes only the per-backend
// context row (no cross-connection contention), so the racer still blocks solely on
// the placement lock.

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
  throw new Error('racer never blocked on the placement lock');
}

export interface RaceSide {
  client: pg.Client;
  /** acting Self to establish as C3 context for this side's mutation. Omit for
   *  operations whose authority is not acting-Self (e.g. the auth.* races). */
  self?: string;
  /** session token hash authenticating `self`'s account (required with `self`). */
  token?: Buffer;
  /** the SQL under race — a single-argument domain mutation (acting Self from
   *  context) or a self-independent auth.* call. */
  sql: string;
  params: unknown[];
}

export interface RaceOutcome {
  holdRows: Record<string, unknown>[];
  racer: { ok?: Record<string, unknown>[]; errCode?: string };
}

/** Hold `hold`'s mutation uncommitted (it takes the placement lock), fire `racer`'s
 *  mutation which blocks on it, wait until it is observed blocked, commit the
 *  holder, then return the holder's rows and the racer's committed outcome. Each
 *  side establishes its own C3 context first. */
export async function race(hold: RaceSide, racer: RaceSide, probe: pg.Client): Promise<RaceOutcome> {
  const establish = async (side: RaceSide): Promise<void> => {
    if (side.self && side.token) {
      await side.client.query('SELECT domain.set_acting_self($1, $2)', [side.token, side.self]);
    }
  };

  await hold.client.query('BEGIN');
  await establish(hold);
  const held = await hold.client.query(hold.sql, hold.params);

  await racer.client.query('BEGIN');
  await establish(racer);
  const pid = (await racer.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  const pending = racer.client
    .query(racer.sql, racer.params)
    .then((r) => ({ ok: r.rows as Record<string, unknown>[] }))
    .catch((e: { code?: string }) => ({ errCode: e.code ?? 'unknown' }));

  await waitForLockWait(probe, pid);
  await hold.client.query('COMMIT');
  const racerOutcome = await pending;
  await racer.client.query('COMMIT').catch(() => {
    // the racer's transaction may be aborted (its mutation raised) — COMMIT then
    // rolls back; the committed state is the holder's, which the test asserts.
  });
  return { holdRows: held.rows as Record<string, unknown>[], racer: racerOutcome };
}
