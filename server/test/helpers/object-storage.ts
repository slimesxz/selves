// P12-D test apparatus for the object-storage boundary. Support only: it
// declares ZERO test cases and asserts nothing.
//
// WHY IT EXISTS. Phase 12 is Boundary Only. There is no binary-bearing Artifact,
// therefore no production ObjectBindingResolver and no production caller. The
// mandatory revocation proof nevertheless requires a real authorization subject,
// a real revocable ground, and an object bound to it. This module supplies the
// binding and the deterministic clock — and nothing else.
//
// STRUCTURAL DISTINGUISHABILITY (Gate 1 R7). Everything here lives under test/,
// is unreachable from src/ (the committed production→test import prohibition is
// enforced by authz-import-graph.test.ts), and is wired purely by DEPENDENCY
// INJECTION. No production logging, persistence, emission, or observability was
// added to make any of this observable. The recording decorators are
// pass-through and cannot change an authorization outcome.
//
// The bytes placed through this apparatus are NOT an Artifact payload. They are
// opaque test objects proving the storage boundary's issuance semantics, and no
// production route can reach them.
import { newObjectKey } from '../../src/storage/object-storage.ts';
import type { Clock, ObjectKey, ObjectStorage } from '../../src/storage/object-storage.ts';
import type { ObjectBindingResolver } from '../../src/storage/object-access.ts';
import type { AuthorizationService } from '../../src/authz/service.ts';

// ── deterministic time ───────────────────────────────────────────────────────
// Every lifetime bound in the boundary is evaluated against an injected Clock,
// so expiry is proven by ADVANCING time, never by sleeping (the security corpus
// forbids sleeps, arbitrary delays, and probabilistic success as proof).

export interface ManualClock {
  /** The Clock to inject into the port and the issuer. */
  readonly clock: Clock;
  nowMs(): number;
  advanceSeconds(seconds: number): void;
  advanceMs(ms: number): void;
}

/** A clock frozen at a fixed instant, moved only by explicit advance calls. */
export function manualClock(startMs: number = Date.UTC(2026, 0, 1, 0, 0, 0)): ManualClock {
  let ms = startMs;
  return {
    clock: () => new Date(ms),
    nowMs: () => ms,
    advanceSeconds(seconds) {
      ms += seconds * 1000;
    },
    advanceMs(delta) {
      ms += delta;
    },
  };
}

// ── call ordering ────────────────────────────────────────────────────────────
// The issuance order is itself a ratified security property: a principal who
// fails the authoritative PostgreSQL decision must cause no binding lookup. The
// ledger records the order in which the collaborators were entered.

export interface CallLedger {
  readonly events: string[];
}

export function makeCallLedger(): CallLedger {
  return { events: [] };
}

/** Pass-through decorator recording entry into readArtifact. Every other
 *  operation is forwarded untouched; no outcome can change. */
export function recordingAuthorization(
  real: AuthorizationService,
  ledger: CallLedger,
): AuthorizationService {
  return {
    ...real,
    readArtifact(ctx, artifactId) {
      ledger.events.push('readArtifact');
      return real.readArtifact(ctx, artifactId);
    },
  };
}

// ── the test-only binding ────────────────────────────────────────────────────

export interface TestBindingResolver extends ObjectBindingResolver {
  /** Associate an opaque object with an Artifact, for this test only. */
  bind(artifactId: string, key: ObjectKey): void;
  /** How many times the resolver was consulted. */
  lookupCount(): number;
}

/** The only ObjectBindingResolver implementation that exists in Phase 12.
 *  Production ships none: there is no authoritative association to resolve. */
export function testBindingResolver(ledger?: CallLedger): TestBindingResolver {
  const bindings = new Map<string, ObjectKey>();
  let lookups = 0;
  return {
    bind(artifactId, key) {
      bindings.set(artifactId, key);
    },
    lookupCount: () => lookups,
    objectFor(artifactId) {
      lookups += 1;
      ledger?.events.push('objectFor');
      return Promise.resolve(bindings.get(artifactId) ?? null);
    },
  };
}

/** Place opaque bytes into the byte plane through the ratified port and return
 *  their key. Uses an ordinary bounded upload authorization — the only way to
 *  write bytes — and creates no authoritative fact of any kind. */
export async function placeTestObject(
  storage: ObjectStorage,
  clock: Clock,
  bytes: Uint8Array,
): Promise<ObjectKey> {
  const key = newObjectKey();
  const upload = await storage.authorizeUpload(key, new Date(clock().getTime() + 60_000));
  await storage.put(upload, bytes);
  return key;
}

/** Resolve the ObjectStorageFailure reason of a rejected port call, or a
 *  distinguishable marker. Tolerates a synchronous throw as well as a rejected
 *  promise, so the assertion never depends on which of the two occurs. */
export async function failureReason(op: () => unknown): Promise<string> {
  try {
    await op();
    return 'NO-THROW';
  } catch (err) {
    const reason = (err as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : `UNEXPECTED:${String(err)}`;
  }
}
