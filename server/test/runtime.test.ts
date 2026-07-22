import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P4-F — the approved Node 24.18.0 baseline is pinned and enforced by tooling.
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');

describe('P4-F Node runtime baseline', () => {
  it('server/package.json engines pins >=24.18.0 <25', () => {
    const pkg = JSON.parse(read('../package.json')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('>=24.18.0 <25');
  });

  it('server/.npmrc enforces engines at install', () => {
    expect(read('../.npmrc')).toMatch(/engine-strict\s*=\s*true/);
  });

  it('root .nvmrc pins 24.18.0', () => {
    expect(read('../../.nvmrc').trim()).toBe('24.18.0');
  });

  it('the test run is on the approved runtime', () => {
    const [maj, min] = process.version.replace(/^v/, '').split('.').map(Number);
    expect(maj).toBe(24);
    expect(min).toBeGreaterThanOrEqual(18);
  });
});
