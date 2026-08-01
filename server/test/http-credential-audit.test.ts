// P10-S7 — the HTTP-layer credential audit (0012 §42; the forward obligation
// opened at P10-R12, §38). A STATIC SOURCE audit of exactly two files:
//
//     server/src/app.ts
//     server/src/routes/domain.ts
//
// It is not a runtime test and asserts no sampled behavior; runtime credential
// behavior is already covered by auth-api, active-self, mutations-http, and the
// P10-S4 parity/matrix suites. The committed gap this closes is a SOURCE-audit
// gap: before P10-S7 no committed test read either file as text.
//
// CLOSED-SET EXPRESSION (0012 §42): each of the sixteen credential-handling
// sites is enumerated by its EXACT source content, AND every credential
// expression class carries an exhaustive occurrence count. Content alone would
// miss an ADDITION (a new site beside the enumerated ones); counts alone would
// miss a SUBSTITUTION (one credential expression swapped for another preserves
// the count). Both forms are required, so both failure modes are caught.
//
// This file owns nothing but itself. crypto.ts and auth/queries.ts are outside
// the ratified scope and are neither read nor asserted.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');

const APP_PATH = 'app.ts';
const ROUTES_PATH = 'routes/domain.ts';
const APP = read(APP_PATH);
const ROUTES = read(ROUTES_PATH);

/** The audited surface is exactly these two files (0012 §42). */
const AUDITED = [APP_PATH, ROUTES_PATH] as const;

const occurrences = (src: string, needle: string): number => src.split(needle).length - 1;

/** Lines of `src` containing `needle`, for line-scoped behavior assertions. */
const linesWith = (src: string, needle: string): string[] =>
  src.split('\n').filter((l) => l.includes(needle));

// ── the sixteen enumerated sites ────────────────────────────────────────────
// Thirteen in app.ts, three in routes/domain.ts. Each fragment is exact source
// text; a substituted expression fails its own labelled assertion.

interface Site {
  readonly site: string;
  readonly fragments: readonly string[];
}

const APP_SITES: readonly Site[] = [
  {
    site: 'S1 log redaction — three paths and censor',
    fragments: [
      "'req.headers.cookie',",
      '\'req.headers["x-acting-self"]\',',
      '\'res.headers["set-cookie"]\',',
      "censor: '[redacted]',",
    ],
  },
  {
    site: 'S2 cookie issuance options',
    fragments: [
      'function sessionCookieOptions(config: AppConfig) {',
      'httpOnly: true,',
      'secure: config.cookieSecure,',
      "sameSite: 'strict' as const,",
      "path: '/',",
      'maxAge: config.sessionTtlSeconds,',
    ],
  },
  {
    site: 'S3 cookie clearing options',
    fragments: [
      'function clearCookieOptions(config: AppConfig) {',
      "return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const, path: '/' };",
    ],
  },
  {
    site: 'S4 raw cookie read — authenticate',
    fragments: ['const token = req.cookies[config.cookieName];\n    if (!token) {'],
  },
  {
    site: 'S5 boundary hash — authenticateSession',
    fragments: ['const account = await authenticateSession(db, sha256(token));'],
  },
  {
    site: 'S6 acting-Self header read',
    fragments: ["const raw = req.headers['x-acting-self'];"],
  },
  {
    site: 'S7 raw cookie read — verifyActingSelf',
    fragments: ['const token = req.cookies[config.cookieName];\n    if (!req.account || !token) {'],
  },
  {
    site: 'S8 boundary hash — selfOwnedByAccount',
    fragments: ['const owned = await selfOwnedByAccount(db, raw, sha256(token));'],
  },
  {
    site: 'S9 verified acting-Self context write',
    fragments: ['req.actingSelf = raw;'],
  },
  {
    site: 'S10 raw cookie read and boundary hash — listSelves',
    fragments: ['return listSelves(db, sha256(req.cookies[config.cookieName] as string));'],
  },
  {
    site: 'S11 login secret and session-token mint',
    fragments: [
      'const body = req.body as { secret?: unknown } | undefined;',
      'const secret = body?.secret;',
      'const token = newSessionToken();',
      'const sessionId = await issueSession(db, sha256(secret), sha256(token));',
    ],
  },
  {
    site: 'S12 cookie issuance',
    fragments: ['reply.setCookie(config.cookieName, token, sessionCookieOptions(config));'],
  },
  {
    site: 'S13 logout — raw cookie read, boundary hash, cookie clearing',
    fragments: [
      'const token = req.cookies[config.cookieName];\n    if (token) {',
      'await revokeSession(db, sha256(token));',
      'reply.clearCookie(config.cookieName, clearCookieOptions(config));',
    ],
  },
];

