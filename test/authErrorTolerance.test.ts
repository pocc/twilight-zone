import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthError, batchWithConcurrency } from '../src/api';
import { migrateSingleton } from '../src/migrate/singleton';
import { createEmptyReport } from '../src/migrate/setup';
import { validateDryRun } from '../src/validator';

afterEach(() => {
  vi.unstubAllGlobals();
});

const deps = () => ({
  report: createEmptyReport({ zone: { name: 'source.example.com' } }, 'dest.example.com', 'dest-account'),
  log: () => undefined,
  onItemDone: () => undefined,
});

describe('authentication errors in tolerant migration helpers', () => {
  it('checks AuthError before every migration catch that can intercept an api call', () => {
    const srcDir = join(process.cwd(), 'src');
    const migrationDir = join(srcDir, 'migrate');
    const files = readdirSync(srcDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(srcDir, name))
      .concat(readdirSync(migrationDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(migrationDir, name)));
    const violations: string[] = [];

    for (const file of files) {
      const sourceText = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isTryStatement(node) && node.catchClause) {
          let callsApi = false;
          const findApiCall = (candidate: ts.Node): void => {
            if (
              ts.isCallExpression(candidate)
              && ts.isPropertyAccessExpression(candidate.expression)
              && ts.isIdentifier(candidate.expression.expression)
              && candidate.expression.expression.text === 'api'
            ) callsApi = true;
            candidate.forEachChild(findApiCall);
          };
          node.tryBlock.forEachChild(findApiCall);

          if (callsApi) {
            const catchText = node.catchClause.block.getText(source);
            if (!catchText.includes('api.throwIfAuthError(')) {
              const line = source.getLineAndCharacterOfPosition(node.catchClause.getStart(source)).line + 1;
              violations.push(`${file.replace(`${process.cwd()}/`, '')}:${line}`);
            }
          }
        }
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'catch'
        ) {
          let callsApi = false;
          const findApiCall = (candidate: ts.Node): void => {
            if (
              ts.isCallExpression(candidate)
              && ts.isPropertyAccessExpression(candidate.expression)
              && ts.isIdentifier(candidate.expression.expression)
              && candidate.expression.expression.text === 'api'
            ) callsApi = true;
            candidate.forEachChild(findApiCall);
          };
          node.expression.expression.forEachChild(findApiCall);
          const handler = node.arguments[0];
          if (callsApi && handler && !handler.getText(source).includes('api.throwIfAuthError(')) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            violations.push(`${file.replace(`${process.cwd()}/`, '')}:${line}`);
          }
        }
        node.forEachChild(visit);
      };
      source.forEachChild(visit);
    }

    expect(violations).toEqual([]);
  });

  it('does not leave AuthError hidden in settled batch results', async () => {
    await expect(batchWithConcurrency(
      ['resource'],
      async () => { throw new AuthError('OAuth token expired', 'oauth-token'); },
    )).rejects.toBeInstanceOf(AuthError);
  });

  it('does not convert a singleton AuthError into a failed report row', async () => {
    const state = deps();

    await expect(migrateSingleton(
      state,
      'Managed Headers',
      true,
      'PUT /zones/dest/managed_headers',
      async () => { throw new AuthError('OAuth token expired', 'oauth-token'); },
    )).rejects.toBeInstanceOf(AuthError);

    expect(state.report.sections).toEqual([]);
    expect(state.report.errors).toEqual([]);
  });

  it('keeps non-auth singleton entitlement failures acknowledged', async () => {
    const state = deps();

    await migrateSingleton(
      state,
      'Managed Headers',
      true,
      'PUT /zones/dest/managed_headers',
      async () => { throw new Error('This feature is not available to this zone'); },
    );

    expect(state.report.sections[0]).toMatchObject({ failed: 0, acknowledged: 1 });
    expect(state.report.errors).toEqual([]);
  });

  it('does not convert destination validation authentication failures into warnings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ code: 9109, message: 'Invalid access token' }],
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    await expect(validateDryRun(
      { zone: { id: 'source-zone', name: 'source.example.com', account: { id: 'source-account', name: 'Source' }, plan: { id: 'free', name: 'Free' }, status: 'active' } } as never,
      { type: 'token', token: 'expired-oauth-token' },
      'dest-account',
      'dest.example.com',
      () => undefined,
    )).rejects.toBeInstanceOf(AuthError);
  });
});
