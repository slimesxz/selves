// P10-CB1 — real-surface Class B apparatus. Support only: it declares ZERO
// test cases and asserts nothing.
//
// WHAT THIS IS
//
// The production Fastify app on a real listening socket, spoken to by real
// `fetch`, carrying requests that production client code constructed. No
// `app.inject`, no mocked fetch, no request adapter that bypasses HTTP, no
// direct handler invocation, no test-only authorization oracle. The bytes
// leave the process and come back.
//
// WHY A SHIM EXISTS AT ALL, AND EXACTLY WHAT IT DOES
//
// `client/src/api/transport.ts` emits relative, `/api`-prefixed, same-origin
// paths and takes the transport as a parameter — "Injected so the boundary is
// provable without a browser". In a browser three things then happen that are
// the USER AGENT's job, not the application's:
//
//   1. the relative path is resolved against the document origin;
//   2. the `/api` prefix is stripped by the same-origin proxy — in development
//      by `client/vite.config.ts`, whose committed rewrite this mirrors exactly:
//      `requestPath.replace(/^\/api/, '')`;
//   3. the session cookie is stored from `set-cookie` and replayed, and an
//      `origin` header is attached to non-GET requests.
//
// Node supplies none of the three, so this module supplies them — and ONLY
// them. That is user-agent emulation, not application substitution: no request
// is answered here, no status is invented, no authorization is decided, and
// every response observed is one the production server actually produced.
//
// WHAT THIS APPARATUS THEREFORE CANNOT REACH, BY CONSTRUCTION
//
//   - `App.tsx`'s own `browserTransport` supply. `browserTransport` is a
//     module-level constant inside `App.tsx` and `App` accepts no props, so
//     nothing can substitute an origin for it without editing production
//     source, replacing global `fetch`, or running a real browser. Every
//     binding whose object is "App supplies …" is out of reach here.
//   - Browser-agent semantics themselves: reload persistence, address-bar
//     navigation, cookie policy, `__Host-` attributes, CORS enforcement. Those
//     are precisely the three responsibilities emulated above, and emulating
//     them is why they remain the real-browser venue's object rather than this
//     one's.
//
// Fixtures control test data and process lifecycle. They never stand in for
// the application boundary, and they supply no expected value.
import './env';
import type { FastifyInstance } from 'fastify';
import type { Transport } from '../../../client/src/api/transport.ts';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { addSelf, bootstrapPool, enroll } from './auth.ts';
import { makeAuthz, type AuthzHarness } from './authz.ts';

const config = loadConfig();

/** The committed development rewrite, reproduced rather than reinvented:
 *  client/vite.config.ts strips the `/api` prefix before forwarding. */
const stripApiPrefix = (requestPath: string): string => requestPath.replace(/^\/api/, '');

export interface RealSurface {
  /** The production app, listening on a real loopback socket. */
  readonly app: FastifyInstance;
  /** Origin of that socket, e.g. `http://127.0.0.1:53311`. */
  readonly origin: string;
  /** A real-HTTP transport: production client code hands it a relative path,
   *  it performs the user-agent's three jobs, and `fetch` does the rest. */
  readonly transport: Transport;
  /** Discard the retained session, as closing a tab would. Nothing else in the
   *  apparatus holds authentication state. */
  readonly forgetSession: () => void;
  /** account A — author, plus a sibling Self in the same account */
  readonly secretA: string;
  readonly accountA: string;
  readonly selfA: string;
  readonly siblingA: string;
  /** account B — an unrelated account and Self */
  readonly secretB: string;
  readonly selfB: string;
  readonly end: () => Promise<void>;
}

export async function startRealSurface(): Promise<RealSurface> {
  const h: AuthzHarness = makeAuthz();
  const boot = bootstrapPool();
  const app = await buildApp({ db: h.appPool, config, service: h.service });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const addr = app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no TCP address bound');
  const origin = `http://127.0.0.1:${addr.port}`;

  // The user agent's cookie store. One session at a time, as one tab holds one.
  let session: string | undefined;

  const transport: Transport = async (url, init) => {
    const target = new URL(stripApiPrefix(url), origin);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (session !== undefined) headers.set('cookie', session);
    if (method !== 'GET') headers.set('origin', config.corsOrigins[0]!);

    const res = await fetch(target, { ...init, headers, redirect: 'manual' });

    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const pair = c.split(';', 1)[0]!;
      if (pair.startsWith(`${config.cookieName}=`)) session = pair;
    }
    return res;
  };

  const a = await enroll(boot);
  const siblingA = await addSelf(h.su, a.accountId, 2, 'cb1-sibling');
  const b = await enroll(boot);

  return {
    app,
    origin,
    transport,
    forgetSession: () => {
      session = undefined;
    },
    secretA: a.secret,
    accountA: a.accountId,
    selfA: a.selfId,
    siblingA,
    secretB: b.secret,
    selfB: b.selfId,
    async end() {
      await app.close();
      await boot.end();
      await h.end();
    },
  };
}
