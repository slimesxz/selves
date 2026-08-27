// P10-BR3 — proposition C: Secure / `__Host-` cookie semantics in a real
// browser, in a real secure context.
//
// WHY A SEPARATE TOPOLOGY
// `__Host-` is meaningful only over a secure origin. Observing it over plain
// HTTP — even on localhost, where Chrome makes an exception — would be observing
// a weakened version of the rule. So this case runs against the test-only TLS
// terminator, in front of a SECOND production server process configured through
// the committed environment path with `SELVES_COOKIE_SECURE=true`. No production
// source changed; `server/src/config.ts` already chooses the `__Host-` name and
// the Secure attribute from that flag.
//
// THE COOKIE IS NOT CONSTRUCTED HERE
// Nothing below adds a cookie, names one, or sets an attribute. The browser is
// given a secret and a button; every property inspected afterwards was written
// by the production server's `Set-Cookie` and parsed by Chrome.
//
// WHAT IT DOES NOT CLAIM
// Reload persistence, CORS, and direct-URL behaviour are other propositions in
// other venues. This case observes the issued cookie and its replay inside the
// secure context, and nothing else.
import { expect, test } from '@playwright/test';
import { readFixture, SECURE_ORIGIN, SECURE_SESSION_COOKIE, SELF_NAME } from './apparatus.ts';

test('the production server issues a __Host- session cookie a real browser accepts over https', async ({
  page,
  context,
}) => {
  const fixture = readFixture();
  expect(await context.cookies(), 'the browser holds no cookie before the journey').toHaveLength(0);

  // ── Authenticate through the production UI, served over the secure origin. ─
  await page.goto(`${SECURE_ORIGIN}/`);
  const authenticate = page.getByRole('button', { name: 'Authenticate' });
  await expect(authenticate, 'the production authentication gate rendered').toBeVisible();
  await page.getByLabel('Secret').fill(fixture.secret);
  await authenticate.click();

  const selection = page.getByRole('navigation', { name: 'Selves' });
  await expect(selection, 'the authoritative Self list is presented').toBeVisible();

  // ── The cookie, as Chrome actually recorded it. ──────────────────────────
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SECURE_SESSION_COOKIE);
  expect(
    session,
    'the browser accepted a cookie under the __Host- name the secure configuration selects',
  ).toBeDefined();

  // Every `__Host-` requirement, asserted separately so a single wrong property
  // cannot hide behind the others.
  expect(session!.secure, '__Host- requires the Secure attribute').toBe(true);
  expect(session!.path, '__Host- requires Path=/').toBe('/');
  expect(session!.httpOnly, 'the session cookie is HttpOnly').toBe(true);
  // A `__Host-` cookie must be host-locked: no Domain attribute was sent, so
  // Chrome records the exact host rather than a dot-prefixed domain.
  expect(session!.domain, '__Host- forbids a Domain attribute — the cookie is host-locked').toBe(
    'localhost',
  );

  // ── Fencing. The non-secure venue's bare cookie name must NOT be present:
  //    without this, a server that ignored the flag and issued the ordinary
  //    cookie could pass a test that only looked for "some cookie". ──────────
  expect(
    cookies.map((c) => c.name),
    'the non-secure cookie name was not issued in the secure venue',
  ).not.toContain('selves_session');

  // ── The browser replays it: a Self-scoped authoritative read succeeds inside
  //    the secure context, which it could not do if the cookie were not being
  //    sent back. ─────────────────────────────────────────────────────────────
  await selection.getByRole('button', { name: SELF_NAME }).click();
  await expect(page.locator('main h1'), 'the active Self is presented').toHaveText(SELF_NAME);
  await expect(
    page.locator('main p'),
    'the authoritative count was read back under the replayed __Host- cookie',
  ).toHaveText(String(fixture.artifactCount));

  // ── And page script still cannot read it. ────────────────────────────────
  const documentCookie = await page.evaluate(() => document.cookie);
  expect(documentCookie, 'the __Host- session cookie is not exposed to page script').not.toContain(
    SECURE_SESSION_COOKIE,
  );
});
