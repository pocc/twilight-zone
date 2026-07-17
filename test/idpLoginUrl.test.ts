/**
 * Tests for app/lib/idpLoginUrl.ts — Cloudflare Access SSO login
 * URL construction for the Step 4 IdP test workflow.
 *
 * URL shape:
 *   https://<auth_domain>.cloudflareaccess.com/cdn-cgi/access/sso/
 *     <type>/<id>/login?redirect_url=<encoded base URL>
 *
 * Documented at
 * https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/#test-idps-in-cloudflare-one
 */

import { describe, it, expect } from 'vitest';
import { buildIdpLoginUrl } from '../app/lib/idpLoginUrl';

describe('buildIdpLoginUrl', () => {
  it('builds the canonical Access SSO URL for an OIDC IdP', () => {
    const url = buildIdpLoginUrl({
      authDomain: 'acme',
      idpType: 'oidc',
      idpId: '12345678-1234-1234-1234-123456789abc',
    });
    expect(url).toBe(
      'https://acme.cloudflareaccess.com/cdn-cgi/access/sso/oidc/12345678-1234-1234-1234-123456789abc/login?redirect_url=https%3A%2F%2Facme.cloudflareaccess.com%2F',
    );
  });

  it('handles SAML IdPs (path slug is the type)', () => {
    const url = buildIdpLoginUrl({
      authDomain: 'corp',
      idpType: 'saml',
      idpId: 'abcd-efgh',
    });
    expect(url).toContain('/cdn-cgi/access/sso/saml/abcd-efgh/login');
  });

  it('handles Okta IdPs', () => {
    const url = buildIdpLoginUrl({
      authDomain: 'team',
      idpType: 'okta',
      idpId: 'okta-id-1',
    });
    expect(url).toContain('/cdn-cgi/access/sso/okta/okta-id-1/login');
  });

  it('returns null when authDomain is empty', () => {
    expect(buildIdpLoginUrl({ authDomain: '', idpType: 'oidc', idpId: 'x' })).toBeNull();
  });

  it('returns null when idpType is empty', () => {
    expect(buildIdpLoginUrl({ authDomain: 'a', idpType: '', idpId: 'x' })).toBeNull();
  });

  it('returns null when idpId is empty', () => {
    expect(buildIdpLoginUrl({ authDomain: 'a', idpType: 'oidc', idpId: '' })).toBeNull();
  });

  it('rejects authDomain with slashes (injection guard)', () => {
    // The auth_domain comes from the Cloudflare API so it should
    // never have slashes, but defense in depth is cheap.
    expect(
      buildIdpLoginUrl({ authDomain: 'evil/path', idpType: 'oidc', idpId: 'x' }),
    ).toBeNull();
  });

  it('rejects idpType with slashes', () => {
    expect(
      buildIdpLoginUrl({ authDomain: 'a', idpType: 'oidc/extra', idpId: 'x' }),
    ).toBeNull();
  });

  it('rejects idpId with slashes', () => {
    expect(
      buildIdpLoginUrl({ authDomain: 'a', idpType: 'oidc', idpId: 'x/y' }),
    ).toBeNull();
  });

  it('rejects authDomain containing whitespace', () => {
    expect(
      buildIdpLoginUrl({ authDomain: 'a b', idpType: 'oidc', idpId: 'x' }),
    ).toBeNull();
  });

  it('redirect_url points back at the team root for a recognizable landing page', () => {
    const url = buildIdpLoginUrl({
      authDomain: 'team',
      idpType: 'oidc',
      idpId: 'id1',
    });
    expect(url).toMatch(/redirect_url=https%3A%2F%2Fteam\.cloudflareaccess\.com%2F$/);
  });
});
