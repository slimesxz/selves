// P10-BR3 — proposition B: browser CORS enforcement.
//
// WHICH OF THE THREE THINGS THIS OBSERVES
// The committed requirement at 0012 §62.E names "browser cookie/CORS/`__Host-`
// verification". The object is therefore BROWSER enforcement, and the three
// candidates are kept strictly apart:
//
//   HTTP response generation      the server produces an answer
//   server-side Origin rejection  the committed onRequest hook refuses a
//                                 state-changing request from a foreign origin
//   browser CORS enforcement      Chrome refuses to expose a response to page
//                                 script  <-- THIS IS THE OBJECT
//
// The probe is deliberately `GET /health`: an unauthenticated, simple request
// that the committed origin hook does not touch (it exempts GET, HEAD and
// OPTIONS) and that the production server answers 200 to identically whoever
// asks. Server behaviour is therefore CONSTANT across the two origins, and the
// only variable left is the browser's own check. A probe that the server itself
// refused would prove server-side rejection and say nothing about the browser.
//
// THE TWO ORIGINS
// Both pages are the same Vite process under different origin labels.
// `CLIENT_ORIGIN` is the committed CORS allowlist entry; `ALT_CLIENT_ORIGIN` is
// the loopback IP, which the allowlist does not contain. Nothing was added to or
// removed from the server's configuration to create the foreign origin.
import { expect, test } from '@playwright/test';
import { ALT_CLIENT_ORIGIN, CLIENT_ORIGIN, SERVER_ORIGIN } from './apparatus.ts';

const PROBE = '/health';
const PROTECTED = '/artifacts';

/** Ask the page to perform a genuine cross-origin fetch and report only whether
 *  page script could read the answer. The evaluation runs inside the browser, so
 *  the verdict is the browser's, not Node's. Nothing is intercepted or stubbed. */
async function attemptRead(
  page: import('@playwright/test').Page,
  url: string,
): Promise<{ readable: boolean; status: number | null }> {
  return page.evaluate(async (target) => {
    try {
      const res = await fetch(target, { credentials: 'include' });
      // Reaching here means the browser exposed the response to page script.
      return { readable: true, status: res.status };
    } catch {
      // A CORS failure surfaces in page script as a rejected fetch with no
      // response object at all — the browser withholds even the status.
      return { readable: false, status: null };
    }
  }, url);
}

test('the browser withholds cross-origin responses from a non-allowlisted origin', async ({
  page,
}) => {
  // ── ALLOWED ORIGIN. The committed allowlist contains this origin, so the
  //    server answers with the headers Chrome requires and page script may read
  //    the result. This is the positive half: without it, a later failure could
  //    mean the probe is simply broken. ──────────────────────────────────────
  await page.goto(`${CLIENT_ORIGIN}/`);
  const allowed = await attemptRead(page, `${SERVER_ORIGIN}${PROBE}`);
  expect(allowed.readable, 'from the allowlisted origin page script read the response').toBe(true);
  expect(allowed.status, 'the production server answered the health probe').toBe(200);

  // ── FOREIGN ORIGIN, IDENTICAL REQUEST. The server answers this exactly as it
  //    answered the last one — same route, same method, no authentication, and
  //    the committed origin hook exempts GET. Only the browser's check differs.
  await page.goto(`${ALT_CLIENT_ORIGIN}/`);
  const foreign = await attemptRead(page, `${SERVER_ORIGIN}${PROBE}`);
  expect(
    foreign.readable,
    'from the non-allowlisted origin the browser withheld the response from page script',
  ).toBe(false);
  expect(
    foreign.status,
    'the browser withheld even the status — page script learned nothing',
  ).toBeNull();

  // ── The same enforcement over a protected resource, so the proposition is
  //    observed where it matters and not only on an open health route. ───────
  const foreignProtected = await attemptRead(page, `${SERVER_ORIGIN}${PROTECTED}`);
  expect(
    foreignProtected.readable,
    'the protected resource was likewise withheld from the foreign origin',
  ).toBe(false);
});
