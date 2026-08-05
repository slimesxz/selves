// P10-V1 — React act environment.
//
// Established by the standard supported mechanism for the current React testing
// stack: React's own global flag, which React 19 reads to decide whether `act`
// is available and whether to warn about updates made outside it.
//
// No custom scheduler. No monkey patch. No warning suppression. No compatibility
// shim — React 19.2.8 exports `act` from `react` itself, so none is required.
//
// This runs for every client test file. Where nothing renders it is inert: the
// flag changes no behavior in the absence of a React root.

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
