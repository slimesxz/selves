import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

// P12-D — STATIC containment evidence for the object-storage boundary, using the
// already-installed TypeScript compiler API (no new dependency).
//
// EVIDENCE CLASS: STATIC throughout. Every assertion below is a property of the
// COMMITTED SOURCE, never of a running adversarial system. A static absence is
// not a runtime guarantee, and this file claims none. Where a check is a text
// scan rather than an AST fact, it says so and states its exact scope.
//
// Two scanning modes are used deliberately:
//   * AST scans (identifiers, string literals, declarations) EXCLUDE comments.
//     They are the right instrument for "does the CODE name this concept?" —
//     a header comment that names a vendor in order to DENY it is not leakage.
//   * Text scans INCLUDE comments. They are used only where the chamber's
//     obligation is textual, e.g. zero occurrences of a rejected API symbol.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const STORAGE = resolve(SRC, 'storage');
const DB = resolve(SRC, 'db.ts');
const REPOS = new Set([
  resolve(SRC, 'authz/predicates.repo.ts'),
  resolve(SRC, 'authz/domain.repo.ts'),
  resolve(SRC, 'authz/mutations.repo.ts'),
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);

const resolveRelative = (fromFile: string, spec: string): string | null =>
  spec.startsWith('.') ? resolve(dirname(fromFile), spec) : null;

interface Edge {
  readonly spec: string;
  readonly target: string | null;
  readonly isValue: boolean;
}

function edges(file: string, sf: ts.SourceFile): Edge[] {
  const out: Edge[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly === true;
      const named = clause?.namedBindings;
      const allElementsTypeOnly =
        named && ts.isNamedImports(named) ? named.elements.every((e) => e.isTypeOnly) : false;
      const isValue = clause ? !(typeOnly || (allElementsTypeOnly && !clause.name)) : true;
      out.push({ spec, target: resolveRelative(file, spec), isValue });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({
        spec: node.moduleSpecifier.text,
        target: resolveRelative(file, node.moduleSpecifier.text),
        isValue: !node.isTypeOnly,
      });
    } else if (ts.isCallExpression(node)) {
      const dyn = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const req = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const arg = node.arguments[0];
      if ((dyn || req) && arg && ts.isStringLiteral(arg)) {
        out.push({ spec: arg.text, target: resolveRelative(file, arg.text), isValue: true });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Exported declaration names of a module. */
function exportedNames(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  const exported = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) &&
    (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const stmt of sf.statements) {
    if (!exported(stmt)) continue;
    if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isFunctionDeclaration(stmt)
    ) {
      if (stmt.name) names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    }
  }
  return names.sort();
}

/** Member names of a named interface, in declaration order. */
function interfaceMembers(files: string[], name: string): string[] | null {
  for (const file of files) {
    for (const stmt of parse(file).statements) {
      if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
        return stmt.members.map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : '<computed>'));
      }
    }
  }
  return null;
}

