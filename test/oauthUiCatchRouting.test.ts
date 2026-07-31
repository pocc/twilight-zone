import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  OAuthReauthorizationError,
  routeOAuthReauthorization,
} from '../app/lib/request';

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('UI OAuth reauthorization catch routing', () => {
  it('routes a typed OAuth error through the shared role callback', () => {
    const callback = vi.fn();

    expect(routeOAuthReauthorization(
      new OAuthReauthorizationError('destination'),
      callback,
    )).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('destination');
  });

  it('does not consume ordinary request errors', () => {
    const callback = vi.fn();

    expect(routeOAuthReauthorization(new Error('network failed'), callback)).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not consume a typed OAuth error when no callback can handle it', () => {
    expect(routeOAuthReauthorization(
      new OAuthReauthorizationError('source'),
    )).toBe(false);
  });

  it.each([
    'app/App.tsx',
    'app/hooks/useUptimeMonitor.ts',
    'app/components/DownloadScriptButton.tsx',
    'app/components/EmailAddressVerificationCard.tsx',
  ])('routes request catches in %s through the shared helper', (path) => {
    expect(source(path)).toContain('routeOAuthReauthorization(');
  });

  it('stops uptime polling when a ping requires reauthorization', () => {
    expect(source('app/hooks/useUptimeMonitor.ts')).toMatch(
      /if \(routeOAuthReauthorization\(e, onReauthorizationRequired\)\) \{\s*setRunning\(false\);\s*return;\s*\}/,
    );
  });

  it('disables OAuth with an explicit reason when nonce ownership is unsupported', () => {
    expect(source('app/hooks/useOAuthSession.ts')).toMatch(
      /error instanceof OAuthNonceOwnershipError[\s\S]*setEnabled\(false\)[\s\S]*setReason\(error\.message\)/,
    );
  });

  it('releases email verification rows from busy states before reconnecting', () => {
    const emailCard = source('app/components/EmailAddressVerificationCard.tsx');
    const recoveredStatuses = [...emailCard.matchAll(
      /if \(routeOAuthReauthorization\(e, onReauthorizationRequired\)\) \{\s*update\(\{ status: '(unverified|sent)' \}\);/g,
    )].map((match) => match[1]);
    expect(recoveredStatuses).toEqual(['unverified', 'sent']);
  });
});
