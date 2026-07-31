// [R10] Storage keys are intentionally predictable for debuggability.
// Security is handled by using sessionStorage for sensitive tokens (see useCredentials.ts).
export const STORAGE_KEYS = {
  authMode: 'tz_authMode',
  sourceToken: 'tz_sourceToken',
  sourceAccountId: 'tz_sourceAccountId',
  sourceZoneId: 'tz_sourceZoneId',
  destToken: 'tz_destToken',
  destAccountId: 'tz_destAccountId',
  domainName: 'tz_domainName',
  apiKey: 'tz_apiKey',
  apiEmail: 'tz_apiEmail',
  destApiKey: 'tz_destApiKey',
  destApiEmail: 'tz_destApiEmail',
  useApiKey: 'tz_useApiKey',
  theme: 'tz_theme',
  twilightTheme: 'tz_twilightTheme',
} as const;

export const PHASE_DISPLAY_NAMES: Record<string, string> = {
  http_request_firewall_custom: 'Custom Rules (WAF)',
  http_request_firewall_managed: 'Managed Rules (WAF)',
  http_ratelimit: 'Rate Limiting Rules',
  http_request_sbfm: 'Super Bot Fight Mode',
  http_request_transform: 'URL Rewrite Rules',
  http_request_origin: 'Origin Rules',
  http_request_cache_settings: 'Cache Rules',
  http_config_settings: 'Configuration Rules',
  http_request_dynamic_redirect: 'Dynamic Redirects',
  http_request_redirect: 'Redirect Rules',
  http_response_headers_transform: 'Response Header Modification',
  http_request_late_transform: 'Request Header Modification',
  http_request_snippets: 'Snippets',
  http_log_custom_fields: 'Custom Log Fields',
  ddos_l7: 'DDoS L7',
  http_response_compression: 'Compression Rules',
};

export function getRulesetDisplayName(ruleset: { phase?: string; name?: string }): string {
  if (ruleset.phase && PHASE_DISPLAY_NAMES[ruleset.phase]) {
    return PHASE_DISPLAY_NAMES[ruleset.phase];
  }
  return ruleset.name || ruleset.phase || 'Unknown Ruleset';
}
