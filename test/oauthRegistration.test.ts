import { describe, expect, it } from 'vitest';

import { registeredApiRoutes } from '../src/worker/index';
import { UI_ROUTE_POLICIES } from '../src/worker/oauth/route-policy';

describe('actual API route registration', () => {
  it('matches every declared method and path exactly, including v1 slash variants', () => {
    const declared = (UI_ROUTE_POLICIES as unknown as { method: string; path: string }[])
      .map(({ method, path }) => `${method} ${path}`)
      .sort();
    expect([...registeredApiRoutes].sort()).toEqual(declared);
    expect(declared).toContain('GET /api/v1');
    expect(declared).toContain('GET /api/v1/');
    expect(declared).toContain('GET /api/v1/docs');
    expect(declared).toContain('POST /api/v1/*');
  });
});
