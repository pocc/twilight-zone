/**
 * Build the Cloudflare Access SSO login URL for a destination IdP.
 *
 * The dashboard's "Test IdP" button (documented at
 * https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/#test-idps-in-cloudflare-one)
 * opens a new tab to the team's Access SSO endpoint, which initiates a
 * real OAuth/SAML round-trip with the IdP. We mirror that flow:
 *
 *   https://<auth_domain>.cloudflareaccess.com
 *     /cdn-cgi/access/sso/<type>/<idp_id>/login
 *     ?redirect_url=https://<auth_domain>.cloudflareaccess.com/
 *
 * On a successful auth, the IdP sends the user back to Cloudflare
 * Access, which redirects to the `redirect_url`. The user lands on a
 * recognizable Cloudflare-served page rather than a 404.
 *
 * URL components are validated to avoid emitting obviously broken
 * links. Returns null when any required input is empty.
 */

export interface IdpLoginUrlInputs {
  /** `<auth_domain>` from /access/organizations on the dest account. */
  authDomain: string;
  /** IdP type slug - must match the create-time `type` field. */
  idpType: string;
  /** Destination IdP UUID from the create POST response. */
  idpId: string;
}

export function buildIdpLoginUrl(inputs: IdpLoginUrlInputs): string | null {
  const { authDomain, idpType, idpId } = inputs;
  if (
    typeof authDomain !== 'string' || authDomain.length === 0 ||
    typeof idpType !== 'string' || idpType.length === 0 ||
    typeof idpId !== 'string' || idpId.length === 0
  ) {
    return null;
  }
  // Refuse anything that looks like an injection attempt. The auth
  // domain comes from a Cloudflare API response (trusted) but defense
  // in depth is cheap.
  if (
    authDomain.includes('/') || authDomain.includes(' ') ||
    idpType.includes('/') || idpType.includes(' ') ||
    idpId.includes('/') || idpId.includes(' ')
  ) {
    return null;
  }
  const base = `https://${authDomain}.cloudflareaccess.com`;
  const path = `/cdn-cgi/access/sso/${encodeURIComponent(idpType)}/${encodeURIComponent(idpId)}/login`;
  const redirect = encodeURIComponent(`${base}/`);
  return `${base}${path}?redirect_url=${redirect}`;
}
