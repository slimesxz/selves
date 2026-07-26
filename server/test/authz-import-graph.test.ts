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
//   * value-import of `pg`                    → only db.ts, operator/cli.ts,
//     worker/db.ts (the P9 chamber-authorized single-entry expansion, 0011 Q10)
//   * value-import of a raw pool binding      → only server.ts
//     (appPool / appTxPool from db.ts)
//   * value-import of an internal authz repo  → only authz/service.ts
//     (predicates.repo.ts / domain.repo.ts)
//   * ANY import of a test/ path from src/    → forbidden (no production→test dep)
//   * P9 (0011 Q10/C2): src/authz/** may not import src/worker/** EVEN
//     TYPE-ONLY; the worker tree may not value-import db.ts or any src/authz/**
//     module; worker/db.ts is value-importable only from the worker composition
//     root; and projection modules are scoped by ROLE not path — only the
//     worker tree may reference the proj schema surface, wherever modules live.

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
// directory-prefix exceptions). worker/db.ts is the single chamber-authorized
// P9 expansion of the pg lock (0011 Q10) — the worker is a separate principal
// with its own db module and its own credential, following operator/cli.ts.
// RAW_POOL_VALUE_ALLOW is UNCHANGED: the worker never imports the app pool.
const PG_VALUE_ALLOW = new Set([
  resolve(SRC, 'db.ts'),
  resolve(SRC, 'operator/cli.ts'),
  resolve(SRC, 'worker/db.ts'),
]);
const RAW_POOL_VALUE_ALLOW = new Set([resolve(SRC, 'server.ts')]);
const INTERNAL_REPO_VALUE_ALLOW = new Set([resolve(SRC, 'authz/service.ts')]);

// P9 (0011 Q10/C2) — worker/projection containment boundaries.
const WORKER_DIR = resolve(SRC, 'worker');
const AUTHZ_DIR = resolve(SRC, 'authz');
const WORKER_DB = resolve(SRC, 'worker/db.ts');
const WORKER_MAIN = resolve(SRC, 'worker/main.ts');

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
        // P9 (0011 Q10): authorization code cannot reach projection modules —
        // src/authz/** may not import src/worker/** EVEN TYPE-ONLY. This rule
        // therefore precedes the type-only exemption below.
        if (file.startsWith(`${AUTHZ_DIR}/`) && e.target && e.target.startsWith(`${WORKER_DIR}/`)) {
          violations.push(`${rel}: imports a worker/projection module ('${e.spec}')`);
          continue;
        }
        if (!e.isValue) continue; // type-only edges are erased — exempt

        // P9 (0011 Q10): the worker tree is credential-isolated — no module
        // under src/worker/ may value-import db.ts (the app-credential module)
        // or any src/authz/** module.
        if (file.startsWith(`${WORKER_DIR}/`) && e.target) {
          if (e.target === DB) {
            violations.push(`${rel}: worker module value-imports db.ts`);
          }
          if (e.target.startsWith(`${AUTHZ_DIR}/`)) {
            violations.push(`${rel}: worker module value-imports an authz module ('${e.spec}')`);
          }
        }
        // P9 (0011 Q10): worker/db.ts is value-importable only from the worker
        // composition root.
        if (e.target === WORKER_DB && file !== WORKER_MAIN) {
          violations.push(`${rel}: value-imports worker/db.ts (only worker/main.ts may)`);
        }

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

    // P9 (0011 Q10): the pg lock grew by EXACTLY the one chamber-authorized
    // entry (worker/db.ts). RAW_POOL_VALUE_ALLOW is unchanged at ['server.ts'].
    expect([...pgValueImporters].sort()).toEqual(['db.ts', 'operator/cli.ts', 'worker/db.ts']);
    expect([...rawPoolImporters].sort()).toEqual(['server.ts']);
  });

  it('P9 (0011 C2): projection modules are scoped by role, not path — only the worker tree references the proj schema', () => {
    // The negative lock covers projection modules WHEREVER THEY RESIDE, not
    // merely src/worker/ by path convention: a projection module is any
    // production module referencing the proj schema surface (`proj.`). Today
    // every projection module lives under src/worker/; if one is ever placed
    // outside it, this test fails and the lock must name that module
    // explicitly.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.startsWith(`${WORKER_DIR}/`)) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bproj\./.test(text)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('P9 (0011 Q10): the worker tree reads WORKER_DATABASE_URL and no other credential', () => {
    const dbText = readFileSync(WORKER_DB, 'utf8');
    expect(dbText).toMatch(/WORKER_DATABASE_URL/);
    for (const file of walk(WORKER_DIR)) {
      const text = readFileSync(file, 'utf8');
      // Any *_DATABASE_URL (or bare DATABASE_URL) other than WORKER_DATABASE_URL
      // is a foreign credential reference.
      const foreign = text.match(/[A-Z_]*DATABASE_URL/g)?.filter((m) => m !== 'WORKER_DATABASE_URL') ?? [];
      expect(foreign, `${relative(SRC, file)} references a non-worker credential`).toEqual([]);
    }
  });
});
