/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    // P10-V1 — the verification harness. jsdom is the ruled verification
    // environment. It is scoped to the mounted-experiment directory rather than
    // made global, because every one of the sixteen accepted client test files
    // was accepted running under `node`; switching them wholesale would change
    // the execution environment of accepted proofs as a side effect of building
    // a harness. The default therefore stays `node` and is stated explicitly.
    //
    // `setupFiles` establishes React's act environment for every file. The flag
    // is inert where nothing renders, so the pure files are unaffected by it.
    test: {
      environment: 'node',
      environmentMatchGlobs: [['test/mounted/**', 'jsdom']],
      setupFiles: ['./test/harness/act-environment.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // P10-S9 — same-origin development. The client speaks only relative /api
    // paths; this proxy strips the prefix and forwards to the server's own
    // committed default port (server/src/server.ts: PORT ?? 8080). It is
    // development infrastructure, not a client-visible base URL: there is no
    // absolute URL and no client environment variable for one.
    //
    // Same-origin means the session cookie travels by default, so no cookie
    // rewriting of any kind is configured and none is needed. The single
    // repository-level declaration of the client dev port is `port` below —
    // client/package.json's dev script deliberately passes no --port, because
    // a CLI flag would override this value.
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          rewrite: (requestPath: string) => requestPath.replace(/^\/api/, ''),
        },
      },
    },
  };
});
