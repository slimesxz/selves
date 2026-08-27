// P10-BR3 — proposition D: the direct-URL observation ruled at 0012 §69.D.
//
// THE RULED OBJECT, quoted from the filed ruling:
//   "Direct URLs" means direct browser navigation/request to a protected backend
//   resource address without acquisition of authority through the client UI.
//   The missing proof is one browser navigation/request demonstrating that
//   ambient browser session state alone does not permit retrieval of protected
//   Self-scoped data without the required authoritative acting-Self context.
//
// WHY THIS IS NOT A ROUTER TEST
// The client has no router, no URL state, and no history state, and §51 §1.8
// forbids adding any. Nothing here asks the client for a route. The address
// navigated to is the BACKEND resource address, reached through the committed
// same-origin `/api` proxy — which is why the browser carries the session cookie
// to it by its own rules, with no cookie handling by test code.
//
// WHAT MAKES THE OBSERVATION MEAN SOMETHING
// The very same browser, the very same cookie, and the very same resource are
// observed twice in one journey:
//   through the app  — the client supplies the acting-Self context -> data
//   by direct address — no client, no acting-Self context           -> no data
// The only variable between them is whether authority was acquired through the
// client UI. Without that fence a protection response would be indistinguishable
// from a resource that simply never returns anything.
//
// The absence of `x-acting-self` is part of the object, so nothing here attaches
// it, and the production server alone decides the outcome.
import { expect, test } from '@playwright/test';
import { readFixture, SELF_NAME } from './apparatus.ts';

const PROTECTED_RESOURCE = '/api/artifacts';

test('ambient session state alone does not retrieve protected Self-scoped data', async ({
  page,
  context,
}) => {
  const fixture = readFixture();

  // ── Authenticate through the production UI, exactly as a person would. The
  //    cookie that results is the browser's, issued by the server. ───────────
  expect(await context.cookies(), 'the browser holds no cookie before the journey').toHaveLength(0);
  await page.goto('/');
  await page.getByLabel('Secret').fill(fixture.secret);
  await page.getByRole('button', { name: 'Authenticate' }).click();

  const selection = page.getByRole('navigation', { name: 'Selves' });
  await expect(selection, 'the authoritative Self list is presented').toBeVisible();
  await selection.getByRole('button', { name: SELF_NAME }).click();

  // ── FENCE. Through the client, with the acting-Self context the client
  //    supplies, this exact resource yields the authoritative datum. The count
  //    on the floor came from `GET /api/artifacts`; a protection response later
  //    therefore cannot be explained by an empty or unreachable resource. ────
  await expect(page.locator('main h1'), 'the active Self is presented').toHaveText(SELF_NAME);
  await expect(
    page.locator('main p'),
    'through the client the protected resource yields the authoritative count',
  ).toHaveText(String(fixture.artifactCount));

  const ambient = await context.cookies();
  expect(
    ambient.some((c) => c.value.length > 0),
    'the browser is carrying ambient session state into the next navigation',
  ).toBe(true);

  // ── THE DIRECT NAVIGATION. The address bar, not the application. Chrome
  //    sends the session cookie by its own rules and cannot send an
  //    `x-acting-self` header, which is precisely the condition under test. ──
  const direct = await page.goto(PROTECTED_RESOURCE, { waitUntil: 'load' });
  expect(direct, 'the direct navigation produced a response').not.toBeNull();

  const status = direct!.status();
  const body = await direct!.text();

  // The production server refused to act without an acting Self. The status is
  // whatever the production server chose; what matters constitutionally is that
  // it is not a success and that no protected data crossed.
  expect(
    status,
    'the direct navigation was not answered with protected Self-scoped data',
  ).toBeGreaterThanOrEqual(400);

  // Positive fencing on the body: the artifact ids the client legitimately read
  // are absent, and so is any artifact array. An error body is not enough on its
  // own — a wrong-shaped success could also be non-2xx-looking to a careless
  // reader, so the payload itself is inspected.
  expect(body, 'no artifact payload was returned to the direct navigation').not.toContain(
    '"id"',
  );
  expect(body, 'no artifact collection was returned to the direct navigation').not.toContain(
    'text_body',
  );

  // ── And the refusal was not the session dying: the ambient cookie is intact,
  //    so the reason data did not cross is the missing acting-Self authority,
  //    not a lost session. ───────────────────────────────────────────────────
  const afterDirect = await context.cookies();
  expect(
    afterDirect.length,
    'the session was still present during the refused navigation',
  ).toBe(ambient.length);
});