const ROUTES_SITES: readonly Site[] = [
  {
    site: 'D1 ActingContext construction',
    fragments: [
      'const actor = (req: FastifyRequest): ActingContext => ({',
      'actingSelf: req.actingSelf as SelfId,',
      'sessionToken: sha256(req.cookies[config.cookieName] as string),',
    ],
  },
  {
    site: 'D2 AccountContext construction',
    fragments: [
      'const account = (req: FastifyRequest): AccountContext => ({',
      'sessionToken: sha256(req.cookies[config.cookieName] as string),',
    ],
  },
  {
    site: 'D3 hash import',
    fragments: ["import { sha256 } from '../crypto.ts';"],
  },
];

// Exhaustive class-level multiplicities. A NEW site of any known class fails
// here even when every enumerated fragment still matches.
const APP_CLASS_COUNTS: ReadonlyArray<readonly [string, number]> = [
  ['req.cookies[config.cookieName]', 4],
  ['sha256(', 6],
  ['reply.setCookie(', 1],
  ['reply.clearCookie(', 1],
  ['newSessionToken()', 1],
  ['req.actingSelf', 1],
  ["req.headers['x-acting-self']", 1],
  ['const token = req.cookies[config.cookieName];', 3],
];

const ROUTES_CLASS_COUNTS: ReadonlyArray<readonly [string, number]> = [
  ['req.cookies[config.cookieName]', 2],
  ['sha256(', 2],
  ['req.actingSelf', 1],
  ['sessionToken:', 2],
];

/** Identifiers that must never reach a response, a log, or a URL. */
const CREDENTIAL_WORDS = ['token', 'secret', 'sha256', 'cookie'] as const;
const mentionsCredential = (line: string): boolean =>
  CREDENTIAL_WORDS.some((w) => line.toLowerCase().includes(w));

