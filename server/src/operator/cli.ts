// Operator CLI (no HTTP surface). Subcommands:
//   enroll  --account-ref <uuid> --name <name>   (selves_bootstrap; interactive)
//   rotate  --account <uuid> --expected-active <credential-id>  (selves_bootstrap; interactive)
//   recover --account <uuid>                      (selves_bootstrap; interactive)
//   contain --account <uuid>                       (selves_operator)
//
// enroll/rotate/recover display a one-time secret, so they run INTERACTIVELY
// ONLY and fail closed otherwise (no DB call, nothing persisted). The operator
// must supply a pre-recorded, nonsecret account reference to enroll so an
// ambiguous or display-failed enrollment can be recovered deterministically.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { containAccount, enrollAccount, recoverEnrollment, rotateCredential } from './commands.ts';

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

const [sub, ...rest] = process.argv.slice(2);
const dispatch: Record<string, (argv: string[]) => Promise<void>> = {
  enroll: cmdEnroll,
  rotate: cmdRotate,
  recover: cmdRecover,
  contain: cmdContain,
};
const handler = sub ? dispatch[sub] : undefined;
if (!handler) fail('usage: operator <enroll|rotate|recover|contain> [options]');
await handler(rest);
