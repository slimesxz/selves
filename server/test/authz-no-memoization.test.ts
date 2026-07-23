import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';
import ts from 'typescript';

// P5-A — Static proof that the production authorization module holds NO
// cross-request memoization or decision cache (Gate 1 §2, invariant 2). Black-box
// freshness tests (authz-freshness) are necessary but not sufficient; this static
// scan covers the import graph itself. It walks src/authz/** and flags any
// module-scope mutable cache (new Map/Set/WeakMap held at top level, or a
// binding named like a cache/memo) and any identifier suggesting memoization.
//
// A per-request transaction is not a cache; the rule targets state that would
// survive a request and let a prior allow authorize a later one.

const here = dirname(fileURLToPath(import.meta.url));
const AUTHZ = resolve(here, '../src/authz');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const CACHELIKE = /(cache|memo)/i;
const MUTABLE_CTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

describe('P5-A no cross-request authorization memoization (static)', () => {
  const files = walk(AUTHZ);

  it('found the authz module', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no module-scope mutable cache and no cache/memo-named binding in the authz graph', () => {
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(AUTHZ, file);
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);

      // (a) top-level variable statements: no `new Map()/Set()/WeakMap()` and no
      //     cache/memo-named binding held at module scope.
      for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && CACHELIKE.test(decl.name.text)) {
            violations.push(`${rel}: module-scope binding named '${decl.name.text}'`);
          }
          const init = decl.initializer;
          if (
            init &&
            ts.isNewExpression(init) &&
            ts.isIdentifier(init.expression) &&
            MUTABLE_CTORS.has(init.expression.text)
          ) {
            violations.push(`${rel}: module-scope 'new ${init.expression.text}()'`);
          }
        }
      }

      // (b) anywhere in the module: an identifier that names a memoize helper.
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && /^(memoize|memoise)$/i.test(node.text)) {
          violations.push(`${rel}: references a memoize helper '${node.text}'`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(violations, `memoization violations:\n${violations.join('\n')}`).toEqual([]);
  });
});
