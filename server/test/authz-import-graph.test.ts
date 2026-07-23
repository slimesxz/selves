import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';
import ts from 'typescript';

// P5-A — Mechanical bypass containment (Gate 1 §11, addendum §6), proven with
// the already-installed TypeScript compiler API (no new dependency, no regex).
//
// It parses EVERY production TypeScript source file under src/ (not only those
// reachable from server.ts — an orphaned module must not slip through) and
// inspects static imports, re-exports, statically-resolvable dynamic import()
// calls, and require() calls. TYPE-ONLY imports are erased at runtime and are
// exempt from the value-access rules (this is what keeps the Phase-4 DI modules,
// which import `type { Queryable }` from db.ts, legal). The forbidden edges:
//
//   * value-import of `pg`                    → only db.ts, operator/cli.ts
//   * value-import of a raw pool binding      → only server.ts
//     (appPool / appTxPool from db.ts)
//   * value-import of an internal authz repo  → only authz/service.ts
//     (predicates.repo.ts / domain.repo.ts)
//   * ANY import of a test/ path from src/    → forbidden (no production→test dep)

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');

const DB = resolve(SRC, 'db.ts');
const RAW_POOL_BINDINGS = new Set(['appPool', 'appTxPool']);
const INTERNAL_REPOS = new Set([
  resolve(SRC, 'authz/predicates.repo.ts'),
  resolve(SRC, 'authz/domain.repo.ts'),
  resolve(SRC, 'authz/mutations.repo.ts'),
]);

// EXACT file-specific allowlists (repository state at implementation; no
// directory-prefix exceptions).
const PG_VALUE_ALLOW = new Set([resolve(SRC, 'db.ts'), resolve(SRC, 'operator/cli.ts')]);
const RAW_POOL_VALUE_ALLOW = new Set([resolve(SRC, 'server.ts')]);
const INTERNAL_REPO_VALUE_ALLOW = new Set([resolve(SRC, 'authz/service.ts')]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// Resolve a relative specifier (with an explicit .ts extension, as this repo
// uses) to an absolute path. Bare specifiers (e.g. 'pg', 'node:util') return null.
function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return resolve(dirname(fromFile), spec);
}

interface Edge {
  readonly spec: string;
  readonly target: string | null; // resolved abs path for relative specs
  readonly valueBindings: readonly string[]; // named/default/namespace value bindings ('*' = namespace/default)
  readonly isValue: boolean; // any runtime (non-type-only) dependency
}

function collectEdges(file: string, sf: ts.SourceFile): Edge[] {
  const edges: Edge[] = [];

  const pushImport = (spec: string, clause: ts.ImportClause | undefined) => {
    const target = resolveRelative(file, spec);
    if (!clause) {
      // side-effect import: a runtime dependency with no bindings
      edges.push({ spec, target, valueBindings: [], isValue: true });
      return;
    }
    if (clause.isTypeOnly) {
      edges.push({ spec, target, valueBindings: [], isValue: false });
      return;
    }
    const valueBindings: string[] = [];
    if (clause.name) valueBindings.push('*'); // default import (value)
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) valueBindings.push('*');
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (!el.isTypeOnly) valueBindings.push(el.name.text);
      }
    }
    edges.push({ spec, target, valueBindings, isValue: valueBindings.length > 0 });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      pushImport(node.moduleSpecifier.text, node.importClause);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // re-export: `export ... from '...'`. isTypeOnly on the whole or per element.
      const spec = node.moduleSpecifier.text;
      const target = resolveRelative(file, spec);
      let isValue = !node.isTypeOnly;
      const bindings: string[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        isValue = false;
        for (const el of node.exportClause.elements) {
          if (!el.isTypeOnly && !node.isTypeOnly) {
            isValue = true;
            bindings.push(el.name.text);
          }
        }
      } else if (!node.exportClause) {
        // `export * from '...'` — a runtime re-export
        isValue = !node.isTypeOnly;
        if (isValue) bindings.push('*');
      }
      edges.push({ spec, target, valueBindings: bindings, isValue });
    } else if (ts.isCallExpression(node)) {
      // dynamic import('lit') and require('lit') — runtime value dependencies
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynImport || isRequire) && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          edges.push({
            spec: arg.text,
            target: resolveRelative(file, arg.text),
            valueBindings: ['*'],
            isValue: true,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edges;
}

describe('P5-A mechanical bypass containment (TypeScript AST import graph)', () => {
  const files = walk(SRC);

  it('parses at least the known production modules', () => {
    // guardrail: the walk actually found the tree (not an empty pass)
    expect(files).toContain(resolve(SRC, 'server.ts'));
    expect(files).toContain(resolve(SRC, 'authz/service.ts'));
    expect(files.length).toBeGreaterThan(10);
  });

  it('no production module imports pg, the raw pool, an internal authz repo, or test/ outside the exact allowlists', () => {
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file);
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.ES2022,
        true,
      );
      for (const e of collectEdges(file, sf)) {
        // 1. never depend on test/ from production (any kind of import)
        if (e.target && e.target.includes(`${resolve(SRC, '..')}/test/`)) {
          violations.push(`${rel}: imports a test/ path ('${e.spec}')`);
          continue;
        }
        if (e.spec.startsWith('test/') || e.spec.includes('/test/')) {
          violations.push(`${rel}: imports a test/ path ('${e.spec}')`);
          continue;
        }
        if (!e.isValue) continue; // type-only edges are erased — exempt

        // 2. value-import of pg
        if (e.spec === 'pg' && !PG_VALUE_ALLOW.has(file)) {
          violations.push(`${rel}: value-imports 'pg' (not on the pg allowlist)`);
        }
        // 3. value-import of a raw pool binding from db.ts
        if (e.target === DB) {
          const importsRawPool =
            e.valueBindings.includes('*') ||
            e.valueBindings.some((b) => RAW_POOL_BINDINGS.has(b));
          if (importsRawPool && !RAW_POOL_VALUE_ALLOW.has(file)) {
            violations.push(
              `${rel}: value-imports a raw pool binding from db.ts (${e.valueBindings.join(', ')})`,
            );
          }
        }
        // 4. value-import of an internal authz repo
        if (e.target && INTERNAL_REPOS.has(e.target) && !INTERNAL_REPO_VALUE_ALLOW.has(file)) {
          violations.push(`${rel}: value-imports an internal authz repo ('${e.spec}')`);
        }
      }
    }

    expect(violations, `bypass containment violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('confirms the current Phase-4 db-access allowlist is exactly as ratified', () => {
    // Positive lock: exactly these production files hold a runtime db-access edge,
    // so a future addition is caught by this assertion, not silently tolerated.
    const pgValueImporters = new Set<string>();
    const rawPoolImporters = new Set<string>();

    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
      for (const e of collectEdges(file, sf)) {
        if (!e.isValue) continue;
        if (e.spec === 'pg') pgValueImporters.add(relative(SRC, file));
        if (
          e.target === DB &&
          (e.valueBindings.includes('*') || e.valueBindings.some((b) => RAW_POOL_BINDINGS.has(b)))
        ) {
          rawPoolImporters.add(relative(SRC, file));
        }
      }
    }

    expect([...pgValueImporters].sort()).toEqual(['db.ts', 'operator/cli.ts']);
    expect([...rawPoolImporters].sort()).toEqual(['server.ts']);
  });
});