describe('P10-S7 HTTP-layer credential audit (0012 §42)', () => {
  it('app.ts credential-site enumeration is closed: thirteen sites at exact source form, with exhaustive class counts', () => {
    expect(APP_SITES).toHaveLength(13);
    for (const { site, fragments } of APP_SITES) {
      for (const f of fragments) {
        expect(APP.includes(f), `${site}: missing or substituted — ${JSON.stringify(f)}`).toBe(true);
      }
    }
    // Addition guard: any further credential expression of a known class fails.
    for (const [expr, n] of APP_CLASS_COUNTS) {
      expect(occurrences(APP, expr), `app.ts occurrences of ${JSON.stringify(expr)}`).toBe(n);
    }
  });

  it('routes/domain.ts credential-site enumeration is closed: three sites at exact source form, with exhaustive class counts', () => {
    expect(ROUTES_SITES).toHaveLength(3);
    for (const { site, fragments } of ROUTES_SITES) {
      for (const f of fragments) {
        expect(ROUTES.includes(f), `${site}: missing or substituted — ${JSON.stringify(f)}`).toBe(true);
      }
    }
    for (const [expr, n] of ROUTES_CLASS_COUNTS) {
      expect(occurrences(ROUTES, expr), `routes/domain.ts occurrences of ${JSON.stringify(expr)}`).toBe(n);
    }
  });

  it('neither owned source contains SQL, so no credential can be interpolated into a query', () => {
    // The HTTP layer never speaks SQL: every statement lives behind the repo /
    // DEFINER boundary. With no query site there is no interpolation site.
    for (const [name, src] of [[APP_PATH, APP], [ROUTES_PATH, ROUTES]] as const) {
      for (const sql of ['.query(', 'SELECT ', 'INSERT ', 'UPDATE ', 'DELETE FROM', 'pg.Pool']) {
        expect(occurrences(src, sql), `${name} must contain no ${JSON.stringify(sql)}`).toBe(0);
      }
    }
  });

  it('no raw token, secret, or hash reaches a response body, URL, path, or query', () => {
    for (const [name, src] of [[APP_PATH, APP], [ROUTES_PATH, ROUTES]] as const) {
      const sends = linesWith(src, '.send(');
      expect(sends.length, `${name} response sites`).toBeGreaterThan(0);
      for (const line of sends) {
        expect(mentionsCredential(line), `${name} response carries credential material: ${line.trim()}`).toBe(false);
      }
      // The URL/path/query category is proven EMPTY rather than sampled: with
      // no URL literal, no template literal, and no redirect anywhere in the
      // credential-handling layer, there is no site a credential could reach.
      for (const construct of ['://', '`', '${', 'redirect(']) {
        expect(
          occurrences(src, construct),
          `${name} constructs a URL, template, or redirect (${JSON.stringify(construct)}) — a credential could reach it`,
        ).toBe(0);
      }
    }
  });

  it('credential material is logged only under redaction: the three redact paths are pinned and no logging call carries a credential', () => {
    expect(APP).toContain('const DEFAULT_REDACT = {');
    for (const path of ['req.headers.cookie', 'req.headers["x-acting-self"]', 'res.headers["set-cookie"]']) {
      expect(APP.includes(`'${path}',`), `redact path ${path} must be pinned`).toBe(true);
    }
    expect(APP).toContain("censor: '[redacted]',");
    expect(APP).toContain('redact: DEFAULT_REDACT,');
    for (const [name, src] of [[APP_PATH, APP], [ROUTES_PATH, ROUTES]] as const) {
      expect(occurrences(src, 'console.'), `${name} must not use console`).toBe(0);
      for (const line of src.split('\n')) {
        if (!/\blog\.(info|error|warn|debug|trace|fatal)\(/.test(line)) continue;
        expect(mentionsCredential(line), `${name} logs credential material: ${line.trim()}`).toBe(false);
      }
    }
  });

  it('hashing occurs at the HTTP boundary: every credential-consuming collaborator call is hash-wrapped', () => {
    // Raw cookie material never travels inward — each collaborator receives a
    // digest computed here, at the edge.
    for (const call of [
      'authenticateSession(',
      'selfOwnedByAccount(',
      'issueSession(',
      'revokeSession(',
      'listSelves(',
    ]) {
      const sites = linesWith(APP, call).filter((l) => !l.trimStart().startsWith('//') && !l.includes('import'));
      expect(sites.length, `app.ts must call ${call}`).toBeGreaterThan(0);
      for (const line of sites) {
        expect(line.includes('sha256('), `${call} receives unhashed credential material: ${line.trim()}`).toBe(true);
      }
    }
    // Both request-context factories hash before the credential leaves the route layer.
    for (const line of linesWith(ROUTES, 'sessionToken:')) {
      expect(line.includes('sha256('), `routes/domain.ts context carries a raw token: ${line.trim()}`).toBe(true);
    }
    // No unhashed cookie value is ever handed to a collaborator.
    expect(occurrences(APP, '(db, token')).toBe(0);
    expect(occurrences(APP, 'sessionToken: req.cookies')).toBe(0);
    expect(occurrences(ROUTES, 'sessionToken: req.cookies')).toBe(0);
  });

  it('AccountContext construction is structurally Self-free', () => {
    const open = 'const account = (req: FastifyRequest): AccountContext => ({';
    const start = ROUTES.indexOf(open);
    expect(start, 'the AccountContext factory must exist').toBeGreaterThan(-1);
    const body = ROUTES.slice(start, ROUTES.indexOf('});', start) + 3);
    expect(body).toContain('sessionToken: sha256(req.cookies[config.cookieName] as string),');
    expect(
      /actingSelf|selfId|self_id|SelfId|x-acting-self/i.test(body),
      `the AccountContext factory names a Self: ${body}`,
    ).toBe(false);
    // The two account-scoped routes construct AccountContext, never ActingContext.
    expect(occurrences(ROUTES, 'account(req)')).toBe(2);
    for (const route of ["app.get('/account/departure-interval', accountScoped,", "app.put('/account/departure-interval', accountScoped,"]) {
      expect(ROUTES).toContain(route);
    }
    expect(occurrences(ROUTES, "'/account/departure-interval', selfScoped")).toBe(0);
  });

  it('the audited surface totals exactly sixteen credential-handling sites across exactly the two ratified files', () => {
    expect(AUDITED).toEqual(['app.ts', 'routes/domain.ts']);
    expect(APP_SITES.length + ROUTES_SITES.length).toBe(16);
    // Every site label is distinct, so no row silently duplicates another.
    const labels = [...APP_SITES, ...ROUTES_SITES].map((s) => s.site);
    expect(new Set(labels).size).toBe(16);
  });
});