/** Every identifier and string/template literal text in a file (comments excluded). */
function codeTokens(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) out.push(node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const STORAGE_FILES = walk(STORAGE);
const ALL_SRC = walk(SRC);
const NON_STORAGE_SRC = ALL_SRC.filter((f) => !f.startsWith(`${STORAGE}/`));

describe('P12-D containment — the storage tree (STATIC)', () => {
  it('guardrail: the walk found exactly the three ratified storage modules', () => {
    expect(STORAGE_FILES.map((f) => relative(STORAGE, f)).sort()).toEqual([
      'local-object-storage.ts',
      'object-access.ts',
      'object-storage.ts',
    ]);
    expect(ALL_SRC.length).toBeGreaterThan(10);
  });

  it('value-imports no pg, no db.ts, no authz repository, and no test/ path', () => {
    const violations: string[] = [];
    for (const file of STORAGE_FILES) {
      const rel = relative(SRC, file);
      for (const e of edges(file, parse(file))) {
        if (e.target?.includes(`${resolve(SRC, '..')}/test/`) || e.spec.includes('/test/') || e.spec.startsWith('test/')) {
          violations.push(`${rel}: imports a test/ path ('${e.spec}')`);
        }
        if (!e.isValue) continue;
        if (e.spec === 'pg') violations.push(`${rel}: value-imports 'pg'`);
        if (e.target === DB) violations.push(`${rel}: value-imports db.ts`);
        if (e.target && REPOS.has(e.target)) violations.push(`${rel}: value-imports an authz repository ('${e.spec}')`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the only value-bearing edges in the tree are node:crypto and the port constant', () => {
    // Positive lock: a future runtime dependency is caught here, not tolerated.
    const valueEdges: string[] = [];
    for (const file of STORAGE_FILES) {
      for (const e of edges(file, parse(file))) {
        if (e.isValue) valueEdges.push(`${relative(STORAGE, file)} -> ${e.spec}`);
      }
    }
    expect(valueEdges.sort()).toEqual([
      'local-object-storage.ts -> ./object-storage.ts',
      'local-object-storage.ts -> node:crypto',
      'object-access.ts -> ./object-storage.ts',
      'object-storage.ts -> node:crypto',
    ]);
  });

  it('exports exactly the ratified symbols and nothing more', () => {
    const byFile = Object.fromEntries(
      STORAGE_FILES.map((f) => [relative(STORAGE, f), exportedNames(parse(f))]),
    );
    expect(byFile['object-storage.ts']).toEqual([
      'Clock',
      'MAX_OBJECT_AUTHORIZATION_SECONDS',
      'ObjectAccessMode',
      'ObjectAuthorization',
      'ObjectKey',
      'ObjectStorage',
      'ObjectStorageError',
      'ObjectStorageFailure',
      'newObjectKey',
    ]);
    expect(byFile['local-object-storage.ts']).toEqual(['createLocalObjectStorage']);
    // No production composition factory, no production binding implementation.
    expect(byFile['object-access.ts']).toEqual([
      'ObjectAccessIssuer',
      'ObjectBindingResolver',
      'createObjectAccessIssuer',
    ]);
  });
});

describe('P12-D containment — the ratified shapes (STATIC)', () => {
  it('ObjectAccessIssuer exposes exactly one method: download issuance', () => {
    expect(interfaceMembers(STORAGE_FILES, 'ObjectAccessIssuer')).toEqual(['issueDownloadAuthorization']);
  });

  it('ObjectAuthorization declares no url member and no artifact association', () => {
    const members = interfaceMembers(STORAGE_FILES, 'ObjectAuthorization');
    expect(members).toEqual(['key', 'mode', 'expiresAt', 'credential']);
    expect(members).not.toContain('url');
  });

  it('ObjectStorage declares exactly the four byte-plane operations and no revocation', () => {
    const members = interfaceMembers(STORAGE_FILES, 'ObjectStorage');
    expect(members).toEqual(['authorizeUpload', 'authorizeDownload', 'put', 'get']);
    expect(members).not.toContain('revokeAuthorization');
  });

  it('ObjectBindingResolver is referenced in code only as a declaration and a dependency type', () => {
    // Two AST identifier references exist: the interface declaration, and the
    // `binding` property type in createObjectAccessIssuer's deps. A THIRD would
    // mean a production implementation or composition had appeared.
    let refs = 0;
    for (const file of STORAGE_FILES) {
      refs += codeTokens(parse(file)).filter((t) => t === 'ObjectBindingResolver').length;
    }
    expect(refs).toBe(2);
  });
});

describe('P12-D containment — no production composition, caller, or vendor leak (STATIC)', () => {
  it('no production module outside src/storage imports the storage tree', () => {
    const importers: string[] = [];
    for (const file of NON_STORAGE_SRC) {
      for (const e of edges(file, parse(file))) {
        if (e.target?.startsWith(`${STORAGE}/`)) importers.push(`${relative(SRC, file)} -> ${e.spec}`);
      }
    }
    // Boundary Only: the modules are future-consumable infrastructure with no
    // current production caller, by ratification.
    expect(importers).toEqual([]);
  });

  it('no vendor storage vocabulary appears in the storage tree CODE', () => {
    // AST scan — comments are excluded ON PURPOSE. The header comments name
    // vendors only to deny them (e.g. "no S3/R2/MinIO SDK"); a denial in prose
    // is not a leak. The property is that no identifier or string literal in
    // the boundary names a provider concept.
    //
    // 'r2' is deliberately absent from this list: it collides with the Gate 1
    // ruling identifier R2 used in these modules' provenance comments. The
    // Cloudflare product is covered by the 'cloudflare' token instead.
    const VENDOR = ['s3', 'aws', 'arn', 'bucket', 'minio', 'cloudflare', 'presign', 'azure', 'gcs', 'blob'];
    const hits: string[] = [];
    for (const file of STORAGE_FILES) {
      for (const tok of codeTokens(parse(file))) {
        const low = tok.toLowerCase();
        for (const v of VENDOR) if (low.includes(v)) hits.push(`${relative(STORAGE, file)}: '${tok}' ~ ${v}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('no authoritative table, schema, or SQL keyword appears in the storage tree CODE', () => {
    // The storage boundary names no authoritative surface. Combined with the
    // import lock above (it holds no database handle), this is the static basis
    // for "storage activity manufactures no authoritative fact". It proves
    // SOURCE-LEVEL absence of any write path — not a runtime guarantee; the
    // runtime counterpart is the row-count proof in
    // object-storage-authorization.test.ts.
    const FORBIDDEN = [
      'artifacts',
      'placements',
      'placement_recipients',
      'key_grants',
      'outbox_events',
      'graph_edges',
      'pgmigrations',
      'select',
      'insert',
      'update',
      'delete from',
      'truncate',
      'database_url',
    ];
    const hits: string[] = [];
    for (const file of STORAGE_FILES) {
      for (const tok of codeTokens(parse(file))) {
        const low = tok.toLowerCase();
        for (const f of FORBIDDEN) if (low.includes(f)) hits.push(`${relative(STORAGE, file)}: '${tok}' ~ ${f}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

describe('P12-D containment — textual obligations over production source (STATIC)', () => {
  it('zero production occurrences of the rejected upload-issuance symbol', () => {
    // TEXT scan, comments INCLUDED, across the whole production tree: the
    // chamber's obligation is that the symbol name appears nowhere in
    // production source, not merely that no such method is declared.
    const hits = ALL_SRC.filter((f) => readFileSync(f, 'utf8').includes('issueUploadAuthorization'));
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('the storage tree names no credential variable, projection schema, or SQL statement in text', () => {
    // TEXT scan, comments INCLUDED. Uppercase SQL keywords are the repository's
    // universal convention for SQL, so an uppercase scan is the meaningful one;
    // this does not claim that no lowercase English word resembling SQL appears
    // in prose.
    const violations: string[] = [];
    for (const file of STORAGE_FILES) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(STORAGE, file);
      if (/[A-Z_]*DATABASE_URL/.test(text)) violations.push(`${rel}: names a database credential`);
      if (/\bproj\./.test(text)) violations.push(`${rel}: references the projection schema`);
      if (/\bdomain\./.test(text)) violations.push(`${rel}: references the domain write surface`);
      if (/\b(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|ALTER TABLE|CREATE TABLE)\b/.test(text)) {
        violations.push(`${rel}: contains an SQL statement keyword`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
