// Operator CLI (no HTTP surface). Subcommands:
//   enroll  --account-ref <uuid> --name <name>   (selves_bootstrap; interactive)
//   rotate  --account <uuid> --expected-active <credential-id>  (selves_bootstrap; interactive)
//   recover --account <uuid>                      (selves_bootstrap; interactive)
//   contain --account <uuid>                       (selves_operator)
//   outbox-depth                                   (selves_worker; read-only)
//
// enroll/rotate/recover display a one-time secret, so they run INTERACTIVELY
// ONLY and fail closed otherwise (no DB call, nothing persisted). The operator
// must supply a pre-recorded, nonsecret account reference to enroll so an
// ambiguous or display-failed enrollment can be recovered deterministically.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { addSelf, containAccount, enrollAccount, outboxDepth, recoverEnrollment, rotateCredential } from './commands.ts';
import type { OutboxDepthResult } from './commands.ts';

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function requireInteractive(): void {
  if (process.env.CI || !process.stdout.isTTY) {
    fail('refusing to run non-interactively: this command shows a one-time secret that must be captured from the terminal.');
  }
}

function pool(envVar: string): pg.Pool {
  const url = process.env[envVar];
  if (!url) fail(`${envVar} is not set`);
  return new pg.Pool({ connectionString: url });
}

function out(line: string): void {
  process.stdout.write(line + '\n');
}

// Show a one-time secret AFTER commit. If the terminal write fails, the secret
// is unrecoverable — surface the deterministic recovery path instead of pretending.
function showSecret(secret: string, recovery: string): void {
  try {
    out('\nSECRET (shown once — terminal scrollback is the only recoverable copy; store it now):');
    out(secret);
  } catch {
    process.stderr.write(`\nWARNING: commit succeeded but secret display failed; the secret is unrecoverable.\n${recovery}\n`);
    process.exitCode = 3;
  }
}

async function cmdEnroll(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { 'account-ref': { type: 'string' }, name: { type: 'string' } } });
  const accountRef = values['account-ref'];
  const name = values.name;
  if (!accountRef || !name) fail('usage: enroll --account-ref <uuid> --name <name>');
  requireInteractive();
  const db = pool('BOOTSTRAP_DATABASE_URL');
  try {
    const r = await enrollAccount(db, { accountRef, name });
    switch (r.status) {
      case 'committed':
        out(`account:    ${r.accountId}`);
        out(`self:       ${r.selfId}`);
        out(`credential: ${r.credentialId}`);
        showSecret(r.secret, `Recover with: operator recover --account ${accountRef}`);
        break;
      case 'db_failure':
        fail(`enrollment rejected (SQLSTATE ${r.sqlstate}); nothing was created.`);
        break;
      case 'ambiguous':
        fail(
          `enrollment outcome UNKNOWN (no acknowledgement). The secret was NOT shown.\n` +
          `Determine + recover with the recorded reference:\n` +
          `  operator recover --account ${r.accountRef}\n` +
          `  -> "recovered" means it committed (a fresh secret is issued); "not committed" means no account exists.`,
        );
        break;
    }
  } finally {
    await db.end();
  }
}

// P10-S5 (0012 §39): provision an additional Self at an operator-named slot on
// an EXISTING account. Slot is explicit — no lowest-free discovery — and range
// validity stays with the database (selves_slot_range), as does name presence.
async function cmdAddSelf(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { account: { type: 'string' }, slot: { type: 'string' }, name: { type: 'string' } },
  });
  const account = values.account;
  const slotText = values.slot;
  const name = values.name;
  if (!account || !slotText || !name) fail('usage: add-self --account <uuid> --slot <n> --name <name>');
  const slot = Number.parseInt(slotText, 10);
  if (!Number.isInteger(slot)) fail('usage: add-self --account <uuid> --slot <n> --name <name>');
  const db = pool('BOOTSTRAP_DATABASE_URL');
  try {
    const r = await addSelf(db, { account, slot, name });
    switch (r.status) {
      case 'added':
        out(`self: ${r.selfId}`);
        break;
      case 'not_found':
        fail(`no such account ${account}; nothing was created.`);
        break;
      case 'slot_occupied':
        fail(`slot ${slot} is already occupied on account ${account}; the existing Self was not modified.`);
        break;
      case 'error':
        fail(`add-self failed${r.sqlstate ? ` (SQLSTATE ${r.sqlstate})` : ''}; nothing was created.`);
        break;
    }
  } finally {
    await db.end();
  }
}

