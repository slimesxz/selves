// P10-S9 — the client HTTP boundary (0012 §35 authority split; R12 fetch law).
//
// Pure by constitutional requirement, not convenience (0012 §43; AGENTS §8):
// no React, no DOM, no module-level fetch. The caller supplies the transport,
// so request construction is provable without a browser and the ontology
// survives a re-skinning untouched.
//
// Every path is relative and /api-prefixed; the development proxy strips the
// prefix (client/vite.config.ts). There is no absolute base URL and no client
// environment variable for one. Requests are same-origin, so the session
// cookie travels by default and `credentials: 'include'` would be inert — it
// is deliberately not set.
//
// This module decides nothing. It constructs requests; the server remains the
// sole authority (0004 R2, 0008-C §4). No client-side authorization decision
// and no cache of one exists here or anywhere in the client.

export const API_PREFIX = '/api';

/** Injected so the boundary is provable without a browser. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Account-scoped: the session cookie is the sole caller authority input. */
export interface AccountRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

/** Self-scoped: additionally asserts an acting Self, re-verified server-side
 *  on every request (0004 R2). The id is an assertion, never authority. */
export interface SelfRequest extends AccountRequest {
  actingSelf: string;
}

export interface BuiltRequest {
  url: string;
  init: RequestInit;
}

function build(req: AccountRequest, actingSelf?: string): BuiltRequest {
  const headers: Record<string, string> = {};
  if (req.body !== undefined) headers['content-type'] = 'application/json';
  // The header exists on Self-scoped requests and on no others: account-scoped
  // construction is structurally incapable of carrying a Self.
  if (actingSelf !== undefined) headers['x-acting-self'] = actingSelf;
  return {
    url: `${API_PREFIX}${req.path}`,
    init: {
      method: req.method,
      headers,
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    },
  };
}

export const buildAccountRequest = (req: AccountRequest): BuiltRequest => build(req);
export const buildSelfRequest = (req: SelfRequest): BuiltRequest => build(req, req.actingSelf);

export const sendAccount = (transport: Transport, req: AccountRequest): Promise<Response> => {
  const { url, init } = buildAccountRequest(req);
  return transport(url, init);
};

export const sendSelf = (transport: Transport, req: SelfRequest): Promise<Response> => {
  const { url, init } = buildSelfRequest(req);
  return transport(url, init);
};
