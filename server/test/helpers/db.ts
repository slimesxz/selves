// The Vitest-facing database helper. Under P10-BR3 every capability that does
// not need Vitest moved to `db-fixtures.ts`, and is re-exported here unchanged,
// so the sixteen committed server test files importing from this module are
// untouched. What remains here is the one helper that genuinely asserts.
import './env';
import { expect } from 'vitest';

export {
  PG,
  testPool,
  resetTables,
  newAccount,
  newSelf,
  newTextArtifact,
  newDraftPlacement,
} from './db-fixtures.ts';

// Assert a query rejects with a specific Postgres SQLSTATE.
export async function expectPgError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect((err as { code?: string }).code, `expected SQLSTATE ${code}`).toBe(code);
    return;
  }
  throw new Error(`expected the query to be rejected with SQLSTATE ${code}, but it succeeded`);
}
