// P10-BR2 — the real-browser refresh and cookie observation.
//
// One journey through an actual Google Chrome: the production client served by
// the committed Vite configuration, its `/api` requests carried by the
// committed proxy to the production Fastify server, against real PostgreSQL
// under RLS. Nothing is mocked, intercepted, injected, or replayed.
//
// WHAT THIS OBSERVES
//   1. authoritative state survives a genuine hard browser reload;
//   2. the browser itself stores and replays the production session cookie
//      across that reload;
//   3. page script cannot read that cookie.
//
// WHAT IT DOES NOT OBSERVE, AND DOES NOT CLAIM
//   SameSite, Secure, `__Host-`, Domain, or Path enforcement; CORS; direct-URL
//   navigation; any Class B proposition; any numbered binding. The committed
//   local configuration leaves `SELVES_COOKIE_SECURE` unset, so no `__Host-`
//   cookie exists to observe, and the topology is same-origin, so no
//   cross-origin occasion arises. None of that is asserted here.
//
// Fixture preparation happened in the apparatus, privileged and direct to the
// database. It is the world the browser walks into — never the evidence.
import { expect, test } from '@playwright/test';
import { readFixture, SELF_NAME, SESSION_COOKIE } from './apparatus.ts';

interface Seen {
  readonly phase: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
}

test('authoritative state and the session cookie survive a hard browser reload', async ({
  page,
  context,
}) => {
  const fixture = readFixture();
  const seen: Seen[] = [];
  let phase = 'first-load';
  // Passive observation of the real network. Nothing is fulfilled or altered:
  // this records what Chrome actually sent and what the server actually
  // answered.
  page.on('response', (res) => {
    seen.push({ phase, method: res.request().method(), url: res.url(), status: res.status() });
  });
  const inPhase = (p: string, method: string, ending: string): Seen[] =>
    seen.filter((s) => s.phase === p && s.method === method && s.url.endsWith(ending));

  // ── The browser starts with nothing. Any cookie observed later came from the
  //    production authentication response, not from test code. ───────────────
  expect(await context.cookies(), 'the browser holds no cookie before the journey').toHaveLength(0);

  // ── Load the production client and authenticate through its own UI. ───────
  await page.goto('/');
  const authenticate = page.getByRole('button', { name: 'Authenticate' });
  await expect(authenticate, 'the production authentication gate rendered').toBeVisible();

  await page.getByLabel('Secret').fill(fixture.secret);
  await authenticate.click();

  // The selection surface appears only after an authoritative Self list is
  // returned, which requires a session the server accepted. A failed
  // authentication leaves the gate standing.
  const selection = page.getByRole('navigation', { name: 'Selves' });
  await expect(selection, 'the authoritative Self list is presented').toBeVisible();
  const self = selection.getByRole('button', { name: SELF_NAME });
  await expect(self, 'the owned Self is offered').toBeVisible();
  expect(
    inPhase('first-load', 'POST', '/api/auth/session').map((s) => s.status),
    'the production login act was answered 204 by the server',
  ).toContain(204);

  // ── The browser received and stored the session cookie. ──────────────────
  const afterLogin = await context.cookies();
  const session = afterLogin.find((c) => c.name === SESSION_COOKIE);
  expect(session, 'the browser stored the production session cookie').toBeDefined();

  // ── Select the Self and observe the authoritative Self-scoped datum. ──────
  await self.click();
  const name = page.locator('main h1');
  const count = page.locator('main p');
  await expect(name, 'the active Self is presented').toHaveText(SELF_NAME);
  await expect(count, 'the authoritative artifact count is presented').toHaveText(
    String(fixture.artifactCount),
  );

  // ── Page script cannot read the session cookie. ──────────────────────────
  const documentCookie = await page.evaluate(() => document.cookie);
  expect(documentCookie, 'the session cookie is not exposed to page script').not.toContain(
    SESSION_COOKIE,
  );

  // ── A marker in the JavaScript context, so a genuine navigation is
  //    distinguishable from a React remount: a remount preserves the context
  //    and the marker; a real reload destroys both. ──────────────────────────
  await page.evaluate(() => {
    (globalThis as unknown as { __p10br2Context?: true }).__p10br2Context = true;
  });
  expect(
    await page.evaluate(() => (globalThis as unknown as { __p10br2Context?: true }).__p10br2Context),
    'the marker is present before reload',
  ).toBe(true);

  // ── THE HARD RELOAD ──────────────────────────────────────────────────────
  phase = 'reload';
  await page.reload({ waitUntil: 'load' });

  expect(
    await page.evaluate(() => (globalThis as unknown as { __p10br2Context?: true }).__p10br2Context),
    'the JavaScript context was destroyed — this was a navigation, not a remount',
  ).toBeUndefined();

  // ── The session survived, and was not re-established. ────────────────────
  await expect(
    page.getByRole('button', { name: 'Authenticate' }),
    'the authentication gate did not return',
  ).toHaveCount(0);
  expect(
    inPhase('reload', 'POST', '/api/auth/session'),
    'no re-authentication occurred after reload',
  ).toStrictEqual([]);

  // ── Authoritative state was fetched again and presented again. ───────────
  await expect(name, 'the active Self is presented after reload').toHaveText(SELF_NAME);
  await expect(count, 'the authoritative artifact count is presented after reload').toHaveText(
    String(fixture.artifactCount),
  );
  expect(
    inPhase('reload', 'GET', '/api/artifacts').map((s) => s.status),
    'the count was re-fetched from the server after reload, not recalled from memory',
  ).toContain(200);

  // ── The browser still holds the cookie it was given. ─────────────────────
  const afterReload = await context.cookies();
  expect(
    afterReload.find((c) => c.name === SESSION_COOKIE),
    'the browser still holds the session cookie after reload',
  ).toBeDefined();
});
