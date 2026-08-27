// P10-BR3 — the browser venue's origins and ports. ZERO imports, deliberately.
//
// The Playwright configuration needs `CLIENT_ORIGIN` before any test runs.
// Importing it from `apparatus.ts` made the configuration's module graph reach
// process orchestration and, through it, the Vitest-dependent server helper —
// the recorded P10-BR2 defect. A leaf module with no imports at all cannot
// reproduce that failure mode whatever the callers later grow into.
//
// THREE TOPOLOGY CLASSES, kept apart because the propositions are apart:
//
//   same-origin, non-secure   CLIENT_ORIGIN -> (Vite /api proxy) -> SERVER_ORIGIN
//   cross-origin, non-secure  ALT_CLIENT_ORIGIN -> SERVER_ORIGIN, direct
//   secure context            SECURE_ORIGIN -> (TLS terminator) -> SECURE_SERVER_ORIGIN
//
// The alternate client origin is the SAME Vite process reached under a
// different origin label. `client/package.json`'s dev script binds
// `--host=0.0.0.0`, so the dev server answers on the loopback IP as well as on
// `localhost`, and a browser treats the two as different origins. Only
// CLIENT_ORIGIN is in the server's committed CORS allowlist, so a page loaded
// from ALT_CLIENT_ORIGIN is genuinely foreign to the backend without any
// configuration being bent to make it so.

/** The committed Vite dev port. The browser loads the client here, and the
 *  committed proxy carries `/api` from this same origin to the server. */
export const CLIENT_ORIGIN = 'http://localhost:5173';

/** The same Vite process, different origin label — the disallowed origin. */
export const ALT_CLIENT_ORIGIN = 'http://127.0.0.1:5173';

/** The production server for the non-secure venue, reached directly by
 *  cross-origin fetches and through the Vite proxy by same-origin ones. */
export const SERVER_ORIGIN = 'http://127.0.0.1:8080';

/** The secure venue the browser sees: a test-only TLS terminator. */
export const SECURE_PORT = 8443;
export const SECURE_ORIGIN = `https://localhost:${SECURE_PORT}`;

/** A second production server process, configured through the committed
 *  environment path with `SELVES_COOKIE_SECURE=true`. Nothing reaches it except
 *  the terminator. */
export const SECURE_SERVER_PORT = 8081;
export const SECURE_SERVER_ORIGIN = `http://127.0.0.1:${SECURE_SERVER_PORT}`;

/** Session cookie names. The non-secure venue leaves `SELVES_COOKIE_SECURE`
 *  unset and the server emits the bare name; the secure venue sets it and the
 *  server emits the `__Host-` variant. Both names come from the committed
 *  `server/src/config.ts` and neither is constructed by test code. */
export const SESSION_COOKIE = 'selves_session';
export const SECURE_SESSION_COOKIE = '__Host-selves_session';

/** A distinctive name and a non-zero, non-default count: a blank or default
 *  render produces no floor at all, and neither value can arise by accident. */
export const SELF_NAME = 'Refresh-Subject';
export const SEEDED_ARTIFACTS = 5;
