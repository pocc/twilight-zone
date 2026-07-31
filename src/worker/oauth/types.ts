export type OAuthRole = 'source' | 'destination';

export type OAuthEnvelopePurpose = 'transaction' | 'grant';

export type OAuthEnvelopeContext = {
  keyId: string;
  role: OAuthRole;
  purpose: OAuthEnvelopePurpose;
  origin: string;
};

export type OAuthEnvelope = {
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
};

export type OAuthTransactionPayload = {
  version: 1;
  role: OAuthRole;
  stateDigest: string;
  nonceDigest: string;
  codeVerifier: string;
  issuedAt: number;
};

export type OAuthGrantPayload = {
  version: 1;
  role: OAuthRole;
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: number;
  scopes: string[];
  nonceDigest: string;
  grantId: string;
};

export type OAuthPayload = OAuthTransactionPayload | OAuthGrantPayload;

export type OAuthConfigError =
  | 'oauth_disabled'
  | 'oauth_config_missing'
  | 'oauth_config_invalid_key'
  | 'oauth_config_invalid_client'
  | 'oauth_config_invalid_origin'
  | 'oauth_config_invalid_redirect'
  | 'oauth_config_invalid_scopes'
  | 'oauth_config_invalid_provider';

export type OAuthProviderError =
  | 'oauth_provider_timeout'
  | 'oauth_provider_unavailable'
  | 'oauth_provider_rejected'
  | 'oauth_provider_invalid_response'
  | 'oauth_provider_invalid_token';

export type OAuthConfig = {
  clientId: string;
  cookieKey: CryptoKey;
  cookieKeyId: string;
  allowedOrigin: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  sourceScopes: Set<string>;
  destinationScopes: Set<string>;
};