async function cmdRotate(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { account: { type: 'string' }, 'expected-active': { type: 'string' } } });
  const account = values.account;
  const expectedActiveId = values['expected-active'];
  if (!account || !expectedActiveId) fail('usage: rotate --account <uuid> --expected-active <credential-id>');
  requireInteractive();
  const db = pool('BOOTSTRAP_DATABASE_URL');
  try {
    const r = await rotateCredential(db, { account, expectedActiveId });
    switch (r.status) {
      case 'rotated':
        out(`credential: ${r.credentialId}`);
        showSecret(r.secret, `Re-run: operator rotate --account ${account} --expected-active ${r.credentialId}`);
        break;
      case 'stale':
        fail('rotation precondition failed: the active credential changed. Not retried automatically.');
        break;
      case 'not_found':
        fail('account not found.');
        break;
      case 'error':
        fail(`rotation failed${r.sqlstate ? ` (SQLSTATE ${r.sqlstate})` : ''}.`);
        break;
    }
  } finally {
    await db.end();
  }
}

async function cmdRecover(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { account: { type: 'string' } } });
  const account = values.account;
  if (!account) fail('usage: recover --account <uuid>');
  requireInteractive();
  const db = pool('BOOTSTRAP_DATABASE_URL');
  try {
    const r = await recoverEnrollment(db, { account });
    switch (r.status) {
      case 'recovered':
        out('enrollment DID commit; a fresh credential was issued.');
        out(`credential: ${r.credentialId}`);
        showSecret(r.secret, `Re-run: operator recover --account ${account}`);
        break;
      case 'not_committed':
        out('enrollment did NOT commit: no such account. Safe to re-enroll with the same reference.');
        break;
      case 'ineligible':
        fail('account is not in a recoverable state (it does not hold exactly one active credential).');
        break;
      case 'error':
        fail(`recovery failed${r.sqlstate ? ` (SQLSTATE ${r.sqlstate})` : ''}.`);
        break;
    }
  } finally {
    await db.end();
  }
}

async function cmdContain(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { account: { type: 'string' } } });
  const account = values.account;
  if (!account) fail('usage: contain --account <uuid>');
  const db = pool('OPERATOR_DATABASE_URL');
  try {
    const r = await containAccount(db, account);
    switch (r.status) {
      case 'contained':
        out(r.alreadyContained ? 'already contained (no change).' : 'account contained.');
        out(`credentials disabled: ${r.credentialsDisabled}`);
        out(`sessions revoked:     ${r.sessionsRevoked}`);
        break;
      case 'not_found':
        fail('account not found.'); // never reported as success
        break;
      case 'error':
        fail(`containment failed${r.sqlstate ? ` (SQLSTATE ${r.sqlstate})` : ''}.`);
        break;
    }
  } finally {
    await db.end();
  }
}

// P13-E — T4 operational visibility. Aggregate outbox condition only.
//
// It takes NO arguments, deliberately: with no option surface there is no
// parameter through which a query, function, or table name could be selected,
// so the worker credential's other capability (proj.process_outbox, which
// mutates) is unreachable from this command.
//
// Exit contract: 0 when the observation succeeded, whatever the numbers are;
// non-zero when the observation itself failed. A backlog is not a failure, and
// a failure is never rendered as an empty backlog. No threshold, no health
// label — this command reports condition, it does not judge it.
async function cmdOutboxDepth(argv: string[]): Promise<void> {
  if (argv.length > 0) fail('usage: outbox-depth');
  const db = pool('WORKER_DATABASE_URL');
  let r: OutboxDepthResult;
  try {
    r = await outboxDepth(db);
  } finally {
    // Ended before any exit path, so the connection closes deterministically
    // whether the observation succeeded or failed.
    await db.end();
  }
  if (r.status !== 'observed') {
    fail(`outbox-depth observation failed (${r.type}${r.sqlstate ? ' ' + r.sqlstate : ''}).`);
  }
  out(JSON.stringify({
    unclaimed: r.unclaimed,
    dead: r.dead,
    oldestUnclaimedAgeSeconds: r.oldestUnclaimedAgeSeconds,
  }));
}

const [sub, ...rest] = process.argv.slice(2);
const dispatch: Record<string, (argv: string[]) => Promise<void>> = {
  enroll: cmdEnroll,
  'add-self': cmdAddSelf,
  rotate: cmdRotate,
  recover: cmdRecover,
  contain: cmdContain,
  'outbox-depth': cmdOutboxDepth,
};
const handler = sub ? dispatch[sub] : undefined;
if (!handler) fail('usage: operator <enroll|add-self|rotate|recover|contain|outbox-depth> [options]');
await handler(rest);
