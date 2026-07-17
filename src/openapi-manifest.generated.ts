// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: /tmp/api-schemas/openapi.json
// Generated: 2026-06-28T06:03:49.465Z

export type OpenApiGetOperation = {
  method: 'GET';
  path: string;
  operationId?: string;
  tags?: string[];
  pathParams: string[];
  queryParams: string[];
};

export const OPENAPI_GET_OPERATIONS: OpenApiGetOperation[] = [
  {
    "method": "GET",
    "path": "/accounts",
    "operationId": "accounts-list-accounts",
    "tags": [
      "Accounts"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "page",
      "per_page",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}",
    "operationId": "accounts-account-details",
    "tags": [
      "Accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/abuse-reports",
    "operationId": "ListAbuseReports",
    "tags": [
      "tseng-abuse-complaint-processor_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "sort",
      "domain",
      "created_before",
      "created_after",
      "status",
      "type",
      "mitigation_status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/abuse-reports/{report_id}/emails",
    "operationId": "ListEmails",
    "tags": [
      "tseng-abuse-complaint-processor_other"
    ],
    "pathParams": [
      "account_id",
      "report_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/abuse-reports/{report_id}/mitigations",
    "operationId": "ListMitigations",
    "tags": [
      "tseng-abuse-complaint-processor_other"
    ],
    "pathParams": [
      "account_id",
      "report_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "sort",
      "type",
      "effective_before",
      "effective_after",
      "status",
      "entity_type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/abuse-reports/{report_param}",
    "operationId": "GetAbuseReport",
    "tags": [
      "tseng-abuse-complaint-processor_other"
    ],
    "pathParams": [
      "account_id",
      "report_param"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/ai-controls/mcp/portals",
    "operationId": "mcp-portals-api-list-portals",
    "tags": [
      "MCP Portal"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/ai-controls/mcp/portals/{id}",
    "operationId": "mcp-portals-api-fetch-gateways",
    "tags": [
      "MCP Portal"
    ],
    "pathParams": [
      "id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/ai-controls/mcp/servers",
    "operationId": "mcp-portals-api-list-servers",
    "tags": [
      "MCP Portal Servers"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/ai-controls/mcp/servers/{id}",
    "operationId": "mcp-portals-api-fetch-servers",
    "tags": [
      "MCP Portal Servers"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps",
    "operationId": "access-applications-list-access-applications",
    "tags": [
      "Access applications"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "domain",
      "aud",
      "target_attributes",
      "exact",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/{app_id}",
    "operationId": "access-applications-get-an-access-application",
    "tags": [
      "Access applications"
    ],
    "pathParams": [
      "app_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/{app_id}/ca",
    "operationId": "access-short-lived-certificate-c-as-get-a-short-lived-certificate-ca",
    "tags": [
      "Access short-lived certificate CAs"
    ],
    "pathParams": [
      "app_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/{app_id}/policies",
    "operationId": "access-policies-list-access-app-policies",
    "tags": [
      "Access application-scoped policies"
    ],
    "pathParams": [
      "app_id",
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}",
    "operationId": "access-policies-get-an-access-policy",
    "tags": [
      "Access application-scoped policies"
    ],
    "pathParams": [
      "app_id",
      "policy_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/{app_id}/user_policy_checks",
    "operationId": "access-applications-test-access-policies",
    "tags": [
      "Access applications"
    ],
    "pathParams": [
      "app_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/apps/ca",
    "operationId": "access-short-lived-certificate-c-as-list-short-lived-certificate-c-as",
    "tags": [
      "Access short-lived certificate CAs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/authenticator_device_aaguids",
    "operationId": "access-authenticator-device-aaguids-list",
    "tags": [
      "Access Authenticator Device AAGUIDs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/bookmarks",
    "operationId": "access-bookmark-applications-(-deprecated)-list-bookmark-applications",
    "tags": [
      "Access Bookmark applications (Deprecated)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/bookmarks/{bookmark_id}",
    "operationId": "access-bookmark-applications-(-deprecated)-get-a-bookmark-application",
    "tags": [
      "Access Bookmark applications (Deprecated)"
    ],
    "pathParams": [
      "bookmark_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/certificates",
    "operationId": "access-mtls-authentication-list-mtls-certificates",
    "tags": [
      "Access mTLS authentication"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/certificates/{certificate_id}",
    "operationId": "access-mtls-authentication-get-an-mtls-certificate",
    "tags": [
      "Access mTLS authentication"
    ],
    "pathParams": [
      "certificate_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/certificates/settings",
    "operationId": "access-mtls-authentication-list-mtls-certificates-hostname-settings",
    "tags": [
      "Access mTLS authentication"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/custom_pages",
    "operationId": "access-custom-pages-list-custom-pages",
    "tags": [
      "Access custom pages"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/custom_pages/{custom_page_id}",
    "operationId": "access-custom-pages-get-a-custom-page",
    "tags": [
      "Access custom pages"
    ],
    "pathParams": [
      "custom_page_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/gateway_ca",
    "operationId": "access-gateway-ca-list-SSH-ca",
    "tags": [
      "Gateway CA"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/groups",
    "operationId": "access-groups-list-access-groups",
    "tags": [
      "Access groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/groups/{group_id}",
    "operationId": "access-groups-get-an-access-group",
    "tags": [
      "Access groups"
    ],
    "pathParams": [
      "group_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/identity_providers",
    "operationId": "access-identity-providers-list-access-identity-providers",
    "tags": [
      "Access identity providers"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "scim_enabled",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/identity_providers/{identity_provider_id}",
    "operationId": "access-identity-providers-get-an-access-identity-provider",
    "tags": [
      "Access identity providers"
    ],
    "pathParams": [
      "identity_provider_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/identity_providers/{identity_provider_id}/scim/groups",
    "operationId": "access-identity-providers-list-scim-group-resources",
    "tags": [
      "Access identity providers"
    ],
    "pathParams": [
      "identity_provider_id",
      "account_id"
    ],
    "queryParams": [
      "cf_resource_id",
      "idp_resource_id",
      "name",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/identity_providers/{identity_provider_id}/scim/users",
    "operationId": "access-identity-providers-list-scim-user-resources",
    "tags": [
      "Access identity providers"
    ],
    "pathParams": [
      "identity_provider_id",
      "account_id"
    ],
    "queryParams": [
      "cf_resource_id",
      "idp_resource_id",
      "username",
      "email",
      "name",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/idp_federation_grants",
    "operationId": "access-idp-federation-grants-list",
    "tags": [
      "Access IdP federation grants"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/idp_federation_grants/{grant_id}",
    "operationId": "access-idp-federation-grants-get",
    "tags": [
      "Access IdP federation grants"
    ],
    "pathParams": [
      "account_id",
      "grant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/keys",
    "operationId": "access-key-configuration-get-the-access-key-configuration",
    "tags": [
      "Access key configuration"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/logs/access_requests",
    "operationId": "access-authentication-logs-get-access-authentication-logs",
    "tags": [
      "Access authentication logs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "direction",
      "since",
      "until",
      "per_page",
      "email",
      "email_exact",
      "user_id",
      "allowedOp",
      "country_codeOp",
      "app_typeOp",
      "app_uidOp",
      "ray_idOp",
      "emailOp",
      "idpOp",
      "non_identityOp",
      "user_idOp",
      "fields"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/logs/scim/updates",
    "operationId": "access-scim-update-logs-list-access-scim-update-logs",
    "tags": [
      "Access SCIM update logs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "direction",
      "since",
      "until",
      "idp_id",
      "status",
      "resource_type",
      "request_method",
      "resource_user_email",
      "resource_group_name",
      "cf_resource_id",
      "idp_resource_id",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/organizations",
    "operationId": "zero-trust-organization-get-your-zero-trust-organization",
    "tags": [
      "Zero Trust organization"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/organizations/doh",
    "operationId": "zero-trust-organization-get-your-zero-trust-organization-doh-settings",
    "tags": [
      "Zero Trust organization"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/policies",
    "operationId": "access-policies-list-access-reusable-policies",
    "tags": [
      "Access reusable policies"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/policies/{policy_id}",
    "operationId": "access-policies-get-an-access-reusable-policy",
    "tags": [
      "Access reusable policies"
    ],
    "pathParams": [
      "account_id",
      "policy_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/policy-tests/{policy_test_id}",
    "operationId": "access-policy-tests-get-an-update",
    "tags": [
      "Access policy tester"
    ],
    "pathParams": [
      "account_id",
      "policy_test_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/policy-tests/{policy_test_id}/users",
    "operationId": "access-policy-tests-get-a-user-page",
    "tags": [
      "Access policy tester"
    ],
    "pathParams": [
      "account_id",
      "policy_test_id"
    ],
    "queryParams": [
      "per_page",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/saml_certificates",
    "operationId": "access-saml-certificates-list-certificate-sets",
    "tags": [
      "Access SAML encryption certificates"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/saml_certificates/{saml_cert_set_id}",
    "operationId": "access-saml-certificates-get-certificate-set",
    "tags": [
      "Access SAML encryption certificates"
    ],
    "pathParams": [
      "account_id",
      "saml_cert_set_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/saml_certificates/{saml_cert_set_id}/pem",
    "operationId": "access-saml-certificates-get-pem",
    "tags": [
      "Access SAML encryption certificates"
    ],
    "pathParams": [
      "account_id",
      "saml_cert_set_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/service_tokens",
    "operationId": "access-service-tokens-list-service-tokens",
    "tags": [
      "Access service tokens"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/service_tokens/{service_token_id}",
    "operationId": "access-service-tokens-get-a-service-token",
    "tags": [
      "Access service tokens"
    ],
    "pathParams": [
      "service_token_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/tags",
    "operationId": "access-tags-list-tags",
    "tags": [
      "Access tags"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/tags/{tag_name}",
    "operationId": "access-tags-get-a-tag",
    "tags": [
      "Access tags"
    ],
    "pathParams": [
      "account_id",
      "tag_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users",
    "operationId": "zero-trust-users-get-users",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "email",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users/{user_id}",
    "operationId": "zero-trust-users-get-user",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "user_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users/{user_id}/active_sessions",
    "operationId": "zero-trust-users-get-active-sessions",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "user_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users/{user_id}/active_sessions/{nonce}",
    "operationId": "zero-trust-users-get-active-session",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "user_id",
      "account_id",
      "nonce"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users/{user_id}/failed_logins",
    "operationId": "zero-trust-users-get-failed-logins",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "user_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/access/users/{user_id}/last_seen_identity",
    "operationId": "zero-trust-users-get-last-seen-identity",
    "tags": [
      "Zero Trust users"
    ],
    "pathParams": [
      "user_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/address_maps",
    "operationId": "ip-address-management-address-maps-list-address-maps",
    "tags": [
      "IP Address Management Address Maps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/address_maps/{address_map_id}",
    "operationId": "ip-address-management-address-maps-address-map-details",
    "tags": [
      "IP Address Management Address Maps"
    ],
    "pathParams": [
      "address_map_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/leases",
    "operationId": "ip-address-management-list-leases",
    "tags": [
      "IP Address Management Leases"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/loa_documents/{loa_document_id}/download",
    "operationId": "ip-address-management-prefixes-download-loa-document",
    "tags": [
      "IP Address Management Prefixes"
    ],
    "pathParams": [
      "loa_document_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes",
    "operationId": "ip-address-management-prefixes-list-prefixes",
    "tags": [
      "IP Address Management Prefixes"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}",
    "operationId": "ip-address-management-prefixes-prefix-details",
    "tags": [
      "IP Address Management Prefixes"
    ],
    "pathParams": [
      "prefix_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/bgp/prefixes",
    "operationId": "ip-address-management-prefixes-list-bgp-prefixes",
    "tags": [
      "IP Address Management BGP Prefixes"
    ],
    "pathParams": [
      "account_id",
      "prefix_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/bgp/prefixes/{bgp_prefix_id}",
    "operationId": "ip-address-management-prefixes-fetch-bgp-prefix",
    "tags": [
      "IP Address Management BGP Prefixes"
    ],
    "pathParams": [
      "account_id",
      "prefix_id",
      "bgp_prefix_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/bgp/status",
    "operationId": "ip-address-management-dynamic-advertisement-get-advertisement-status",
    "tags": [
      "IP Address Management Dynamic Advertisement"
    ],
    "pathParams": [
      "prefix_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/bindings",
    "operationId": "ip-address-management-service-bindings-list-service-bindings",
    "tags": [
      "IP Address Management Service Bindings"
    ],
    "pathParams": [
      "account_id",
      "prefix_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/bindings/{binding_id}",
    "operationId": "ip-address-management-service-bindings-get-service-binding",
    "tags": [
      "IP Address Management Service Bindings"
    ],
    "pathParams": [
      "account_id",
      "prefix_id",
      "binding_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/prefixes/{prefix_id}/delegations",
    "operationId": "ip-address-management-prefix-delegation-list-prefix-delegations",
    "tags": [
      "IP Address Management Prefix Delegation"
    ],
    "pathParams": [
      "prefix_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/regional_hostnames/regions",
    "operationId": "dls-account-regional-hostnames-list-regions",
    "tags": [
      "DLS Regional Services"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/addressing/services",
    "operationId": "ip-address-management-service-bindings-list-services",
    "tags": [
      "IP Address Management Service Bindings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/credit-balance",
    "operationId": "aig-billing-get-credit-balance",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/invoice-history",
    "operationId": "aig-billing-get-invoice-history",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/invoice-preview",
    "operationId": "aig-billing-get-invoice-preview",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/spending-limit",
    "operationId": "aig-billing-get-spending-limit",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/topup/config",
    "operationId": "aig-billing-get-topup-config",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/topup/limits",
    "operationId": "aig-billing-get-topup-limits",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/billing/usage-history",
    "operationId": "aig-billing-get-usage-history",
    "tags": [
      "AI Gateway"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "value_grouping_window",
      "start_time",
      "end_time"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/custom-providers",
    "operationId": "aig-config-list-account-provider",
    "tags": [
      "AI Gateway Account Providers"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "beta",
      "enable",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/custom-providers/{id}",
    "operationId": "aig-config-fetch-account-provider",
    "tags": [
      "AI Gateway Account Providers"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/custom-providers/costs",
    "operationId": "aig-config-list-account-provider-cost",
    "tags": [
      "AI Gateway Account Provider Costs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "enable",
      "account_provider_id",
      "model_rule",
      "cost_type",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/custom-providers/costs/{id}",
    "operationId": "aig-config-fetch-account-provider-cost",
    "tags": [
      "AI Gateway Account Provider Costs"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/evaluation-types",
    "operationId": "aig-config-list-evaluators",
    "tags": [
      "AI Gateway Evaluations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order_by",
      "order_by_direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways",
    "operationId": "aig-config-list-gateway",
    "tags": [
      "AI Gateway Gateways"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/datasets",
    "operationId": "aig-config-list-dataset",
    "tags": [
      "AI Gateway Datasets"
    ],
    "pathParams": [
      "account_id",
      "gateway_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "name",
      "enable",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/datasets/{id}",
    "operationId": "aig-config-fetch-dataset",
    "tags": [
      "AI Gateway Datasets"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/evaluations",
    "operationId": "aig-config-list-evaluations",
    "tags": [
      "AI Gateway Evaluations"
    ],
    "pathParams": [
      "account_id",
      "gateway_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "name",
      "processed",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/evaluations/{id}",
    "operationId": "aig-config-fetch-evaluations",
    "tags": [
      "AI Gateway Evaluations"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs",
    "operationId": "aig-config-list-gateway-logs",
    "tags": [
      "AI Gateway Logs"
    ],
    "pathParams": [
      "account_id",
      "gateway_id"
    ],
    "queryParams": [
      "search",
      "page",
      "per_page",
      "order_by",
      "order_by_direction",
      "filters",
      "meta_info",
      "direction",
      "start_date",
      "end_date",
      "min_cost",
      "max_cost",
      "min_tokens_in",
      "max_tokens_in",
      "min_tokens_out",
      "max_tokens_out",
      "min_total_tokens",
      "max_total_tokens",
      "min_duration",
      "max_duration",
      "feedback",
      "success",
      "cached",
      "model",
      "model_type",
      "provider",
      "request_content_type",
      "response_content_type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}",
    "operationId": "aig-config-get-gateway-log-detail",
    "tags": [
      "AI Gateway Logs"
    ],
    "pathParams": [
      "id",
      "gateway_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}/request",
    "operationId": "aig-config-get-gateway-log-request",
    "tags": [
      "AI Gateway Logs"
    ],
    "pathParams": [
      "id",
      "gateway_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}/response",
    "operationId": "aig-config-get-gateway-log-response",
    "tags": [
      "AI Gateway Logs"
    ],
    "pathParams": [
      "id",
      "gateway_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs",
    "operationId": "aig-config-list-providers",
    "tags": [
      "AI Gateway Provider Configs"
    ],
    "pathParams": [
      "account_id",
      "gateway_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes",
    "operationId": "aig-config-list-gateway-dynamic-routes",
    "tags": [
      "AI Gateway Dynamic Routes"
    ],
    "pathParams": [
      "account_id",
      "gateway_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}",
    "operationId": "aig-config-get-gateway-dynamic-route",
    "tags": [
      "AI Gateway Dynamic Routes"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}/deployments",
    "operationId": "aig-config-list-gateway-dynamic-route-deployments",
    "tags": [
      "AI Gateway Dynamic Routes"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}/versions",
    "operationId": "aig-config-list-gateway-dynamic-route-versions",
    "tags": [
      "AI Gateway Dynamic Routes"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}/versions/{version_id}",
    "operationId": "aig-config-get-gateway-dynamic-route-version",
    "tags": [
      "AI Gateway Dynamic Routes"
    ],
    "pathParams": [
      "account_id",
      "gateway_id",
      "id",
      "version_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/url/{provider}",
    "operationId": "aig-config-get-gateway-url",
    "tags": [
      "AI Gateway Gateways"
    ],
    "pathParams": [
      "gateway_id",
      "account_id",
      "provider"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-gateway/gateways/{id}",
    "operationId": "aig-config-fetch-gateway",
    "tags": [
      "AI Gateway Gateways"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances",
    "operationId": "ai-search-list-instances",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search",
      "namespace",
      "order_by",
      "order_by_direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances/{id}",
    "operationId": "ai-search-fetch-instance",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances/{id}/jobs",
    "operationId": "ai-search-instance-list-jobs",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances/{id}/jobs/{job_id}",
    "operationId": "ai-search-instance-get-job",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances/{id}/jobs/{job_id}/logs",
    "operationId": "ai-search-instance-list-job-logs",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/instances/{id}/stats",
    "operationId": "ai-search-stats",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces",
    "operationId": "ai-search-list-namespaces",
    "tags": [
      "AI Search Namespaces"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}",
    "operationId": "ai-search-fetch-namespace",
    "tags": [
      "AI Search Namespaces"
    ],
    "pathParams": [
      "account_id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances",
    "operationId": "ai-search-namespace-list-instances",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "account_id",
      "name"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search",
      "namespace",
      "order_by",
      "order_by_direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}",
    "operationId": "ai-search-namespace-fetch-instance",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "account_id",
      "id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items",
    "operationId": "ai-search-namespace-instance-list-items",
    "tags": [
      "AI Search Instances Items"
    ],
    "pathParams": [
      "id",
      "account_id",
      "name"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search",
      "sort_by",
      "status",
      "source",
      "metadata_filter",
      "item_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items/{item_id}",
    "operationId": "ai-search-namespace-instance-get-item",
    "tags": [
      "AI Search Instances Items"
    ],
    "pathParams": [
      "id",
      "item_id",
      "account_id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items/{item_id}/chunks",
    "operationId": "ai-search-namespace-instance-list-item-chunks",
    "tags": [
      "AI Search Instances Items"
    ],
    "pathParams": [
      "id",
      "item_id",
      "account_id",
      "name"
    ],
    "queryParams": [
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items/{item_id}/download",
    "operationId": "ai-search-namespace-instance-get-item-content",
    "tags": [
      "AI Search Instances Items"
    ],
    "pathParams": [
      "id",
      "item_id",
      "account_id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items/{item_id}/logs",
    "operationId": "ai-search-namespace-instance-logs-item",
    "tags": [
      "AI Search Instances Items"
    ],
    "pathParams": [
      "id",
      "item_id",
      "account_id",
      "name"
    ],
    "queryParams": [
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/jobs",
    "operationId": "ai-search-namespace-instance-list-jobs",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "account_id",
      "name"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/jobs/{job_id}",
    "operationId": "ai-search-namespace-instance-get-job",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/jobs/{job_id}/logs",
    "operationId": "ai-search-namespace-instance-list-job-logs",
    "tags": [
      "AI Search Instances Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id",
      "name"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/stats",
    "operationId": "ai-search-namespace-stats",
    "tags": [
      "AI Search Instances"
    ],
    "pathParams": [
      "id",
      "account_id",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/tokens",
    "operationId": "ai-search-list-tokens",
    "tags": [
      "AI Search Tokens"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai-search/tokens/{id}",
    "operationId": "ai-search-fetch-tokens",
    "tags": [
      "AI Search Tokens"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/authors/search",
    "operationId": "workers-ai-search-author",
    "tags": [
      "Workers AI"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/finetunes",
    "operationId": "workers-ai-list-finetunes",
    "tags": [
      "Workers AI Finetune"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/finetunes/public",
    "operationId": "workers-ai-list-public-finetunes",
    "tags": [
      "Workers AI Finetune"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "offset",
      "orderBy"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/models/schema",
    "operationId": "workers-ai-get-model-schema",
    "tags": [
      "Workers AI"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "model"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/models/search",
    "operationId": "workers-ai-search-model",
    "tags": [
      "Workers AI"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page",
      "page",
      "task",
      "author",
      "source",
      "hide_experimental",
      "search",
      "include_deprecated",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-1",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-1",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-1-internal",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-1-internal",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-2",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-2",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-2-en",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-2-en",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-2-en-ws",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-2-en-ws",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/aura-2-es",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-aura-2-es",
    "tags": [
      "Workers AI Text To Speech"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/flux",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-flux",
    "tags": [
      "Workers AI Automatic Speech Recognition"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/nova-3",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-nova-3",
    "tags": [
      "Workers AI Automatic Speech Recognition"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/nova-3-internal",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-nova-3-internal",
    "tags": [
      "Workers AI Automatic Speech Recognition"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/deepgram/nova-3-ws",
    "operationId": "workers-ai-post-websocket-run-cf-deepgram-nova-3-ws",
    "tags": [
      "Workers AI Automatic Speech Recognition"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/nvidia/nemotron-speech-streaming-en-0.6b",
    "operationId": "workers-ai-post-websocket-run-cf-nvidia-nemotron-speech-streaming-en-0-6b",
    "tags": [
      "Workers AI Automatic Speech Recognition"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/pipecat-ai/smart-turn-v2",
    "operationId": "workers-ai-post-websocket-run-cf-pipecat-ai-smart-turn-v2",
    "tags": [
      "Workers AI Dumb Pipe"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/pipecat-ai/smart-turn-v3",
    "operationId": "workers-ai-post-websocket-run-cf-pipecat-ai-smart-turn-v3",
    "tags": [
      "Workers AI Dumb Pipe"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/sven/test-pipe-http",
    "operationId": "workers-ai-post-websocket-run-cf-sven-test-pipe-http",
    "tags": [
      "Workers AI Text To Image"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/run/@cf/test/hello-world-cog",
    "operationId": "workers-ai-post-websocket-run-cf-test-hello-world-cog",
    "tags": [
      "Workers AI Dumb Pipe"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/tasks/search",
    "operationId": "workers-ai-search-task",
    "tags": [
      "Workers AI"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/ai/tomarkdown/supported",
    "operationId": "workers-ai-get-to-markdown-supported",
    "tags": [
      "Workers AI"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/available_alerts",
    "operationId": "notification-alert-types-get-alert-types",
    "tags": [
      "Notification Alert Types"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/destinations/eligible",
    "operationId": "notification-mechanism-eligibility-get-delivery-mechanism-eligibility",
    "tags": [
      "Notification Mechanism Eligibility"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/destinations/pagerduty",
    "operationId": "notification-destinations-with-pager-duty-list-pager-duty-services",
    "tags": [
      "Notification destinations with PagerDuty"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/destinations/pagerduty/connect/{token_id}",
    "operationId": "notification-destinations-with-pager-duty-connect-pager-duty-token",
    "tags": [
      "Notification destinations with PagerDuty"
    ],
    "pathParams": [
      "account_id",
      "token_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/destinations/webhooks",
    "operationId": "notification-webhooks-list-webhooks",
    "tags": [
      "Notification webhooks"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/destinations/webhooks/{webhook_id}",
    "operationId": "notification-webhooks-get-a-webhook",
    "tags": [
      "Notification webhooks"
    ],
    "pathParams": [
      "account_id",
      "webhook_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/history",
    "operationId": "notification-history-list-history",
    "tags": [
      "Notification History"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page",
      "before",
      "page",
      "since"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/policies",
    "operationId": "notification-policies-list-notification-policies",
    "tags": [
      "Notification policies"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/policies/{policy_id}",
    "operationId": "notification-policies-get-a-notification-policy",
    "tags": [
      "Notification policies"
    ],
    "pathParams": [
      "account_id",
      "policy_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/policies/{policy_id}/email/unsubscribe",
    "operationId": "notification-policies-show-email-unsubscribe-details",
    "tags": [
      "Notification policies"
    ],
    "pathParams": [
      "account_id",
      "policy_id"
    ],
    "queryParams": [
      "email",
      "token"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/silences",
    "operationId": "notification-silences-list-silences",
    "tags": [
      "Notification Silences"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/alerting/v3/silences/{silence_id}",
    "operationId": "notification-silences-get-silence",
    "tags": [
      "Notification Silences"
    ],
    "pathParams": [
      "account_id",
      "silence_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/analytics_engine/sql",
    "operationId": "analytics-engine-sql-query-get",
    "tags": [
      "Analytics Engine"
    ],
    "pathParams": [],
    "queryParams": [
      "query"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces",
    "operationId": "artifacts_namespaces_list",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}",
    "operationId": "artifacts_namespaces_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos",
    "operationId": "artifacts_repos_list",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace"
    ],
    "queryParams": [
      "limit",
      "cursor",
      "search",
      "sort",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}",
    "operationId": "artifacts_repos_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/blob/{hash}",
    "operationId": "artifacts_repos_blob_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name",
      "hash"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/commit/{hash}",
    "operationId": "artifacts_repos_commit_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name",
      "hash"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/file",
    "operationId": "artifacts_repos_file_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name"
    ],
    "queryParams": [
      "ref",
      "path"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/log",
    "operationId": "artifacts_repos_log_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name"
    ],
    "queryParams": [
      "ref",
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/raw/{ref}/{path}",
    "operationId": "artifacts_repos_raw_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name",
      "ref",
      "path"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/tokens",
    "operationId": "artifacts_repo_tokens_list",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name"
    ],
    "queryParams": [
      "state",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/artifacts/namespaces/{namespace}/repos/{name}/tree/{hash}",
    "operationId": "artifacts_repos_tree_get",
    "tags": [
      "Artifacts"
    ],
    "pathParams": [
      "account_id",
      "namespace",
      "name",
      "hash"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/audit_logs",
    "operationId": "audit-logs-get-account-audit-logs",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "export",
      "action.type",
      "actor.ip",
      "actor.email",
      "since",
      "before",
      "zone.name",
      "direction",
      "per_page",
      "page",
      "hide_user_logs"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/autorag/rags/{id}/files",
    "operationId": "autorag-config-files",
    "tags": [
      "AutoRAG RAG"
    ],
    "pathParams": [
      "id",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/autorag/rags/{id}/jobs",
    "operationId": "autorag-config-list-jobs",
    "tags": [
      "AutoRAG Jobs"
    ],
    "pathParams": [
      "id",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/autorag/rags/{id}/jobs/{job_id}",
    "operationId": "autorag-config-get-job",
    "tags": [
      "AutoRAG Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/autorag/rags/{id}/jobs/{job_id}/logs",
    "operationId": "autorag-config-list-job-logs",
    "tags": [
      "AutoRAG Jobs"
    ],
    "pathParams": [
      "id",
      "job_id",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/billable/usage",
    "operationId": "billable-usage-v2-get-account-usage",
    "tags": [
      "Billable Usage V2"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/billing/profile",
    "operationId": "account-billing-profile-(-deprecated)-billing-profile-details",
    "tags": [
      "Account Billing Profile"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/botnet_feed/asn/{asn_id}/day_report",
    "operationId": "botnet-threat-feed-get-day-report",
    "tags": [
      "Botnet Threat Feed"
    ],
    "pathParams": [
      "account_id",
      "asn_id"
    ],
    "queryParams": [
      "date"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/botnet_feed/asn/{asn_id}/full_report",
    "operationId": "botnet-threat-feed-get-full-report",
    "tags": [
      "Botnet Threat Feed"
    ],
    "pathParams": [
      "account_id",
      "asn_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/botnet_feed/configs/asn",
    "operationId": "botnet-threat-feed-list-asn",
    "tags": [
      "Botnet Threat Feed"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/alerts",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/brands",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/brands/patterns",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/domain-info",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/logo-matches",
    "tags": [
      "logo_match"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "logo_id",
      "offset",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/logo-matches/download",
    "tags": [
      "logo_match"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "logo_id",
      "offset",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/logos",
    "tags": [
      "logo_match"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/logos/{logo_id}",
    "tags": [
      "logo_match"
    ],
    "pathParams": [
      "account_id",
      "logo_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/matches",
    "tags": [
      "domain_search"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "offset",
      "limit",
      "include_domain_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/matches/download",
    "tags": [
      "domain_search"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "offset",
      "limit",
      "include_domain_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/queries",
    "tags": [
      "domain_search"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/recent-submissions",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/submission-info",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/total-queries",
    "tags": [
      "domain_search"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/tracked-domains",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/brand-protection/url-info",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/crawl/{job_id}",
    "operationId": "brapi-get_CrawlResult",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "job_id"
    ],
    "queryParams": [
      "cacheTTL",
      "status",
      "cursor",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser",
    "operationId": "brapi-get_DevtoolsBrowserAcquire",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "keep_alive",
      "lab",
      "recording"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}",
    "operationId": "brapi-get_DevtoolsBrowser",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": [
      "keep_alive",
      "lab",
      "recording"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json",
    "operationId": "brapi-get_DevtoolsJson",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/activate/{target_id}",
    "operationId": "brapi-get_DevtoolsJsonActivate",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "session_id",
      "account_id",
      "target_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/close/{target_id}",
    "operationId": "brapi-get_DevtoolsJsonClose",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "session_id",
      "account_id",
      "target_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/list",
    "operationId": "brapi-get_DevtoolsJsonList",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/list/{target_id}",
    "operationId": "brapi-get_DevtoolsJsonTarget",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id",
      "target_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/protocol",
    "operationId": "brapi-get_DevtoolsJsonProtocol",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/json/version",
    "operationId": "brapi-get_DevtoolsJsonVersion",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/browser/{session_id}/page/{target_id}",
    "operationId": "brapi-get_DevtoolsPage",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id",
      "target_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/session",
    "operationId": "brapi-get_DevtoolsSessionList",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/browser-rendering/devtools/session/{session_id}",
    "operationId": "brapi-get_DevtoolsSessionDetails",
    "tags": [
      "brapi"
    ],
    "pathParams": [
      "account_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/account/limits",
    "operationId": "getAccountLimits",
    "tags": [
      "Account"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/builds",
    "operationId": "getBuildsByVersionIds",
    "tags": [
      "Builds"
    ],
    "pathParams": [],
    "queryParams": [
      "version_ids"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/builds/{build_uuid}",
    "operationId": "getBuildByUuid",
    "tags": [
      "Builds"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/builds/{build_uuid}/logs",
    "operationId": "getBuildLogs",
    "tags": [
      "Builds"
    ],
    "pathParams": [],
    "queryParams": [
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/builds/latest",
    "operationId": "getLatestBuildsByScripts",
    "tags": [
      "Builds"
    ],
    "pathParams": [],
    "queryParams": [
      "external_script_ids"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/repos/{provider_type}/{provider_account_id}/{repo_id}/config_autofill",
    "operationId": "getWorkerConfigAutofill",
    "tags": [
      "GitHub Integration"
    ],
    "pathParams": [
      "provider_type",
      "provider_account_id",
      "repo_id"
    ],
    "queryParams": [
      "branch",
      "root_directory"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/tokens",
    "operationId": "listBuildTokens",
    "tags": [
      "Build Tokens"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/triggers/{trigger_uuid}/environment_variables",
    "operationId": "listEnvironmentVariables",
    "tags": [
      "Environment Variables"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/workers/{external_script_id}/builds",
    "operationId": "listBuildsByScript",
    "tags": [
      "Workers"
    ],
    "pathParams": [
      "external_script_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/workers/{external_script_id}/triggers",
    "operationId": "listTriggersByScript",
    "tags": [
      "Workers"
    ],
    "pathParams": [
      "external_script_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/workers/{script_name}/deploy_hooks",
    "operationId": "listDeployHooks",
    "tags": [
      "Deploy Hooks"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/workers/{script_name}/deploy_hooks/{deploy_hook_uuid}",
    "operationId": "getDeployHook",
    "tags": [
      "Deploy Hooks"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/builds/workers/{script_tag}",
    "operationId": "getWorkerBuild",
    "tags": [
      "Workers"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/calls/apps",
    "operationId": "calls-apps-list",
    "tags": [
      "Calls Apps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/calls/apps/{app_id}",
    "operationId": "calls-apps-retrieve-app-details",
    "tags": [
      "Calls Apps"
    ],
    "pathParams": [
      "app_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/calls/turn_keys",
    "operationId": "calls-turn-key-list",
    "tags": [
      "Calls TURN Keys"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/calls/turn_keys/{key_id}",
    "operationId": "calls-retrieve-turn-key-details",
    "tags": [
      "Calls TURN Keys"
    ],
    "pathParams": [
      "key_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel",
    "operationId": "cloudflare-tunnel-list-cloudflare-tunnels",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "is_deleted",
      "existed_at",
      "uuid",
      "was_active_at",
      "was_inactive_at",
      "include_prefix",
      "exclude_prefix",
      "status",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel/{tunnel_id}",
    "operationId": "cloudflare-tunnel-get-a-cloudflare-tunnel",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations",
    "operationId": "cloudflare-tunnel-configuration-get-configuration",
    "tags": [
      "Cloudflare Tunnel Configuration"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections",
    "operationId": "cloudflare-tunnel-list-cloudflare-tunnel-connections",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/connectors/{connector_id}",
    "operationId": "cloudflare-tunnel-get-cloudflare-tunnel-connector",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token",
    "operationId": "cloudflare-tunnel-get-a-cloudflare-tunnel-token",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/challenges/widgets",
    "operationId": "accounts-turnstile-widgets-list",
    "tags": [
      "Turnstile"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction",
      "filter"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/challenges/widgets/{sitekey}",
    "operationId": "accounts-turnstile-widget-get",
    "tags": [
      "Turnstile"
    ],
    "pathParams": [
      "account_id",
      "sitekey"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/binary/{hash}",
    "operationId": "get_BinDBGetBinary",
    "tags": [
      "BinDB"
    ],
    "pathParams": [
      "account_id",
      "hash"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events",
    "operationId": "get_EventListGet",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "cursor",
      "search",
      "page",
      "pageSize",
      "orderBy",
      "order",
      "datasetId",
      "forceRefresh",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/{event_id}",
    "operationId": "get_EventReadDeprecated",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "event_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/{event_id}/raw/{raw_id}",
    "operationId": "get_EventRawRead",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "event_id",
      "raw_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/{event_id}/relationships",
    "operationId": "get_EventRelationships",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "event_id"
    ],
    "queryParams": [
      "direction",
      "maxDepth",
      "relationshipTypes",
      "indicatorTypeIds",
      "datasetId",
      "includeParent",
      "page",
      "pageSize"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/aggregate",
    "operationId": "get_EventAggregate",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "aggregateBy",
      "datasetId",
      "startDate",
      "endDate",
      "groupByDate",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/attackers",
    "operationId": "get_AttackerList",
    "tags": [
      "Attacker"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "datasetIds"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/categories",
    "operationId": "get_CategoryList",
    "tags": [
      "Category"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "datasetIds"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/categories/{category_id}",
    "operationId": "get_CategoryRead",
    "tags": [
      "Category"
    ],
    "pathParams": [
      "account_id",
      "category_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/categories/catalog",
    "operationId": "get_CategoryListComplete",
    "tags": [
      "Category"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/countries",
    "operationId": "get_CountryRead",
    "tags": [
      "Country"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset",
    "operationId": "get_DatasetList",
    "tags": [
      "Dataset"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "includeDeleted"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/-/groups",
    "operationId": "get_GroupList",
    "tags": [
      "Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/-/groups/{group_id}",
    "operationId": "get_GroupRead",
    "tags": [
      "Groups"
    ],
    "pathParams": [
      "account_id",
      "group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/-/groups/{group_id}/members",
    "operationId": "get_GroupMemberList",
    "tags": [
      "Groups"
    ],
    "pathParams": [
      "account_id",
      "group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}",
    "operationId": "get_DatasetRead",
    "tags": [
      "Dataset"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/events/{event_id}",
    "operationId": "get_EventRead",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "dataset_id",
      "event_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/indicators",
    "operationId": "get_IndicatorListLegacy",
    "tags": [
      "Indicator"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": [
      "page",
      "pageSize",
      "name",
      "indicatorType",
      "relatedEvent"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/indicators/{indicator_id}",
    "operationId": "get_IndicatorRead",
    "tags": [
      "Indicator"
    ],
    "pathParams": [
      "account_id",
      "dataset_id",
      "indicator_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/indicators/tags",
    "operationId": "get_IndicatorTagsList",
    "tags": [
      "Indicator"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/permissions",
    "operationId": "get_PermissionList",
    "tags": [
      "Permissions"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/tags/{tag_uuid}/indicators",
    "operationId": "get_DatasetTagIndicatorsList",
    "tags": [
      "Tag"
    ],
    "pathParams": [
      "account_id",
      "tag_uuid",
      "dataset_id"
    ],
    "queryParams": [
      "page",
      "pageSize",
      "indicatorType",
      "relatedEvent",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/dataset/{dataset_id}/targetIndustries",
    "operationId": "get_TargetIndustryListByDataset",
    "tags": [
      "Target Industry"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/graph",
    "operationId": "get_EventGraph",
    "tags": [
      "Events",
      "R2 Catalog"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "nodeType",
      "nodeId",
      "datasetId",
      "relationshipTypes",
      "direction",
      "datasetIds",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/indicator-types",
    "operationId": "get_IndicatorTypesList",
    "tags": [
      "Indicator Types"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "datasetIds"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/indicators",
    "operationId": "get_IndicatorList",
    "tags": [
      "Indicator"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "datasetIds",
      "page",
      "pageSize",
      "search",
      "name",
      "indicatorType",
      "relatedEvents",
      "tags",
      "tagSearch",
      "createdAfter",
      "createdBefore",
      "relatedEventsLimit",
      "includeTags",
      "includeTotalCount",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/indicators/aggregate",
    "operationId": "get_IndicatorAggregate",
    "tags": [
      "Indicator"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "aggregateBy",
      "measure",
      "tagUuid",
      "datasetIds",
      "createdAfter",
      "createdBefore",
      "eventDateAfter",
      "eventDateBefore",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/indicatorTypes",
    "operationId": "get_LegacyIndicatorTypesList",
    "tags": [
      "Indicator Types"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/queries",
    "operationId": "get_EventQueryList",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/queries/{query_id}",
    "operationId": "get_EventQueryRead",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "query_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/raw/{dataset_id}/{event_id}",
    "operationId": "get_EventRawReadDS",
    "tags": [
      "Event"
    ],
    "pathParams": [
      "account_id",
      "event_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/tags",
    "operationId": "get_TagList",
    "tags": [
      "Tag"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "pageSize",
      "search",
      "categoryUuid",
      "filters"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/tags/{tag_uuid}/indicators",
    "operationId": "get_TagIndicatorsList",
    "tags": [
      "Tag"
    ],
    "pathParams": [
      "account_id",
      "tag_uuid"
    ],
    "queryParams": [
      "datasetIds",
      "page",
      "pageSize",
      "indicatorType",
      "relatedEvent",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/tags/categories",
    "operationId": "get_TagCategoryList",
    "tags": [
      "TagCategory"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/targetIndustries",
    "operationId": "get_TargetIndustryList",
    "tags": [
      "Target Industry"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "datasetIds"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/events/targetIndustries/catalog",
    "operationId": "get_TargetIndustryListComplete",
    "tags": [
      "Target Industry"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/exemptions",
    "operationId": "cloudforce-one-get-exemptions",
    "tags": [
      "Exemptions"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/{request_id}",
    "operationId": "cloudforce-one-request-get",
    "tags": [
      "Request for Information (RFI)"
    ],
    "pathParams": [
      "account_id",
      "request_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/{request_id}/asset/{asset_id}",
    "operationId": "cloudforce-one-request-asset-get",
    "tags": [
      "Request for Information (RFI)"
    ],
    "pathParams": [
      "account_id",
      "request_id",
      "asset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/constants",
    "operationId": "cloudforce-one-request-constants",
    "tags": [
      "Request for Information (RFI)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/priority/{priority_id}",
    "operationId": "cloudforce-one-priority-get",
    "tags": [
      "Priority Intelligence Requirements (PIR)"
    ],
    "pathParams": [
      "account_id",
      "priority_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/priority/quota",
    "operationId": "cloudforce-one-priority-quota",
    "tags": [
      "Priority Intelligence Requirements (PIR)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/quota",
    "operationId": "cloudforce-one-request-quota",
    "tags": [
      "Request for Information (RFI)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/requests/types",
    "operationId": "cloudforce-one-request-types",
    "tags": [
      "Request for Information (RFI)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules",
    "operationId": "cloudforce-one-list-rules",
    "tags": [
      "Rules"
    ],
    "pathParams": [],
    "queryParams": [
      "namespace",
      "path",
      "recursive",
      "search",
      "is_public",
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules/{id}",
    "operationId": "cloudforce-one-get-rule",
    "tags": [
      "Rules"
    ],
    "pathParams": [
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules/managed",
    "operationId": "cloudforce-one-get-managed-rules",
    "tags": [
      "Rules"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules/search",
    "operationId": "cloudforce-one-search-rules",
    "tags": [
      "Rules"
    ],
    "pathParams": [],
    "queryParams": [
      "namespace",
      "path",
      "recursive",
      "search",
      "is_public",
      "limit",
      "offset",
      "query",
      "mode",
      "language"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules/stats",
    "operationId": "cloudforce-one-get-rule-stats",
    "tags": [
      "Rules"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/rules/tree",
    "operationId": "cloudforce-one-get-rule-tree",
    "tags": [
      "Rules"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/scans/config",
    "operationId": "get_ConfigFetch",
    "tags": [
      "Scans"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/scans/results/{config_id}",
    "operationId": "get_GetOpenPorts",
    "tags": [
      "Scans"
    ],
    "pathParams": [
      "account_id",
      "config_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/domain/matches",
    "operationId": "get_DomainMatchList",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "offset",
      "limit",
      "query_id",
      "include_domain_id",
      "include_dismissed",
      "domain_search",
      "orderBy",
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/domain/queries",
    "operationId": "get_GetDomainQueries",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/letter/templates",
    "operationId": "get_LetterTemplateList",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/letter/templates/{template_id}",
    "operationId": "get_LetterTemplateGet",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id",
      "template_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/letter/templates/examples",
    "operationId": "get_LetterTemplateExamples",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/logo/matches",
    "operationId": "get_LogoMatchList",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "offset",
      "limit",
      "query_id",
      "download",
      "orderBy",
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/logo/queries",
    "operationId": "get_GetLogoQueries",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "download"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/takedown-notices",
    "operationId": "get_TakedownNoticeList",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/takedown-notices/{notice_id}",
    "operationId": "get_TakedownNoticeGet",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id",
      "notice_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/takedown-notices/{notice_id}/letters",
    "operationId": "get_TakedownLetterList",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id",
      "notice_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/takedown-notices/{notice_id}/letters/{letter_id}",
    "operationId": "get_TakedownLetterGet",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id",
      "notice_id",
      "letter_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/takedown-notices/{notice_id}/letters/{letter_id}/pdf",
    "operationId": "get_TakedownLetterPdfGet",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id",
      "notice_id",
      "letter_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/brand-protection/total-queries",
    "operationId": "get_TotalQueries",
    "tags": [
      "Brand Protection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/collections",
    "operationId": "get_CollectionList",
    "tags": [
      "Collections"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/collections/{collection_id}",
    "operationId": "get_CollectionGet",
    "tags": [
      "Collections"
    ],
    "pathParams": [
      "account_id",
      "collection_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/collections/{collection_id}/export",
    "operationId": "get_CollectionExportEndpoint",
    "tags": [
      "Collections"
    ],
    "pathParams": [
      "account_id",
      "collection_id"
    ],
    "queryParams": [
      "include_ids"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/collections/{collection_id}/items",
    "operationId": "get_ItemQuery",
    "tags": [
      "Collections"
    ],
    "pathParams": [
      "account_id",
      "collection_id"
    ],
    "queryParams": [
      "cursor",
      "limit",
      "q"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cloudforce-one/v2/collections/{collection_id}/items/{item_id}",
    "operationId": "get_ItemGet",
    "tags": [
      "Collections"
    ],
    "pathParams": [
      "account_id",
      "collection_id",
      "item_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/cnis",
    "operationId": "list_cnis",
    "tags": [
      "CNIs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "slot",
      "tunnel_id",
      "cursor",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/cnis/{cni}",
    "operationId": "get_cni",
    "tags": [
      "CNIs"
    ],
    "pathParams": [
      "cni",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/interconnects",
    "operationId": "list_interconnects",
    "tags": [
      "Interconnects"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "site",
      "type",
      "cursor",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/interconnects/{icon}",
    "operationId": "get_interconnect",
    "tags": [
      "Interconnects"
    ],
    "pathParams": [
      "icon",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/interconnects/{icon}/loa",
    "operationId": "get_interconnect_loa",
    "tags": [
      "Interconnects"
    ],
    "pathParams": [
      "icon",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/interconnects/{icon}/status",
    "operationId": "get_interconnect_status",
    "tags": [
      "Interconnects"
    ],
    "pathParams": [
      "icon",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/settings",
    "operationId": "get_settings",
    "tags": [
      "Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/slots",
    "operationId": "list_slots",
    "tags": [
      "Slots"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "address_contains",
      "site",
      "speed",
      "occupied",
      "cursor",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/cni/slots/{slot}",
    "operationId": "get_slot",
    "tags": [
      "Slots"
    ],
    "pathParams": [
      "slot",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/connectivity/directory/services",
    "operationId": "connectivity-services-list",
    "tags": [
      "Connectivity Services"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "type",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/connectivity/directory/services/{service_id}",
    "operationId": "connectivity-services-get",
    "tags": [
      "Connectivity Services"
    ],
    "pathParams": [
      "account_id",
      "service_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/containers/applications",
    "operationId": "listApplications",
    "tags": [
      "Applications"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "image",
      "label"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/containers/applications/{application_id}",
    "operationId": "getApplication",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "application_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/containers/applications/{application_id}/versions",
    "operationId": "listApplicationVersions",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "application_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/containers/instances/{instance_id}/ssh",
    "operationId": "containerWranglerSsh",
    "tags": [
      "Deployments"
    ],
    "pathParams": [
      "instance_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/containers/registries",
    "operationId": "listImageRegistries",
    "tags": [
      "Image Registries"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/custom_csrs",
    "operationId": "custom-csrs-for-an-account-list-custom-csrs",
    "tags": [
      "Custom CSRs for an Account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/custom_csrs/{custom_csr_id}",
    "operationId": "custom-csrs-for-an-account-custom-csr-details",
    "tags": [
      "Custom CSRs for an Account"
    ],
    "pathParams": [
      "custom_csr_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/custom_ns",
    "operationId": "account-level-custom-nameservers-list-account-custom-nameservers",
    "tags": [
      "Account-Level Custom Nameservers"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/d1/database",
    "operationId": "d1-list-databases",
    "tags": [
      "D1"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/d1/database/{database_id}",
    "operationId": "d1-get-database",
    "tags": [
      "D1"
    ],
    "pathParams": [
      "account_id",
      "database_id"
    ],
    "queryParams": [
      "fields"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/d1/database/{database_id}/time_travel/bookmark",
    "operationId": "d1-time-travel-get-bookmark",
    "tags": [
      "D1"
    ],
    "pathParams": [
      "account_id",
      "database_id"
    ],
    "queryParams": [
      "timestamp"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices",
    "operationId": "devices-list-devices",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/{device_id}",
    "operationId": "devices-device-details",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "device_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/{device_id}/override_codes",
    "operationId": "devices-list-admin-override-code-for-device",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "device_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/client-versions",
    "operationId": "list-client-versions",
    "tags": [
      "Client Versions"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "target_environment",
      "release_track",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/client-versions/target-environments",
    "operationId": "list-client-target-environments",
    "tags": [
      "Client Versions"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/deployment-groups",
    "operationId": "list-deployment-groups",
    "tags": [
      "Deployment Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/deployment-groups/{group_id}",
    "operationId": "get-deployment-group",
    "tags": [
      "Deployment Groups"
    ],
    "pathParams": [
      "account_id",
      "group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/ip-profiles",
    "operationId": "list-ip-profiles",
    "tags": [
      "IP Profiles"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/ip-profiles/{profile_id}",
    "operationId": "get-ip-profile",
    "tags": [
      "IP Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/networks",
    "operationId": "device-managed-networks-list-device-managed-networks",
    "tags": [
      "Device Managed Networks"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/networks/{network_id}",
    "operationId": "device-managed-networks-device-managed-network-details",
    "tags": [
      "Device Managed Networks"
    ],
    "pathParams": [
      "network_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/physical-devices",
    "operationId": "list-devices",
    "tags": [
      "Physical Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/physical-devices/{device_id}",
    "operationId": "get-device",
    "tags": [
      "Physical Devices"
    ],
    "pathParams": [
      "device_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policies",
    "operationId": "devices-list-device-settings-policies",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy",
    "operationId": "devices-get-default-device-settings-policy",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/{policy_id}",
    "operationId": "devices-get-device-settings-policy-by-id",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "policy_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/{policy_id}/exclude",
    "operationId": "devices-get-split-tunnel-exclude-list-for-a-device-settings-policy",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "policy_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/{policy_id}/fallback_domains",
    "operationId": "devices-get-local-domain-fallback-list-for-a-device-settings-policy",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "policy_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/{policy_id}/include",
    "operationId": "devices-get-split-tunnel-include-list-for-a-device-settings-policy",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "policy_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/exclude",
    "operationId": "devices-get-split-tunnel-exclude-list",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/fallback_domains",
    "operationId": "devices-get-local-domain-fallback-list",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/policy/include",
    "operationId": "devices-get-split-tunnel-include-list",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/posture",
    "operationId": "device-posture-rules-list-device-posture-rules",
    "tags": [
      "Device posture rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/posture/{rule_id}",
    "operationId": "device-posture-rules-device-posture-rules-details",
    "tags": [
      "Device posture rules"
    ],
    "pathParams": [
      "rule_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/posture/integration",
    "operationId": "device-posture-integrations-list-device-posture-integrations",
    "tags": [
      "Device Posture Integrations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/posture/integration/{integration_id}",
    "operationId": "device-posture-integrations-device-posture-integration-details",
    "tags": [
      "Device Posture Integrations"
    ],
    "pathParams": [
      "integration_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/registrations",
    "operationId": "list-registrations",
    "tags": [
      "Registrations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/registrations/{registration_id}",
    "operationId": "get-registration",
    "tags": [
      "Registrations"
    ],
    "pathParams": [
      "registration_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/registrations/{registration_id}/override_codes",
    "operationId": "get-registration-override-codes",
    "tags": [
      "warp-teams-device-api_other"
    ],
    "pathParams": [
      "account_id",
      "registration_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/resilience/disconnect",
    "operationId": "devices-resilience-retrieve-global-warp-override",
    "tags": [
      "Devices Resilience"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/devices/settings",
    "operationId": "zero-trust-accounts-get-device-settings-for-zero-trust-account",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/colos",
    "operationId": "dex-endpoints-list-colos",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "from",
      "to",
      "sortBy"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/commands",
    "operationId": "get-commands",
    "tags": [
      "DEX Remote Commands"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "from",
      "to",
      "device_id",
      "user_email",
      "command_type",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/commands/{command_id}/downloads/{filename}",
    "operationId": "get-commands-command-id-downloads-filename",
    "tags": [
      "DEX Remote Commands"
    ],
    "pathParams": [
      "account_id",
      "command_id",
      "filename"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/commands/devices",
    "operationId": "get-commands-eligible-devices",
    "tags": [
      "DEX Remote Commands"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/commands/quota",
    "operationId": "get-commands-quota",
    "tags": [
      "DEX Remote Commands"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/devices/{device_id}/fleet-status/live",
    "operationId": "devices-live-status",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "device_id"
    ],
    "queryParams": [
      "since_minutes",
      "time_now",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/devices/{device_id}/fleet-status/over-time",
    "operationId": "dex-device-status-over-time",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "device_id"
    ],
    "queryParams": [
      "from",
      "to",
      "interval",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/devices/{device_id}/isps",
    "operationId": "dex-endpoints-list-device-isps",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "device_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "cursor",
      "sort_by",
      "sort_order",
      "from",
      "to"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/devices/dex_tests",
    "operationId": "device-dex-test-details",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "testName",
      "kind"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/devices/dex_tests/{dex_test_id}",
    "operationId": "device-dex-test-get-device-dex-test",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "dex_test_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/fleet-status/devices",
    "operationId": "dex-fleet-status-devices",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "to",
      "from",
      "page",
      "per_page",
      "sort_by",
      "colo",
      "device_id",
      "mode",
      "status",
      "platform",
      "version",
      "source"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/fleet-status/live",
    "operationId": "dex-fleet-status-live",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "since_minutes"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/fleet-status/over-time",
    "operationId": "dex-fleet-status-over-time",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "to",
      "from",
      "colo",
      "device_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/http-tests/{test_id}",
    "operationId": "dex-endpoints-http-test-details",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_id"
    ],
    "queryParams": [
      "deviceId",
      "from",
      "to",
      "interval",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/http-tests/{test_id}/percentiles",
    "operationId": "dex-endpoints-http-test-percentiles",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_id"
    ],
    "queryParams": [
      "deviceId",
      "from",
      "to",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/rules",
    "operationId": "list-dex-rules",
    "tags": [
      "DEX Rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "sort_order",
      "sort_by",
      "name"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/rules/{rule_id}",
    "operationId": "get-dex-rule",
    "tags": [
      "DEX Rules"
    ],
    "pathParams": [
      "account_id",
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/tests/overview",
    "operationId": "dex-endpoints-list-tests-overview",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "colo",
      "testName",
      "deviceId",
      "registration_id",
      "page",
      "per_page",
      "kind"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/tests/unique-devices",
    "operationId": "dex-endpoints-tests-unique-devices",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "testName",
      "deviceId"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/traceroute-test-results/{test_result_id}/network-path",
    "operationId": "dex-endpoints-traceroute-test-result-network-path",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_result_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/traceroute-tests/{test_id}",
    "operationId": "dex-endpoints-traceroute-test-details",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_id"
    ],
    "queryParams": [
      "deviceId",
      "from",
      "to",
      "interval",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/traceroute-tests/{test_id}/network-path",
    "operationId": "dex-endpoints-traceroute-test-network-path",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_id"
    ],
    "queryParams": [
      "deviceId",
      "from",
      "to",
      "interval"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/traceroute-tests/{test_id}/percentiles",
    "operationId": "dex-endpoints-traceroute-test-percentiles",
    "tags": [
      "DEX Synthetic Application Monitoring"
    ],
    "pathParams": [
      "account_id",
      "test_id"
    ],
    "queryParams": [
      "deviceId",
      "from",
      "to",
      "colo"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dex/warp-change-events",
    "operationId": "list-warp-change-events",
    "tags": [
      "WARP Change Events"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "from",
      "to",
      "type",
      "toggle",
      "config_name",
      "account_name",
      "sort_order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/diagnostics/endpoint-healthchecks",
    "operationId": "diagnostics-endpoint-healthcheck-list",
    "tags": [
      "Endpoint Health Checks"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/diagnostics/endpoint-healthchecks/{id}",
    "operationId": "diagnostics-endpoint-healthcheck-get",
    "tags": [
      "Endpoint Health Checks"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/custom_prompt_topics",
    "operationId": "dlp-custom-prompt-topics-list",
    "tags": [
      "DLP Custom Prompt Topics"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/custom_prompt_topics/{entry_id}",
    "operationId": "dlp-custom-prompt-topics-get",
    "tags": [
      "DLP Custom Prompt Topics"
    ],
    "pathParams": [
      "account_id",
      "entry_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_classes",
    "operationId": "dlp-data-classes-list",
    "tags": [
      "DLP Data Classes"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_classes/{data_class_id}",
    "operationId": "dlp-data-classes-read",
    "tags": [
      "DLP Data Classes"
    ],
    "pathParams": [
      "account_id",
      "data_class_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_categories",
    "operationId": "dlp-data-tag-categories-list",
    "tags": [
      "DLP Data Tag Categories"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_categories/{category_id}",
    "operationId": "dlp-data-tag-categories-read",
    "tags": [
      "DLP Data Tag Categories"
    ],
    "pathParams": [
      "account_id",
      "category_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_categories/{category_id}/data_tags",
    "operationId": "dlp-data-tags-list",
    "tags": [
      "DLP Data Tags"
    ],
    "pathParams": [
      "account_id",
      "category_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_categories/{category_id}/data_tags/{tag_id}",
    "operationId": "dlp-data-tags-read",
    "tags": [
      "DLP Data Tags"
    ],
    "pathParams": [
      "account_id",
      "category_id",
      "tag_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_category_templates",
    "operationId": "dlp-data-tag-category-templates-list",
    "tags": [
      "DLP Data Tag Category Templates"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/data_tag_category_templates/{template_id}",
    "operationId": "dlp-data-tag-category-template-read",
    "tags": [
      "DLP Data Tag Category Templates"
    ],
    "pathParams": [
      "account_id",
      "template_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/datasets",
    "operationId": "dlp-datasets-read-all",
    "tags": [
      "DLP Datasets"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/datasets/{dataset_id}",
    "operationId": "dlp-datasets-read",
    "tags": [
      "DLP Datasets"
    ],
    "pathParams": [
      "account_id",
      "dataset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/document_fingerprints",
    "operationId": "dlp-document-fingerprints-read-all",
    "tags": [
      "DLP Document Fingerprints"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/document_fingerprints/{document_fingerprint_id}",
    "operationId": "dlp-document-fingerprints-read",
    "tags": [
      "DLP Document Fingerprints"
    ],
    "pathParams": [
      "account_id",
      "document_fingerprint_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/email/account_mapping",
    "operationId": "dlp-email-scanner-get-account-mapping",
    "tags": [
      "DLP Email"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/email/rules",
    "operationId": "dlp-email-scanner-list-all-rules",
    "tags": [
      "DLP Email"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/email/rules/{rule_id}",
    "operationId": "dlp-email-scanner-get-rule",
    "tags": [
      "DLP Email"
    ],
    "pathParams": [
      "account_id",
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/entries",
    "operationId": "dlp-entries-list-all-entries",
    "tags": [
      "DLP Entries"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/entries/{entry_id}",
    "operationId": "dlp-entries-get-dlp-entry",
    "tags": [
      "DLP Entries"
    ],
    "pathParams": [
      "account_id",
      "entry_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/limits",
    "operationId": "dlp-limits-get",
    "tags": [
      "DLP Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/payload_log",
    "operationId": "dlp-payload-log-get",
    "tags": [
      "DLP Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles",
    "operationId": "dlp-profiles-list-all-profiles",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "all"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles/{profile_id}",
    "operationId": "dlp-profiles-get-dlp-profile",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles/custom",
    "operationId": "dlp-profiles-list-all-custom-profiles",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles/custom/{profile_id}",
    "operationId": "dlp-profiles-get-custom-profile",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles/predefined/{profile_id}",
    "operationId": "dlp-profiles-get-predefined-profile",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/profiles/predefined/{profile_id}/config",
    "operationId": "dlp-profiles-get-predefined-profile-config",
    "tags": [
      "DLP Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups",
    "operationId": "dlp-sensitivity-groups-list",
    "tags": [
      "DLP Sensitivity Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/{sensitivity_group_id}",
    "operationId": "dlp-sensitivity-groups-read",
    "tags": [
      "DLP Sensitivity Groups"
    ],
    "pathParams": [
      "account_id",
      "sensitivity_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/{sensitivity_group_id}/level_order",
    "operationId": "dlp-sensitivity-groups-get-level-order",
    "tags": [
      "DLP Sensitivity Groups"
    ],
    "pathParams": [
      "account_id",
      "sensitivity_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/{sensitivity_group_id}/levels",
    "operationId": "dlp-sensitivity-levels-list",
    "tags": [
      "DLP Sensitivity Levels"
    ],
    "pathParams": [
      "account_id",
      "sensitivity_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/{sensitivity_group_id}/levels/{sensitivity_level_id}",
    "operationId": "dlp-sensitivity-levels-read",
    "tags": [
      "DLP Sensitivity Levels"
    ],
    "pathParams": [
      "account_id",
      "sensitivity_group_id",
      "sensitivity_level_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/templates",
    "operationId": "dlp-sensitivity-group-templates-list",
    "tags": [
      "DLP Sensitivity Group Templates"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/sensitivity_groups/templates/{template_id}",
    "operationId": "dlp-sensitivity-group-template-read",
    "tags": [
      "DLP Sensitivity Group Templates"
    ],
    "pathParams": [
      "account_id",
      "template_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dlp/settings",
    "operationId": "dlp-settings-get",
    "tags": [
      "DLP Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dls/regional_services/prefix_bindings",
    "operationId": "publicListPrefixBindings",
    "tags": [
      "Prefix Bindings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "cursor",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dls/regional_services/prefix_bindings/{binding_id}",
    "operationId": "publicGetPrefixBinding",
    "tags": [
      "Prefix Bindings"
    ],
    "pathParams": [
      "account_id",
      "binding_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dls/regions",
    "operationId": "publicListRegions",
    "tags": [
      "Regions"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "cursor",
      "per_page",
      "type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dls/regions/{region_id}",
    "operationId": "publicGetRegion",
    "tags": [
      "Regions"
    ],
    "pathParams": [
      "account_id",
      "region_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_firewall",
    "operationId": "dns-firewall-list-dns-firewall-clusters",
    "tags": [
      "DNS Firewall"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_firewall/{dns_firewall_id}",
    "operationId": "dns-firewall-dns-firewall-cluster-details",
    "tags": [
      "DNS Firewall"
    ],
    "pathParams": [
      "dns_firewall_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_firewall/{dns_firewall_id}/dns_analytics/report",
    "operationId": "dns-firewall-analytics-table",
    "tags": [
      "DNS Firewall Analytics"
    ],
    "pathParams": [
      "dns_firewall_id",
      "account_id"
    ],
    "queryParams": [
      "metrics",
      "dimensions",
      "since",
      "until",
      "limit",
      "sort",
      "filters"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_firewall/{dns_firewall_id}/dns_analytics/report/bytime",
    "operationId": "dns-firewall-analytics-by-time",
    "tags": [
      "DNS Firewall Analytics"
    ],
    "pathParams": [
      "dns_firewall_id",
      "account_id"
    ],
    "queryParams": [
      "metrics",
      "dimensions",
      "since",
      "until",
      "limit",
      "sort",
      "filters",
      "time_delta"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_firewall/{dns_firewall_id}/reverse_dns",
    "operationId": "dns-firewall-show-dns-firewall-cluster-reverse-dns",
    "tags": [
      "DNS Firewall"
    ],
    "pathParams": [
      "dns_firewall_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_records/usage",
    "operationId": "dns-records-for-an-account-get-usage",
    "tags": [
      "DNS Records for an Account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_settings",
    "operationId": "dns-settings-for-an-account-list-dns-settings",
    "tags": [
      "DNS Settings for an Account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_settings/views",
    "operationId": "dns-views-for-an-account-list-internal-dns-views",
    "tags": [
      "DNS Internal Views for an Account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "name.exact",
      "name.contains",
      "name.startswith",
      "name.endswith",
      "zone_id",
      "zone_name",
      "match",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/dns_settings/views/{view_id}",
    "operationId": "dns-views-for-an-account-get-internal-dns-view",
    "tags": [
      "DNS Internal Views for an Account"
    ],
    "pathParams": [
      "account_id",
      "view_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate",
    "operationId": "email_security_investigate",
    "tags": [
      "Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "start",
      "end",
      "query",
      "detections_only",
      "final_disposition",
      "metric",
      "message_action",
      "recipient",
      "sender",
      "alert_id",
      "domain",
      "message_id",
      "subject",
      "delivery_status",
      "cursor",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}",
    "operationId": "email_security_get_message",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}/action_log",
    "operationId": "email_security_get_message_action_log",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}/detections",
    "operationId": "email_security_get_message_detections",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}/preview",
    "operationId": "email_security_get_message_preview",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}/raw",
    "operationId": "email_security_get_message_raw",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/{investigate_id}/trace",
    "operationId": "email_security_get_message_trace",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "investigate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/bulk",
    "operationId": "email_security_get_bulk_jobs",
    "tags": [
      "Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "action_type",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/bulk/{job_id}",
    "operationId": "email_security_get_bulk_job",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "job_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/investigate/bulk/{job_id}/messages",
    "operationId": "email_security_get_bulk_job_messages",
    "tags": [
      "Email Security"
    ],
    "pathParams": [
      "job_id"
    ],
    "queryParams": [
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/phishguard/reports",
    "operationId": "email_security_get_phishguard_reports",
    "tags": [
      "Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "start",
      "end",
      "from_date",
      "to_date"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/allow_policies",
    "operationId": "email_security_list_allow_policies",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order",
      "is_exempt_recipient",
      "is_trusted_sender",
      "is_acceptable_sender",
      "verify_sender",
      "pattern_type",
      "pattern"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/allow_policies/{policy_id}",
    "operationId": "email_security_get_allow_policy",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "policy_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/block_senders",
    "operationId": "email_security_list_blocked_senders",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order",
      "pattern_type",
      "pattern"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/block_senders/{pattern_id}",
    "operationId": "email_security_get_blocked_sender",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "pattern_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/domains",
    "operationId": "email_security_list_domains",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order",
      "allowed_delivery_mode",
      "domain",
      "active_delivery_mode",
      "integration_id",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/domains/{domain_id}",
    "operationId": "email_security_get_domain",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "domain_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/impersonation_registry",
    "operationId": "email_security_list_impersonation_registry",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order",
      "provenance"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/impersonation_registry/{impersonation_registry_id}",
    "operationId": "email_security_get_impersonation_registry",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "impersonation_registry_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/sending_domain_restrictions",
    "operationId": "email_security_list_sending_domain_restrictions",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/sending_domain_restrictions/{sending_domain_restriction_id}",
    "operationId": "email_security_get_sending_domain_restriction",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "sending_domain_restriction_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/trusted_domains",
    "operationId": "email_security_list_trusted_domains",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "order",
      "is_recent",
      "is_similarity",
      "pattern"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/trusted_domains/{trusted_domain_id}",
    "operationId": "email_security_get_trusted_domain",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "trusted_domain_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/url_ignore_patterns",
    "operationId": "email_security_list_url_ignore_patterns",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/settings/url_ignore_patterns/{pattern_id}",
    "operationId": "email_security_get_url_ignore_pattern",
    "tags": [
      "Email Security Settings"
    ],
    "pathParams": [
      "pattern_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email-security/submissions",
    "operationId": "email_security_submissions",
    "tags": [
      "Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "start",
      "end",
      "type",
      "submission_id",
      "original_disposition",
      "requested_disposition",
      "outcome_disposition",
      "status",
      "query",
      "escalated_from_user"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/routing/addresses",
    "operationId": "email-routing-destination-addresses-list-destination-addresses",
    "tags": [
      "Email Routing destination addresses"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "direction",
      "verified"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/routing/addresses/{destination_address_identifier}",
    "operationId": "email-routing-destination-addresses-get-a-destination-address",
    "tags": [
      "Email Routing destination addresses"
    ],
    "pathParams": [
      "destination_address_identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/routing/rules",
    "operationId": "email-routing-routing-rules-list-account-routing-rules",
    "tags": [
      "Email Routing routing rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "enabled"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/routing/suppression",
    "operationId": "get_publicListSuppressionRouting",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/routing/suppression/{suppression_id}",
    "operationId": "get_publicGetSuppressionRouting",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "account_id",
      "suppression_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/sending/feedback",
    "operationId": "get_publicFeedbackStatus",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "start_at",
      "end_at"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/sending/limits",
    "operationId": "email-sending-get-sending-limits",
    "tags": [
      "Email Sending"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/sending/suppression",
    "operationId": "get_publicListSuppressionSending",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/email/sending/suppression/{suppression_id}",
    "operationId": "get_publicGetSuppressionSending",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "account_id",
      "suppression_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/event_notifications/r2/{bucket_name}/configuration",
    "operationId": "r2-get-event-notification-configs",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/event_notifications/r2/{bucket_name}/configuration/queues/{queue_id}",
    "operationId": "r2-get-event-notification-config",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "queue_id",
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/event_subscriptions/subscriptions",
    "operationId": "subscriptions-list",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/event_subscriptions/subscriptions/{subscription_id}",
    "operationId": "subscriptions-get",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "account_id",
      "subscription_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/firewall/access_rules/rules",
    "operationId": "ip-access-rules-for-an-account-list-ip-access-rules",
    "tags": [
      "IP Access rules for an account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "mode",
      "configuration.target",
      "configuration.value",
      "notes",
      "match",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/firewall/access_rules/rules/{rule_id}",
    "operationId": "ip-access-rules-for-an-account-get-an-ip-access-rule",
    "tags": [
      "IP Access rules for an account"
    ],
    "pathParams": [
      "rule_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps",
    "operationId": "flagship_list_apps",
    "tags": [
      "Apps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps/{app_id}",
    "operationId": "flagship_get_app",
    "tags": [
      "Apps"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps/{app_id}/evaluate",
    "operationId": "flagship_evaluate_flag",
    "tags": [
      "Evaluation"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "flagKey",
      "targetingKey"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps/{app_id}/flags",
    "operationId": "flagship_list_flags",
    "tags": [
      "Flags"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps/{app_id}/flags/{flag_key}",
    "operationId": "flagship_get_flag",
    "tags": [
      "Flags"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "flag_key"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/flagship/apps/{app_id}/flags/{flag_key}/changelog",
    "operationId": "flagship_get_flag_changelog",
    "tags": [
      "Changelog"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "flag_key"
    ],
    "queryParams": [
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway",
    "operationId": "zero-trust-accounts-get-zero-trust-account-information",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/app_types",
    "operationId": "zero-trust-gateway-application-and-application-type-mappings-list-application-and-application-type-mappings",
    "tags": [
      "Zero Trust Gateway application and application type mappings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/apps/review_status",
    "operationId": "zero-trust-applications-review-status-list",
    "tags": [
      "Zero Trust applications review status"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/audit_ssh_settings",
    "operationId": "zero-trust-get-audit-ssh-settings",
    "tags": [
      "Zero Trust SSH Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/categories",
    "operationId": "zero-trust-gateway-categories-list-categories",
    "tags": [
      "Zero Trust Gateway categories"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/certificates",
    "operationId": "zero-trust-certificates-list-zero-trust-certificates",
    "tags": [
      "Zero Trust certificates"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/certificates/{certificate_id}",
    "operationId": "zero-trust-certificates-zero-trust-certificate-details",
    "tags": [
      "Zero Trust certificates"
    ],
    "pathParams": [
      "certificate_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/configuration",
    "operationId": "zero-trust-accounts-get-zero-trust-account-configuration",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/configuration/custom_certificate",
    "operationId": "zero-trust-accounts-get-zero-trust-certificate-configuration",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/dns_destination_ips",
    "operationId": "zero-trust-dns-destination-ips-list-dns-destination-ips",
    "tags": [
      "Zero Trust Gateway DNS destination IPv4 address pairs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/egress_cidr_pairs",
    "operationId": "zero-trust-accounts-get-egress-cidr-pairs",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/lists",
    "operationId": "zero-trust-lists-list-zero-trust-lists",
    "tags": [
      "Zero Trust lists"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/lists/{list_id}",
    "operationId": "zero-trust-lists-zero-trust-list-details",
    "tags": [
      "Zero Trust lists"
    ],
    "pathParams": [
      "list_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/lists/{list_id}/items",
    "operationId": "zero-trust-lists-zero-trust-list-items",
    "tags": [
      "Zero Trust lists"
    ],
    "pathParams": [
      "list_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/locations",
    "operationId": "zero-trust-gateway-locations-list-zero-trust-gateway-locations",
    "tags": [
      "Zero Trust Gateway locations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/locations/{location_id}",
    "operationId": "zero-trust-gateway-locations-zero-trust-gateway-location-details",
    "tags": [
      "Zero Trust Gateway locations"
    ],
    "pathParams": [
      "location_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/logging",
    "operationId": "zero-trust-accounts-get-logging-settings-for-the-zero-trust-account",
    "tags": [
      "Zero Trust accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/operations",
    "operationId": "zero-trust-gateway-operations-list-zero-trust-gateway-operations",
    "tags": [
      "Zero Trust Gateway operations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/operations/{operation_id}",
    "operationId": "zero-trust-gateway-operations-zero-trust-gateway-operation-details",
    "tags": [
      "Zero Trust Gateway operations"
    ],
    "pathParams": [
      "operation_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/pacfiles",
    "operationId": "zero-trust-gateway-pacfiles-list",
    "tags": [
      "Zero Trust Gateway PAC files"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/pacfiles/{pacfile_id}",
    "operationId": "zero-trust-gateway-pacfiles-details",
    "tags": [
      "Zero Trust Gateway PAC files"
    ],
    "pathParams": [
      "pacfile_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/proxy_endpoints",
    "operationId": "zero-trust-gateway-proxy-endpoints-list-proxy-endpoints",
    "tags": [
      "Zero Trust Gateway proxy endpoints"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/proxy_endpoints/{proxy_endpoint_id}",
    "operationId": "zero-trust-gateway-proxy-endpoints-proxy-endpoint-details",
    "tags": [
      "Zero Trust Gateway proxy endpoints"
    ],
    "pathParams": [
      "proxy_endpoint_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/rules",
    "operationId": "zero-trust-gateway-rules-list-zero-trust-gateway-rules",
    "tags": [
      "Zero Trust Gateway rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/rules/{rule_id}",
    "operationId": "zero-trust-gateway-rules-zero-trust-gateway-rule-details",
    "tags": [
      "Zero Trust Gateway rules"
    ],
    "pathParams": [
      "rule_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/gateway/rules/tenant",
    "operationId": "zero-trust-gateway-rules-list-zero-trust-gateway-rules-tenant",
    "tags": [
      "Zero Trust Gateway rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/hyperdrive/configs",
    "operationId": "list-hyperdrive",
    "tags": [
      "Hyperdrive"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/hyperdrive/configs/{hyperdrive_id}",
    "operationId": "get-hyperdrive",
    "tags": [
      "Hyperdrive"
    ],
    "pathParams": [
      "account_id",
      "hyperdrive_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/permission_groups",
    "operationId": "account-permission-group-list",
    "tags": [
      "Account Permission Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "name",
      "label",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/permission_groups/{permission_group_id}",
    "operationId": "account-permission-group-details",
    "tags": [
      "Account Permission Groups"
    ],
    "pathParams": [
      "account_id",
      "permission_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/resource_groups",
    "operationId": "account-resource-group-list",
    "tags": [
      "Account Resource Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "name"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/resource_groups/{resource_group_id}",
    "operationId": "account-resource-group-details",
    "tags": [
      "Account Resource Groups"
    ],
    "pathParams": [
      "account_id",
      "resource_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/user_groups",
    "operationId": "account-user-group-list",
    "tags": [
      "Account User Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "name",
      "fuzzyName",
      "page",
      "per_page",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/user_groups/{user_group_id}",
    "operationId": "account-user-group-details",
    "tags": [
      "Account User Groups"
    ],
    "pathParams": [
      "account_id",
      "user_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/user_groups/{user_group_id}/members",
    "operationId": "account-user-group-member-list",
    "tags": [
      "Account User Group Members"
    ],
    "pathParams": [
      "account_id",
      "user_group_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "fuzzyEmail",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/iam/user_groups/{user_group_id}/members/{member_id}",
    "operationId": "account-user-group-member-get",
    "tags": [
      "Account User Group Members"
    ],
    "pathParams": [
      "account_id",
      "user_group_id",
      "member_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1",
    "operationId": "cloudflare-images-list-images",
    "tags": [
      "Cloudflare Images"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "creator"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/{image_id}",
    "operationId": "cloudflare-images-image-details",
    "tags": [
      "Cloudflare Images"
    ],
    "pathParams": [
      "image_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/{image_id}/blob",
    "operationId": "cloudflare-images-base-image",
    "tags": [
      "Cloudflare Images"
    ],
    "pathParams": [
      "image_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/keys",
    "operationId": "cloudflare-images-keys-list-signing-keys",
    "tags": [
      "Cloudflare Images Keys"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/stats",
    "operationId": "cloudflare-images-images-usage-statistics",
    "tags": [
      "Cloudflare Images"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/variants",
    "operationId": "cloudflare-images-variants-list-variants",
    "tags": [
      "Cloudflare Images Variants"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/variants/{variant_id}",
    "operationId": "cloudflare-images-variants-variant-details",
    "tags": [
      "Cloudflare Images Variants"
    ],
    "pathParams": [
      "variant_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v1/variants/{variant_id}/flat",
    "operationId": "cloudflare-images-variants-variant-details-flat",
    "tags": [
      "Cloudflare Images Variants"
    ],
    "pathParams": [
      "variant_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/images/v2",
    "operationId": "cloudflare-images-list-images-v2",
    "tags": [
      "Cloudflare Images"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "continuation_token",
      "per_page",
      "sort_order",
      "creator",
      "meta.<field>[<operator>]"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/infrastructure/targets",
    "operationId": "infra-targets-list",
    "tags": [
      "Infrastructure Access Targets"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "hostname",
      "hostname_contains",
      "virtual_network_id",
      "ip_v4",
      "ip_v6",
      "created_before",
      "created_after",
      "modified_before",
      "modified_after",
      "ips",
      "target_ids",
      "ip_like",
      "ipv4_start",
      "ipv4_end",
      "ipv6_start",
      "ipv6_end",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/infrastructure/targets/{target_id}",
    "operationId": "infra-targets-get",
    "tags": [
      "Infrastructure Access Targets"
    ],
    "pathParams": [
      "account_id",
      "target_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/asn/{asn}",
    "operationId": "asn-intelligence-get-asn-overview",
    "tags": [
      "ASN Intelligence"
    ],
    "pathParams": [
      "asn",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/asn/{asn}/subnets",
    "operationId": "asn-intelligence-get-asn-subnets",
    "tags": [
      "ASN Intelligence"
    ],
    "pathParams": [
      "asn",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/attack-surface-report/issue-types",
    "operationId": "get-security-center-issue-types",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/attack-surface-report/issues",
    "operationId": "get-security-center-issues",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/attack-surface-report/issues/class",
    "operationId": "get-security-center-issue-counts-by-class",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/attack-surface-report/issues/severity",
    "operationId": "get-security-center-issue-counts-by-severity",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/attack-surface-report/issues/type",
    "operationId": "get-security-center-issue-counts-by-type",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/dns",
    "operationId": "passive-dns-by-ip-get-passive-dns-by-ip",
    "tags": [
      "Passive DNS by IP"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "start_end_params",
      "ipv4",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/domain",
    "operationId": "domain-intelligence-get-domain-details",
    "tags": [
      "Domain Intelligence"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "domain",
      "skip_dns",
      "skip_ranking"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/domain-history",
    "operationId": "domain-history-get-domain-history",
    "tags": [
      "Domain History"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "domain"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/domain/bulk",
    "operationId": "domain-intelligence-get-multiple-domain-details",
    "tags": [
      "Domain Intelligence"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "domain",
      "include_ranking",
      "skip_ranking"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/indicator-feeds",
    "operationId": "custom-indicator-feeds-get-indicator-feeds",
    "tags": [
      "Custom Indicator Feeds"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/indicator-feeds/{feed_id}",
    "operationId": "custom-indicator-feeds-get-indicator-feed-metadata",
    "tags": [
      "Custom Indicator Feeds"
    ],
    "pathParams": [
      "account_id",
      "feed_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/indicator-feeds/{feed_id}/data",
    "operationId": "custom-indicator-feeds-get-indicator-feed-data",
    "tags": [
      "Custom Indicator Feeds"
    ],
    "pathParams": [
      "account_id",
      "feed_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/indicator-feeds/{feed_id}/download",
    "operationId": "custom-indicator-feeds-download-indicator-feed-data",
    "tags": [
      "Custom Indicator Feeds"
    ],
    "pathParams": [
      "account_id",
      "feed_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/indicator-feeds/permissions/view",
    "operationId": "custom-indicator-feeds-view-permissions",
    "tags": [
      "Custom Indicator Feeds"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/ip",
    "operationId": "ip-intelligence-get-ip-overview",
    "tags": [
      "IP Intelligence"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "ipv4",
      "ipv6"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/ip-lists",
    "operationId": "ip-list-get-ip-lists",
    "tags": [
      "IP List"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/sinkholes",
    "operationId": "sinkhole-config-list-sinkholes",
    "tags": [
      "Sinkhole Config"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/sinkholes/{sinkhole_id}",
    "operationId": "sinkhole-config-get-sinkhole",
    "tags": [
      "Sinkhole Config"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/sinkholes/{sinkhole_id}/ingresses",
    "operationId": "sinkhole-config-list-sinkhole-ingresses",
    "tags": [
      "Sinkhole Config"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/url",
    "operationId": "url-intelligence-get-url-intelligence",
    "tags": [
      "URL Intelligence"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "url"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/intel/whois",
    "operationId": "whois-record-get-whois-record",
    "tags": [
      "WHOIS Record"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "domain"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitor_groups",
    "operationId": "account-load-balancer-monitor-groups-list-monitor-groups",
    "tags": [
      "Account Load Balancer Monitor Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitor_groups/{monitor_group_id}",
    "operationId": "account-load-balancer-monitor-groups-monitor-group-details",
    "tags": [
      "Account Load Balancer Monitor Groups"
    ],
    "pathParams": [
      "monitor_group_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitor_groups/{monitor_group_id}/references",
    "operationId": "account-load-balancer-monitor-groups-list-monitor-group-references",
    "tags": [
      "Account Load Balancer Monitor Groups"
    ],
    "pathParams": [
      "monitor_group_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitors",
    "operationId": "account-load-balancer-monitors-list-monitors",
    "tags": [
      "Account Load Balancer Monitors"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitors/{monitor_id}",
    "operationId": "account-load-balancer-monitors-monitor-details",
    "tags": [
      "Account Load Balancer Monitors"
    ],
    "pathParams": [
      "monitor_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/monitors/{monitor_id}/references",
    "operationId": "account-load-balancer-monitors-list-monitor-references",
    "tags": [
      "Account Load Balancer Monitors"
    ],
    "pathParams": [
      "monitor_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/pools",
    "operationId": "account-load-balancer-pools-list-pools",
    "tags": [
      "Account Load Balancer Pools"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "monitor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}",
    "operationId": "account-load-balancer-pools-pool-details",
    "tags": [
      "Account Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}/health",
    "operationId": "account-load-balancer-pools-pool-health-details",
    "tags": [
      "Account Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}/references",
    "operationId": "account-load-balancer-pools-list-pool-references",
    "tags": [
      "Account Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/preview/{preview_id}",
    "operationId": "account-load-balancer-monitors-preview-result",
    "tags": [
      "Account Load Balancer Monitors"
    ],
    "pathParams": [
      "preview_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/regions",
    "operationId": "load-balancer-regions-list-regions",
    "tags": [
      "Load Balancer Regions"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "subdivision_code",
      "subdivision_code_a2",
      "country_code_a2"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/regions/{region_id}",
    "operationId": "load-balancer-regions-get-region",
    "tags": [
      "Load Balancer Regions"
    ],
    "pathParams": [
      "region_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/load_balancers/search",
    "operationId": "account-load-balancer-search-search-resources",
    "tags": [
      "Account Load Balancer Search"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "query",
      "references",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logpush/datasets/{dataset_id}/fields",
    "operationId": "get-accounts-account_id-logpush-datasets-dataset_id-fields",
    "tags": [
      "Logpush jobs for an account"
    ],
    "pathParams": [
      "dataset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logpush/datasets/{dataset_id}/jobs",
    "operationId": "get-accounts-account_id-logpush-datasets-dataset_id-jobs",
    "tags": [
      "Logpush jobs for an account"
    ],
    "pathParams": [
      "dataset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logpush/jobs",
    "operationId": "get-accounts-account_id-logpush-jobs",
    "tags": [
      "Logpush jobs for an account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logpush/jobs/{job_id}",
    "operationId": "get-accounts-account_id-logpush-jobs-job_id",
    "tags": [
      "Logpush jobs for an account"
    ],
    "pathParams": [
      "job_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/audit",
    "operationId": "audit-logs-v2-get-account-audit-logs",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "account_name",
      "action_result",
      "action_type",
      "actor_context",
      "actor_email",
      "actor_id",
      "actor_ip_address",
      "actor_token_id",
      "actor_token_name",
      "actor_type",
      "audit_log_id",
      "id",
      "raw_cf_ray_id",
      "raw_method",
      "raw_status_code",
      "raw_uri",
      "resource_id",
      "resource_product",
      "resource_type",
      "resource_scope",
      "zone_id",
      "zone_name",
      "account_name.not",
      "action_result.not",
      "action_type.not",
      "actor_context.not",
      "actor_email.not",
      "actor_id.not",
      "actor_ip_address.not",
      "actor_token_id.not",
      "actor_token_name.not",
      "actor_type.not",
      "audit_log_id.not",
      "id.not",
      "raw_cf_ray_id.not",
      "raw_method.not",
      "raw_status_code.not",
      "raw_uri.not",
      "resource_id.not",
      "resource_product.not",
      "resource_type.not",
      "resource_scope.not",
      "zone_id.not",
      "zone_name.not",
      "since",
      "before",
      "direction",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/audit/{id}/history",
    "operationId": "audit-logs-v2-get-account-audit-log-history",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": [
      "action_time",
      "since",
      "before",
      "direction",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/control/cmb/config",
    "operationId": "get-accounts-account_id-logs-control-cmb-config",
    "tags": [
      "Logcontrol CMB config for an account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/explorer/datasets",
    "operationId": "accounts-logs-explorer-datasets-list",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": [
      "include_zones"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/explorer/datasets/{dataset_id}",
    "operationId": "accounts-logs-explorer-datasets-get",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/explorer/datasets/available",
    "operationId": "accounts-logs-explorer-datasets-available-list",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/explorer/query/sql",
    "operationId": "accounts-logs-explorer-query-get",
    "tags": [
      "Log Explorer Queries"
    ],
    "pathParams": [],
    "queryParams": [
      "query"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/list",
    "operationId": "logpull-list-log-files",
    "tags": [
      "Logpull"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/logs/retrieve",
    "operationId": "logpull-retrieve-logs",
    "tags": [
      "Logpull"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_dns_protection/configs/dns_protection/rules",
    "operationId": "listDnsProtectionRulesForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_dns_protection/configs/dns_protection/rules/{rule_id}",
    "operationId": "getDnsProtectionRule",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/allowlist",
    "operationId": "listAllowlistPrefixesForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/allowlist/{prefix_id}",
    "operationId": "getAllowlistPrefix",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "prefix_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/prefixes",
    "operationId": "listPrefixesForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/prefixes/{prefix_id}",
    "operationId": "getPrefix",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "prefix_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/syn_protection/filters",
    "operationId": "listSynProtectionFiltersForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "mode",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/syn_protection/filters/{filter_id}",
    "operationId": "getSynProtectionFilter",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "filter_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/syn_protection/rules",
    "operationId": "listSynProtectionRulesForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/syn_protection/rules/{rule_id}",
    "operationId": "getSynProtectionRule",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/tcp_flow_protection/filters",
    "operationId": "listTcpFlowProtectionFiltersForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "mode",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/tcp_flow_protection/filters/{filter_id}",
    "operationId": "getTcpFlowProtectionFilter",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "filter_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/tcp_flow_protection/rules",
    "operationId": "listTcpFlowProtectionRulesForAccount",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/tcp_flow_protection/rules/{rule_id}",
    "operationId": "getTcpFlowProtectionRule",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id",
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/advanced_tcp_protection/configs/tcp_protection_status",
    "operationId": "getProtectionStatus",
    "tags": [
      "dos-flowtrackd-api_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/apps",
    "operationId": "magic-account-apps-list-apps",
    "tags": [
      "Magic Account Apps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/bgp/filter_profiles",
    "operationId": "magic-bgp-list-filter-profiles",
    "tags": [
      "Magic BGP Filter Profiles"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/bgp/filter_profiles/{profile_id}",
    "operationId": "magic-bgp-get-filter-profile",
    "tags": [
      "Magic BGP Filter Profiles"
    ],
    "pathParams": [
      "account_id",
      "profile_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/bgp/settings",
    "operationId": "magic-bgp-get-settings",
    "tags": [
      "Magic BGP Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf_interconnects",
    "operationId": "magic-interconnects-list-interconnects",
    "tags": [
      "Magic Interconnects"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf_interconnects/{cf_interconnect_id}",
    "operationId": "magic-interconnects-list-interconnect-details",
    "tags": [
      "Magic Interconnects"
    ],
    "pathParams": [
      "cf_interconnect_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf1_sites",
    "operationId": "magic-cf1-sites-list-cf1-sites",
    "tags": [
      "Magic CF1 Sites"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf1_sites/{cf1_site_id}",
    "operationId": "magic-cf1-sites-get-cf1-site",
    "tags": [
      "Magic CF1 Sites"
    ],
    "pathParams": [
      "account_id",
      "cf1_site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf1_sites/{cf1_site_id}/ramps",
    "operationId": "magic-cf1-sites-list-cf1-site-ramps",
    "tags": [
      "Magic CF1 Site Ramps"
    ],
    "pathParams": [
      "account_id",
      "cf1_site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cf1_sites/{cf1_site_id}/ramps/{ramp_id}",
    "operationId": "magic-cf1-sites-get-cf1-site-ramp",
    "tags": [
      "Magic CF1 Site Ramps"
    ],
    "pathParams": [
      "account_id",
      "cf1_site_id",
      "ramp_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/catalog-syncs",
    "operationId": "catalog-syncs-list",
    "tags": [
      "Catalog Sync"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/catalog-syncs/{sync_id}",
    "operationId": "catalog-syncs-read",
    "tags": [
      "Catalog Sync"
    ],
    "pathParams": [
      "account_id",
      "sync_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/catalog-syncs/prebuilt-policies",
    "operationId": "catalog-syncs-prebuilt-policies-list",
    "tags": [
      "Catalog Sync"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "destination_type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/onramps",
    "operationId": "onramps-list",
    "tags": [
      "On-ramps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "order_by",
      "desc",
      "status",
      "vpcs"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/onramps/{onramp_id}",
    "operationId": "onramps-read",
    "tags": [
      "On-ramps"
    ],
    "pathParams": [
      "account_id",
      "onramp_id"
    ],
    "queryParams": [
      "status",
      "vpcs",
      "post_apply_resources",
      "planned_resources"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/onramps/magic_wan_address_space",
    "operationId": "onramps-mwan-addr-space-read",
    "tags": [
      "On-ramps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/providers",
    "operationId": "providers-list",
    "tags": [
      "Cloud Integrations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "status",
      "order_by",
      "desc",
      "cloudflare"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/providers/{provider_id}",
    "operationId": "providers-read",
    "tags": [
      "Cloud Integrations"
    ],
    "pathParams": [
      "account_id",
      "provider_id"
    ],
    "queryParams": [
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/providers/{provider_id}/initial_setup",
    "operationId": "providers-initial-setup",
    "tags": [
      "Cloud Integrations"
    ],
    "pathParams": [
      "account_id",
      "provider_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/resources",
    "operationId": "resources-catalog-list",
    "tags": [
      "Resources"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "provider_id",
      "resource_type",
      "resource_id",
      "region",
      "resource_group",
      "managed",
      "search",
      "order_by",
      "desc",
      "per_page",
      "page",
      "cloudflare",
      "v2"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/resources/{resource_id}",
    "operationId": "resources-catalog-read",
    "tags": [
      "Resources"
    ],
    "pathParams": [
      "account_id",
      "resource_id"
    ],
    "queryParams": [
      "v2"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/cloud/resources/export",
    "operationId": "resources-catalog-export",
    "tags": [
      "Resources"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "provider_id",
      "resource_type",
      "resource_id",
      "region",
      "resource_group",
      "search",
      "order_by",
      "desc",
      "v2"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors",
    "operationId": "mconn-connector-list",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "device_type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}",
    "operationId": "mconn-connector-fetch",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/interrupts",
    "operationId": "mconn-connector-interrupt-list",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/events",
    "operationId": "mconn-connector-telemetry-events-list",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": [
      "from",
      "to",
      "limit",
      "cursor",
      "k"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/events/{event_t}.{event_n}",
    "operationId": "mconn-connector-telemetry-events-get",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id",
      "event_t",
      "event_n"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/events/latest",
    "operationId": "mconn-connector-telemetry-events-listLatest",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/snapshots",
    "operationId": "mconn-connector-telemetry-snapshots-list",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": [
      "from",
      "to",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/snapshots/{snapshot_t}",
    "operationId": "mconn-connector-telemetry-snapshots-get",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id",
      "snapshot_t"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/connectors/{connector_id}/telemetry/snapshots/latest",
    "operationId": "mconn-connector-telemetry-snapshots-listLatest",
    "tags": [
      "Magic Connectors"
    ],
    "pathParams": [
      "account_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/gre_tunnels",
    "operationId": "magic-gre-tunnels-list-gre-tunnels",
    "tags": [
      "Magic GRE tunnels"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/gre_tunnels/{gre_tunnel_id}",
    "operationId": "magic-gre-tunnels-list-gre-tunnel-details",
    "tags": [
      "Magic GRE tunnels"
    ],
    "pathParams": [
      "gre_tunnel_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/ipsec_tunnels",
    "operationId": "magic-ipsec-tunnels-list-ipsec-tunnels",
    "tags": [
      "Magic IPsec tunnels"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/ipsec_tunnels/{ipsec_tunnel_id}",
    "operationId": "magic-ipsec-tunnels-list-ipsec-tunnel-details",
    "tags": [
      "Magic IPsec tunnels"
    ],
    "pathParams": [
      "ipsec_tunnel_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/redundancy_groups",
    "operationId": "magic-redundancy-groups-list-redundancy-groups",
    "tags": [
      "Magic Redundancy Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/redundancy_groups/{redundancy_group_id}",
    "operationId": "magic-redundancy-groups-get-redundancy-group",
    "tags": [
      "Magic Redundancy Groups"
    ],
    "pathParams": [
      "account_id",
      "redundancy_group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/routes",
    "operationId": "magic-static-routes-list-routes",
    "tags": [
      "Magic Static Routes"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/routes/{route_id}",
    "operationId": "magic-static-routes-route-details",
    "tags": [
      "Magic Static Routes"
    ],
    "pathParams": [
      "route_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites",
    "operationId": "magic-sites-list-sites",
    "tags": [
      "Magic Sites"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "connectorid"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}",
    "operationId": "magic-sites-site-details",
    "tags": [
      "Magic Sites"
    ],
    "pathParams": [
      "site_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/acls",
    "operationId": "magic-site-acls-list-acls",
    "tags": [
      "Magic Site ACLs"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/acls/{acl_id}",
    "operationId": "magic-site-acls-acl-details",
    "tags": [
      "Magic Site ACLs"
    ],
    "pathParams": [
      "site_id",
      "account_id",
      "acl_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/app_configs",
    "operationId": "magic-site-app-configs-list-app-configs",
    "tags": [
      "Magic Site App Configs"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/lans",
    "operationId": "magic-site-lans-list-lans",
    "tags": [
      "Magic Site LANs"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/lans/{lan_id}",
    "operationId": "magic-site-lans-lan-details",
    "tags": [
      "Magic Site LANs"
    ],
    "pathParams": [
      "site_id",
      "account_id",
      "lan_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/netflow_config",
    "operationId": "magic-site-netflow-config-details",
    "tags": [
      "Magic Site NetFlow Config"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/wans",
    "operationId": "magic-site-wans-list-wans",
    "tags": [
      "Magic Site WANs"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/magic/sites/{site_id}/wans/{wan_id}",
    "operationId": "magic-site-wans-wan-details",
    "tags": [
      "Magic Site WANs"
    ],
    "pathParams": [
      "site_id",
      "account_id",
      "wan_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/members",
    "operationId": "account-members-list-members",
    "tags": [
      "Account Members"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "order",
      "status",
      "page",
      "per_page",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/members/{member_id}",
    "operationId": "account-members-member-details",
    "tags": [
      "Account Members"
    ],
    "pathParams": [
      "member_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mnm/config",
    "operationId": "magic-network-monitoring-configuration-list-account-configuration",
    "tags": [
      "Magic Network Monitoring Configuration"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mnm/config/full",
    "operationId": "magic-network-monitoring-configuration-list-rules-and-account-configuration",
    "tags": [
      "Magic Network Monitoring Configuration"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mnm/rules",
    "operationId": "magic-network-monitoring-rules-list-rules",
    "tags": [
      "Magic Network Monitoring Rules"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mnm/rules/{rule_id}",
    "operationId": "magic-network-monitoring-rules-get-rule",
    "tags": [
      "Magic Network Monitoring Rules"
    ],
    "pathParams": [
      "rule_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/moq/relays",
    "operationId": "moq-relays-list",
    "tags": [
      "MoQ Relays"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/moq/relays/{relay_id}",
    "operationId": "moq-relays-get",
    "tags": [
      "MoQ Relays"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mtls_certificates",
    "operationId": "m-tls-certificate-management-list-m-tls-certificates",
    "tags": [
      "mTLS Certificate Management"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mtls_certificates/{mtls_certificate_id}",
    "operationId": "m-tls-certificate-management-get-m-tls-certificate",
    "tags": [
      "mTLS Certificate Management"
    ],
    "pathParams": [
      "mtls_certificate_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/mtls_certificates/{mtls_certificate_id}/associations",
    "operationId": "m-tls-certificate-management-list-m-tls-certificate-associations",
    "tags": [
      "mTLS Certificate Management"
    ],
    "pathParams": [
      "mtls_certificate_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/oauth_clients",
    "operationId": "oauth-clients-list",
    "tags": [
      "OAuth Clients"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/oauth_clients/{oauth_client_id}",
    "operationId": "oauth-clients-get",
    "tags": [
      "OAuth Clients"
    ],
    "pathParams": [
      "account_id",
      "oauth_client_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/organizations",
    "operationId": "Accounts_listAccountOrganizations",
    "tags": [
      "Accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects",
    "operationId": "pages-project-get-projects",
    "tags": [
      "Pages Project"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}",
    "operationId": "pages-project-get-project",
    "tags": [
      "Pages Project"
    ],
    "pathParams": [
      "project_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}/deployments",
    "operationId": "pages-deployment-get-deployments",
    "tags": [
      "Pages Deployment"
    ],
    "pathParams": [
      "project_name",
      "account_id"
    ],
    "queryParams": [
      "env",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}",
    "operationId": "pages-deployment-get-deployment-info",
    "tags": [
      "Pages Deployment"
    ],
    "pathParams": [
      "deployment_id",
      "project_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/history/logs",
    "operationId": "pages-deployment-get-deployment-logs",
    "tags": [
      "Pages Deployment"
    ],
    "pathParams": [
      "deployment_id",
      "project_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}/domains",
    "operationId": "pages-domains-get-domains",
    "tags": [
      "Pages Domains"
    ],
    "pathParams": [
      "project_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pages/projects/{project_name}/domains/{domain_name}",
    "operationId": "pages-domains-get-domain",
    "tags": [
      "Pages Domains"
    ],
    "pathParams": [
      "domain_name",
      "project_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pay-per-crawl/crawler/stripe",
    "operationId": "pay-per-crawl.crawlerGetStripeConfig",
    "tags": [
      "ppc_stripe"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pay-per-crawl/publisher/stripe",
    "operationId": "pay-per-crawl.publisherGetStripeConfig",
    "tags": [
      "ppc_stripe"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/paygo-usage",
    "operationId": "billable-usage-get-paygo-account-usage",
    "tags": [
      "Billable Usage"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pcaps",
    "operationId": "magic-pcap-collection-list-packet-capture-requests",
    "tags": [
      "Magic PCAP collection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pcaps/{pcap_id}",
    "operationId": "magic-pcap-collection-get-pcap-request",
    "tags": [
      "Magic PCAP collection"
    ],
    "pathParams": [
      "pcap_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pcaps/{pcap_id}/download",
    "operationId": "magic-pcap-collection-download-simple-pcap",
    "tags": [
      "Magic PCAP collection"
    ],
    "pathParams": [
      "pcap_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pcaps/ownership",
    "operationId": "magic-pcap-collection-list-pca-ps-bucket-ownership",
    "tags": [
      "Magic PCAP collection"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines",
    "operationId": "getV4AccountsByAccount_idPipelines_deprecated",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "search",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/{pipeline_name}",
    "operationId": "getV4AccountsByAccount_idPipelinesByPipeline_name_deprecated",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id",
      "pipeline_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/pipelines",
    "operationId": "getV4AccountsByAccount_idPipelinesV1Pipelines",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "name"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/pipelines/{pipeline_id}",
    "operationId": "getV4AccountsByAccount_idPipelinesV1PipelinesByPipeline_id",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id",
      "pipeline_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/sinks",
    "operationId": "getV4AccountsByAccount_idPipelinesV1Sinks",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "pipeline_id",
      "name",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/sinks/{sink_id}",
    "operationId": "getV4AccountsByAccount_idPipelinesV1SinksBySink_id",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id",
      "sink_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/streams",
    "operationId": "getV4AccountsByAccount_idPipelinesV1Streams",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "pipeline_id",
      "name",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/pipelines/v1/streams/{stream_id}",
    "operationId": "getV4AccountsByAccount_idPipelinesV1StreamsByStream_id",
    "tags": [
      "workers_pipelines_other"
    ],
    "pathParams": [
      "account_id",
      "stream_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/profile",
    "operationId": "Accounts_getAccountProfile",
    "tags": [
      "Accounts"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues",
    "operationId": "queues-list",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues/{queue_id}",
    "operationId": "queues-get",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "queue_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues/{queue_id}/consumers",
    "operationId": "queues-list-consumers",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "queue_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues/{queue_id}/consumers/{consumer_id}",
    "operationId": "queues-get-consumer",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "consumer_id",
      "queue_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues/{queue_id}/metrics",
    "operationId": "queues-get-metrics",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "queue_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/queues/{queue_id}/purge",
    "operationId": "queues-purge-get",
    "tags": [
      "Queue"
    ],
    "pathParams": [
      "queue_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog",
    "operationId": "list-catalogs",
    "tags": [
      "R2 Catalog Management"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}",
    "operationId": "get-catalog-details",
    "tags": [
      "R2 Catalog Management"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/maintenance-configs",
    "operationId": "get-maintenance-config",
    "tags": [
      "Maintenance Configuration"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/namespaces",
    "operationId": "list-namespaces",
    "tags": [
      "Namespace Management"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": [
      "page_token",
      "page_size",
      "parent",
      "return_uuids",
      "return_details"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/namespaces/{namespace}/tables",
    "operationId": "list-tables",
    "tags": [
      "Table Management"
    ],
    "pathParams": [
      "account_id",
      "bucket_name",
      "namespace"
    ],
    "queryParams": [
      "page_token",
      "page_size",
      "return_uuids",
      "return_details"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/namespaces/{namespace}/tables/{table_name}",
    "operationId": "get-table",
    "tags": [
      "Table Management"
    ],
    "pathParams": [
      "account_id",
      "bucket_name",
      "namespace",
      "table_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/namespaces/{namespace}/tables/{table_name}/maintenance-configs",
    "operationId": "get-table-maintenance-config",
    "tags": [
      "Table Maintenance Configuration"
    ],
    "pathParams": [
      "account_id",
      "bucket_name",
      "namespace",
      "table_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets",
    "operationId": "r2-list-buckets",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name_contains",
      "start_after",
      "per_page",
      "order",
      "direction",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}",
    "operationId": "r2-get-bucket",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/cors",
    "operationId": "r2-get-bucket-cors-policy",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom",
    "operationId": "r2-list-custom-domains",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom/{domain}",
    "operationId": "r2-get-custom-domain-settings",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id",
      "bucket_name",
      "domain"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed",
    "operationId": "r2-get-bucket-public-policy",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle",
    "operationId": "r2-get-bucket-lifecycle-configuration",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/local-uploads",
    "operationId": "r2-get-bucket-local-uploads-configuration",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/lock",
    "operationId": "r2-get-bucket-lock-configuration",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "bucket_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/objects",
    "operationId": "r2-list-objects",
    "tags": [
      "R2 Object"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": [
      "per_page",
      "prefix",
      "delimiter",
      "cursor",
      "start_after"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/objects/{object_key}",
    "operationId": "r2-get-object",
    "tags": [
      "R2 Object"
    ],
    "pathParams": [
      "account_id",
      "bucket_name",
      "object_key"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/sippy",
    "operationId": "r2-get-bucket-sippy-config",
    "tags": [
      "R2 Bucket"
    ],
    "pathParams": [
      "account_id",
      "bucket_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/r2/metrics",
    "operationId": "r2-get-account-level-metrics",
    "tags": [
      "R2 Account"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/analytics/daywise",
    "operationId": "get-org-analytics",
    "tags": [
      "Analytics",
      "Organizations"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/analytics/livestreams/daywise",
    "operationId": "get-livestream-analytics-daywise",
    "tags": [
      "Live streams",
      "LivestreamAnalytics"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "start_time",
      "end_time",
      "filters"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/analytics/livestreams/overall",
    "operationId": "get-livestream-analytics-complete",
    "tags": [
      "Live streams",
      "LivestreamAnalytics"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "start_time",
      "end_time",
      "filters"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/livestreams",
    "operationId": "fetch_all_livestreams",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "exclude_meetings",
      "per_page",
      "page_no",
      "status",
      "start_time",
      "end_time",
      "sort_order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/livestreams/{livestream_id}",
    "operationId": "get-v2-livestream-session-livestream-id",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "livestream_id"
    ],
    "queryParams": [
      "page_no",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/livestreams/{livestream_id}/active-livestream-session",
    "operationId": "get-v2-active-livestream-session-details",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "livestream_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/livestreams/sessions/{livestream-session-id}",
    "operationId": "get-v2-livestreams-livestream-session-id",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "livestream-session-id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings",
    "operationId": "get_all_meetings",
    "tags": [
      "Meetings"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}",
    "operationId": "get_meeting",
    "tags": [
      "Meetings"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id"
    ],
    "queryParams": [
      "name"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}/active-livestream",
    "operationId": "get-v2-meetings-meetingId-active-livestream",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}/active-session",
    "operationId": "GetActiveSession",
    "tags": [
      "Active session"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}/livestream",
    "operationId": "livestream-session-details",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id"
    ],
    "queryParams": [
      "page_no",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}/participants",
    "operationId": "get_meeting_participants",
    "tags": [
      "Meetings"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/meetings/{meeting_id}/participants/{participant_id}",
    "operationId": "get_meeting_participant",
    "tags": [
      "Meetings"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id",
      "participant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/presets",
    "operationId": "get-presets",
    "tags": [
      "Presets"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/presets/{preset_id}",
    "operationId": "get-presets-preset_id",
    "tags": [
      "Presets"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "preset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/recordings",
    "operationId": "get_all_recordings",
    "tags": [
      "Recordings"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "meeting_id",
      "expired"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/recordings/{recording_id}",
    "operationId": "get_one_recording",
    "tags": [
      "Recordings"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "recording_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/recordings/active-recording/{meeting_id}",
    "operationId": "get_active_recording",
    "tags": [
      "Recordings"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "meeting_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions",
    "operationId": "GetSessions",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": [
      "search",
      "associated_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}",
    "operationId": "GetSessionDetails",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": [
      "include_breakout_rooms"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/chat",
    "operationId": "GetSessionChat",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/livestream-sessions",
    "operationId": "get-v2-livestreamsession-session-meetingId-active-livestream",
    "tags": [
      "Live streams"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": [
      "per_page",
      "page_no"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/participants",
    "operationId": "GetSessionParticipants",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": [
      "search",
      "include_peer_events",
      "view"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/participants/{participant_id}",
    "operationId": "GetParticipantDetails",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "participant_id",
      "session_id"
    ],
    "queryParams": [
      "filters",
      "include_peer_events"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/summary",
    "operationId": "GetSessionSummary",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/{session_id}/transcript",
    "operationId": "GetSessionTranscript",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "session_id"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/sessions/peer-report/{peer_id}",
    "operationId": "GetParticipantDataFromPeerId",
    "tags": [
      "Sessions"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "peer_id"
    ],
    "queryParams": [
      "filters",
      "include_peer_events"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/webhooks",
    "operationId": "getAllWebhooks",
    "tags": [
      "Webhooks"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/webhooks/{webhook_id}",
    "operationId": "getWebhook",
    "tags": [
      "Webhooks"
    ],
    "pathParams": [
      "account_id",
      "app_id",
      "webhook_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/{app_id}/webhooks/all",
    "operationId": "getAllWebhookEvents",
    "tags": [
      "Webhooks"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/apps",
    "operationId": "get_apps",
    "tags": [
      "Apps"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page_no",
      "per_page",
      "search",
      "sort_order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/realtime/kit/apps/{app_id}",
    "operationId": "get_app",
    "tags": [
      "Apps"
    ],
    "pathParams": [
      "account_id",
      "app_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/domain-search",
    "operationId": "registrar-domain-discovery-search",
    "tags": [
      "Domain Discovery"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "q",
      "extensions",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/domains",
    "operationId": "registrar-domains-list-domains",
    "tags": [
      "Registrar Domains"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/domains/{domain_name}",
    "operationId": "registrar-domains-get-domain",
    "tags": [
      "Registrar Domains"
    ],
    "pathParams": [
      "domain_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/registrations",
    "operationId": "registrar-domain-registration-list",
    "tags": [
      "Registrar Registration"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "sort_by"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/registrations/{domain_name}",
    "operationId": "registrar-domain-registration-get",
    "tags": [
      "Registrar Registration"
    ],
    "pathParams": [
      "account_id",
      "domain_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/registrations/{domain_name}/registration-status",
    "operationId": "registrar-domain-registration-get-status",
    "tags": [
      "Registrar Registration"
    ],
    "pathParams": [
      "account_id",
      "domain_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/registrar/registrations/{domain_name}/update-status",
    "operationId": "registrar-domain-registration-get-update-status",
    "tags": [
      "Registrar Registration"
    ],
    "pathParams": [
      "account_id",
      "domain_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/resource-library/applications",
    "operationId": "getApplications",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "filter",
      "limit",
      "offset",
      "order_by",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/resource-library/applications/{id}",
    "operationId": "getApplicationById",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/resource-library/categories",
    "operationId": "getCategories",
    "tags": [
      "Category"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/resource-library/categories/{id}",
    "operationId": "getCategoryById",
    "tags": [
      "Category"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/roles",
    "operationId": "account-roles-list-roles",
    "tags": [
      "Account Roles"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/roles/{role_id}",
    "operationId": "account-roles-role-details",
    "tags": [
      "Account Roles"
    ],
    "pathParams": [
      "role_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rules/lists",
    "operationId": "lists-get-lists",
    "tags": [
      "Lists"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rules/lists/{list_id}",
    "operationId": "lists-get-a-list",
    "tags": [
      "Lists"
    ],
    "pathParams": [
      "list_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rules/lists/{list_id}/items",
    "operationId": "lists-get-list-items",
    "tags": [
      "Lists"
    ],
    "pathParams": [
      "list_id",
      "account_id"
    ],
    "queryParams": [
      "cursor",
      "per_page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rules/lists/{list_id}/items/{item_id}",
    "operationId": "lists-get-a-list-item",
    "tags": [
      "Lists"
    ],
    "pathParams": [
      "item_id",
      "list_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rules/lists/bulk_operations/{operation_id}",
    "operationId": "lists-get-bulk-operation-status",
    "tags": [
      "Lists"
    ],
    "pathParams": [
      "operation_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets",
    "operationId": "listAccountRulesets",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "cursor",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/{ruleset_id}",
    "operationId": "getAccountRuleset",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/{ruleset_id}/versions",
    "operationId": "listAccountRulesetVersions",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/{ruleset_id}/versions/{ruleset_version}",
    "operationId": "getAccountRulesetVersion",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_version",
      "ruleset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/{ruleset_id}/versions/{ruleset_version}/by_tag/{rule_tag}",
    "operationId": "listAccountRulesetVersionRulesByTag",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "rule_tag",
      "ruleset_version",
      "ruleset_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/phases/{ruleset_phase}/entrypoint",
    "operationId": "getAccountEntrypointRuleset",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_phase",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/phases/{ruleset_phase}/entrypoint/versions",
    "operationId": "listAccountEntrypointRulesetVersions",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_phase",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rulesets/phases/{ruleset_phase}/entrypoint/versions/{ruleset_version}",
    "operationId": "getAccountEntrypointRulesetVersion",
    "tags": [
      "Account Rulesets"
    ],
    "pathParams": [
      "ruleset_version",
      "ruleset_phase",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/site_info/{site_id}",
    "operationId": "web-analytics-get-site",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id",
      "site_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/site_info/list",
    "operationId": "web-analytics-list-sites",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page",
      "page",
      "order_by"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/site_info/site_tag/list",
    "operationId": "web-analytics-list-site-tags",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "all"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/site_info/validate/{hostname}",
    "operationId": "web-analytics-validate-site-hostname",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id",
      "hostname"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/site_info/zone_tag/list",
    "operationId": "web-analytics-list-zone-tags",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/rum/v2/{ruleset_id}/rules",
    "operationId": "web-analytics-list-rules",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "account_id",
      "ruleset_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Groups",
    "operationId": "scim-groups-list",
    "tags": [
      "SCIM Groups"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "startIndex",
      "count",
      "filter"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Groups/{group_id}",
    "operationId": "scim-groups-get",
    "tags": [
      "SCIM Groups"
    ],
    "pathParams": [
      "account_id",
      "group_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/ResourceTypes",
    "operationId": "scim-resource-types-list",
    "tags": [
      "SCIM Discovery"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/ResourceTypes/{resource_type_id}",
    "operationId": "scim-resource-types-get",
    "tags": [
      "SCIM Discovery"
    ],
    "pathParams": [
      "account_id",
      "resource_type_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Schemas",
    "operationId": "scim-schemas-list",
    "tags": [
      "SCIM Discovery"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Schemas/{schema_id}",
    "operationId": "scim-schemas-get",
    "tags": [
      "SCIM Discovery"
    ],
    "pathParams": [
      "account_id",
      "schema_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/ServiceProviderConfig",
    "operationId": "scim-service-provider-config-get",
    "tags": [
      "SCIM Discovery"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Users",
    "operationId": "scim-users-list",
    "tags": [
      "SCIM Users"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "startIndex",
      "count",
      "filter"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/scim/v2/Users/{user_id}",
    "operationId": "scim-users-get",
    "tags": [
      "SCIM Users"
    ],
    "pathParams": [
      "account_id",
      "user_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/acls",
    "operationId": "secondary-dns-(-acl)-list-ac-ls",
    "tags": [
      "Secondary DNS (ACL)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/acls/{acl_id}",
    "operationId": "secondary-dns-(-acl)-acl-details",
    "tags": [
      "Secondary DNS (ACL)"
    ],
    "pathParams": [
      "acl_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/peers",
    "operationId": "secondary-dns-(-peer)-list-peers",
    "tags": [
      "Secondary DNS (Peer)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/peers/{peer_id}",
    "operationId": "secondary-dns-(-peer)-peer-details",
    "tags": [
      "Secondary DNS (Peer)"
    ],
    "pathParams": [
      "peer_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/tsigs",
    "operationId": "secondary-dns-(-tsig)-list-tsi-gs",
    "tags": [
      "Secondary DNS (TSIG)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secondary_dns/tsigs/{tsig_id}",
    "operationId": "secondary-dns-(-tsig)-tsig-details",
    "tags": [
      "Secondary DNS (TSIG)"
    ],
    "pathParams": [
      "tsig_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secrets_store/quota",
    "operationId": "secrets-store-quota",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secrets_store/stores",
    "operationId": "secrets-store-list",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secrets_store/stores/{store_id}",
    "operationId": "secrets-store-get-store-by-id",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "account_id",
      "store_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secrets_store/stores/{store_id}/secrets",
    "operationId": "secrets-store-secrets-list",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "account_id",
      "store_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/secrets_store/stores/{store_id}/secrets/{secret_id}",
    "operationId": "secrets-store-get-by-id",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "account_id",
      "store_id",
      "secret_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights",
    "operationId": "get-security-center-insights",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/{issue_id}/audit-log",
    "operationId": "get-security-center-issue-audit-log",
    "tags": [
      "Security Center Audit Log"
    ],
    "pathParams": [
      "account_id",
      "issue_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/{issue_id}/context",
    "operationId": "get-security-center-insight-context",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id",
      "issue_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/audit-log",
    "operationId": "get-security-center-account-audit-log",
    "tags": [
      "Security Center Audit Log"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/class",
    "operationId": "get-security-center-insight-counts-by-class",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/scans",
    "operationId": "get-security-center-account-scans",
    "tags": [
      "Security Center Scans"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/severity",
    "operationId": "get-security-center-insight-counts-by-severity",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/security-center/insights/type",
    "operationId": "get-security-center-insight-counts-by-type",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares",
    "operationId": "shares-list",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares/{share_id}",
    "operationId": "shares-get-by-id",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id",
      "share_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares/{share_id}/recipients",
    "operationId": "share-recipients-list",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id",
      "share_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares/{share_id}/recipients/{recipient_id}",
    "operationId": "share-recipients-get-by-id",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id",
      "share_id",
      "recipient_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares/{share_id}/resources",
    "operationId": "share-resources-list",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id",
      "share_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/shares/{share_id}/resources/{share_resource_id}",
    "operationId": "share-resources-get-by-id",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "account_id",
      "share_id",
      "share_resource_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/slurper/jobs",
    "operationId": "slurper-list-jobs",
    "tags": [
      "R2 Super Slurper"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/slurper/jobs/{job_id}",
    "operationId": "slurper-get-job",
    "tags": [
      "R2 Super Slurper"
    ],
    "pathParams": [
      "account_id",
      "job_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/slurper/jobs/{job_id}/logs",
    "operationId": "slurper-get-job-logs",
    "tags": [
      "R2 Super Slurper"
    ],
    "pathParams": [
      "account_id",
      "job_id"
    ],
    "queryParams": [
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/slurper/jobs/{job_id}/progress",
    "operationId": "slurper-get-job-progress",
    "tags": [
      "R2 Super Slurper"
    ],
    "pathParams": [
      "account_id",
      "job_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/sso_connectors",
    "operationId": "get-all-sso-connectors",
    "tags": [
      "SSO"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/sso_connectors/{sso_connector_id}",
    "operationId": "get-sso-connector",
    "tags": [
      "SSO"
    ],
    "pathParams": [
      "account_id",
      "sso_connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/storage/kv/namespaces",
    "operationId": "workers-kv-namespace-list-namespaces",
    "tags": [
      "Workers KV Namespace"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}",
    "operationId": "workers-kv-namespace-get-a-namespace",
    "tags": [
      "Workers KV Namespace"
    ],
    "pathParams": [
      "namespace_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys",
    "operationId": "workers-kv-namespace-list-a-namespace'-s-keys",
    "tags": [
      "Workers KV Namespace"
    ],
    "pathParams": [
      "namespace_id",
      "account_id"
    ],
    "queryParams": [
      "limit",
      "prefix",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/metadata/{key_name}",
    "operationId": "workers-kv-namespace-read-the-metadata-for-a-key",
    "tags": [
      "Workers KV Namespace"
    ],
    "pathParams": [
      "key_name",
      "namespace_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}",
    "operationId": "workers-kv-namespace-read-key-value-pair",
    "tags": [
      "Workers KV Namespace"
    ],
    "pathParams": [
      "key_name",
      "namespace_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream",
    "operationId": "stream-videos-list-videos",
    "tags": [
      "Stream Videos"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "status",
      "creator",
      "type",
      "asc",
      "video_name",
      "search",
      "start",
      "end",
      "include_counts",
      "id",
      "name",
      "live_input_id",
      "before",
      "after",
      "limit"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}",
    "operationId": "stream-videos-retrieve-video-details",
    "tags": [
      "Stream Videos"
    ],
    "pathParams": [
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/audio",
    "operationId": "list-audio-tracks",
    "tags": [
      "Stream Audio Tracks"
    ],
    "pathParams": [
      "account_id",
      "identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/captions",
    "operationId": "stream-subtitles/-captions-list-captions-or-subtitles",
    "tags": [
      "Stream Subtitles/Captions"
    ],
    "pathParams": [
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/captions/{language}",
    "operationId": "stream-subtitles/-captions-get-caption-or-subtitle-for-language",
    "tags": [
      "Stream Subtitles/Captions"
    ],
    "pathParams": [
      "language",
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/captions/{language}/vtt",
    "operationId": "stream-subtitles/-captions-get-vtt-caption-or-subtitle",
    "tags": [
      "Stream Subtitles/Captions"
    ],
    "pathParams": [
      "language",
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/downloads",
    "operationId": "stream-m-p-4-downloads-list-downloads",
    "tags": [
      "Stream MP4 Downloads"
    ],
    "pathParams": [
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/{identifier}/embed",
    "operationId": "stream-videos-retreieve-embed-code-html",
    "tags": [
      "Stream Videos"
    ],
    "pathParams": [
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/keys",
    "operationId": "stream-signing-keys-list-signing-keys",
    "tags": [
      "Stream Signing Keys"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/live_inputs",
    "operationId": "stream-live-inputs-list-live-inputs",
    "tags": [
      "Stream Live Inputs"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "include_counts"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/live_inputs/{live_input_identifier}",
    "operationId": "stream-live-inputs-retrieve-a-live-input",
    "tags": [
      "Stream Live Inputs"
    ],
    "pathParams": [
      "live_input_identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/live_inputs/{live_input_identifier}/outputs",
    "operationId": "stream-live-inputs-list-all-outputs-associated-with-a-specified-live-input",
    "tags": [
      "Stream Live Inputs"
    ],
    "pathParams": [
      "live_input_identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/storage-usage",
    "operationId": "stream-videos-storage-usage",
    "tags": [
      "Stream Videos"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "creator"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/watermarks",
    "operationId": "stream-watermark-profile-list-watermark-profiles",
    "tags": [
      "Stream Watermark Profile"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/watermarks/{identifier}",
    "operationId": "stream-watermark-profile-watermark-profile-details",
    "tags": [
      "Stream Watermark Profile"
    ],
    "pathParams": [
      "identifier",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/stream/webhook",
    "operationId": "stream-webhook-view-webhooks",
    "tags": [
      "Stream Webhook"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/subscriptions",
    "operationId": "account-subscriptions-list-subscriptions",
    "tags": [
      "Account Subscriptions"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tags",
    "operationId": "tags-get",
    "tags": [
      "Resource Tagging"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "resource_id",
      "resource_type",
      "worker_id"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tags/keys",
    "operationId": "tags-list-keys",
    "tags": [
      "Resource Tagging"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tags/resources",
    "operationId": "tags-list",
    "tags": [
      "Resource Tagging"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "type"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tags/values/{tag_key}",
    "operationId": "tags-list-values",
    "tags": [
      "Resource Tagging"
    ],
    "pathParams": [
      "account_id",
      "tag_key"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/teamnet/routes",
    "operationId": "tunnel-route-list-tunnel-routes",
    "tags": [
      "Tunnel Routing"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "comment",
      "is_deleted",
      "network_subset",
      "network_superset",
      "existed_at",
      "tunnel_id",
      "route_id",
      "tun_types",
      "virtual_network_id",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/teamnet/routes/{route_id}",
    "operationId": "tunnel-route-get-tunnel-route",
    "tags": [
      "Tunnel Routing"
    ],
    "pathParams": [
      "account_id",
      "route_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/teamnet/routes/ip/{ip}",
    "operationId": "tunnel-route-get-tunnel-route-by-ip",
    "tags": [
      "Tunnel Routing"
    ],
    "pathParams": [
      "ip",
      "account_id"
    ],
    "queryParams": [
      "virtual_network_id",
      "default_virtual_network_fallback"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/teamnet/virtual_networks",
    "operationId": "tunnel-virtual-network-list-virtual-networks",
    "tags": [
      "Tunnel Virtual Network"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "name",
      "is_default",
      "is_default_network",
      "is_deleted"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/teamnet/virtual_networks/{virtual_network_id}",
    "operationId": "tunnel-virtual-network-get",
    "tags": [
      "Tunnel Virtual Network"
    ],
    "pathParams": [
      "account_id",
      "virtual_network_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tokens",
    "operationId": "account-api-tokens-list-tokens",
    "tags": [
      "Account Owned API Tokens"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tokens/{token_id}",
    "operationId": "account-api-tokens-token-details",
    "tags": [
      "Account Owned API Tokens"
    ],
    "pathParams": [
      "account_id",
      "token_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tokens/permission_groups",
    "operationId": "account-api-tokens-list-permission-groups",
    "tags": [
      "Account Owned API Tokens"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "scope"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tokens/verify",
    "operationId": "account-api-tokens-verify-token",
    "tags": [
      "Account Owned API Tokens"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/tunnels",
    "operationId": "cloudflare-tunnel-list-all-tunnels",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "is_deleted",
      "existed_at",
      "uuid",
      "was_active_at",
      "was_inactive_at",
      "include_prefix",
      "exclude_prefix",
      "tun_types",
      "status",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/response/{response_id}",
    "operationId": "urlscanner-get-response-text",
    "tags": [
      "URL Scanner (Deprecated)"
    ],
    "pathParams": [
      "response_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/scan",
    "operationId": "urlscanner-search-scans",
    "tags": [
      "URL Scanner (Deprecated)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "scan_id",
      "limit",
      "next_cursor",
      "date_start",
      "date_end",
      "url",
      "hostname",
      "path",
      "ip",
      "hash",
      "page_url",
      "page_hostname",
      "page_path",
      "page_asn",
      "page_ip",
      "account_scans",
      "is_malicious"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/scan/{scan_id}",
    "operationId": "urlscanner-get-scan",
    "tags": [
      "URL Scanner (Deprecated)"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": [
      "full"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/scan/{scan_id}/har",
    "operationId": "urlscanner-get-scan-har",
    "tags": [
      "URL Scanner (Deprecated)"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/scan/{scan_id}/screenshot",
    "operationId": "urlscanner-get-scan-screenshot",
    "tags": [
      "URL Scanner (Deprecated)"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": [
      "resolution"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/dom/{scan_id}",
    "operationId": "urlscanner-get-scan-dom-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/har/{scan_id}",
    "operationId": "urlscanner-get-scan-har-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/responses/{response_id}",
    "operationId": "urlscanner-get-response-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "response_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/result/{scan_id}",
    "operationId": "urlscanner-get-scan-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/screenshots/{scan_id}.png",
    "operationId": "urlscanner-get-scan-screenshot-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "scan_id",
      "account_id"
    ],
    "queryParams": [
      "resolution"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/urlscanner/v2/search",
    "operationId": "urlscanner-search-scans-v2",
    "tags": [
      "URL Scanner"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "size",
      "q"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/indexes",
    "operationId": "vectorize-(-deprecated)-list-vectorize-indexes",
    "tags": [
      "Vectorize Beta (Deprecated)"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/indexes/{index_name}",
    "operationId": "vectorize-(-deprecated)-get-vectorize-index",
    "tags": [
      "Vectorize Beta (Deprecated)"
    ],
    "pathParams": [
      "account_id",
      "index_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/v2/indexes",
    "operationId": "vectorize-list-vectorize-indexes",
    "tags": [
      "Vectorize"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}",
    "operationId": "vectorize-get-vectorize-index",
    "tags": [
      "Vectorize"
    ],
    "pathParams": [
      "account_id",
      "index_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/info",
    "operationId": "vectorize-index-info",
    "tags": [
      "Vectorize"
    ],
    "pathParams": [
      "account_id",
      "index_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/list",
    "operationId": "vectorize-list-vectors",
    "tags": [
      "Vectorize"
    ],
    "pathParams": [
      "account_id",
      "index_name"
    ],
    "queryParams": [
      "count",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/metadata_index/list",
    "operationId": "vectorize-list-metadata-indexes",
    "tags": [
      "Vectorize"
    ],
    "pathParams": [
      "account_id",
      "index_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/credential_sets",
    "operationId": "list-credential-sets",
    "tags": [
      "Credential Sets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/credential_sets/{credential_set_id}",
    "operationId": "get-credential-set",
    "tags": [
      "Credential Sets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/credential_sets/{credential_set_id}/credentials",
    "operationId": "list-credentials",
    "tags": [
      "Credentials"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/credential_sets/{credential_set_id}/credentials/{credential_id}",
    "operationId": "get-credential",
    "tags": [
      "Credentials"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/scans",
    "operationId": "list-scans",
    "tags": [
      "Scans"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/scans/{scan_id}",
    "operationId": "get-scan",
    "tags": [
      "Scans"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/target_environments",
    "operationId": "list-target-environments",
    "tags": [
      "Target Environments"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/vuln_scanner/target_environments/{target_environment_id}",
    "operationId": "get-target-environment",
    "tags": [
      "Target Environments"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/waiting_rooms",
    "operationId": "waiting-room-list-waiting-rooms-account",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector",
    "operationId": "cloudflare-tunnel-list-warp-connector-tunnels",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "is_deleted",
      "existed_at",
      "uuid",
      "was_active_at",
      "was_inactive_at",
      "include_prefix",
      "exclude_prefix",
      "status",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector/{tunnel_id}",
    "operationId": "cloudflare-tunnel-get-a-warp-connector-tunnel",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector/{tunnel_id}/configurations",
    "operationId": "cloudflare-tunnel-configuration-get-warp-connector-configuration",
    "tags": [
      "Cloudflare Tunnel Configuration"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector/{tunnel_id}/connections",
    "operationId": "cloudflare-tunnel-list-warp-connector-tunnel-connections",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector/{tunnel_id}/connectors/{connector_id}",
    "operationId": "cloudflare-tunnel-get-warp-connector-tunnel-connector",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id",
      "connector_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/warp_connector/{tunnel_id}/token",
    "operationId": "cloudflare-tunnel-get-a-warp-connector-tunnel-token",
    "tags": [
      "Cloudflare Tunnel"
    ],
    "pathParams": [
      "account_id",
      "tunnel_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/account-settings",
    "operationId": "worker-account-settings-fetch-worker-account-settings",
    "tags": [
      "Worker Account Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces",
    "operationId": "namespace-worker-list",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}",
    "operationId": "namespace-worker-get-namespace",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts",
    "operationId": "namespace-worker-list-scripts",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace"
    ],
    "queryParams": [
      "tags"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}",
    "operationId": "namespace-worker-script-worker-details",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/bindings",
    "operationId": "namespace-worker-get-script-bindings",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/content",
    "operationId": "namespace-worker-get-script-content",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets",
    "operationId": "namespace-worker-list-script-secrets",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets/{secret_name}",
    "operationId": "namespace-worker-get-script-secrets",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name",
      "secret_name"
    ],
    "queryParams": [
      "url_encoded"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/settings",
    "operationId": "namespace-worker-get-script-settings",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/tags",
    "operationId": "namespace-worker-get-script-tags",
    "tags": [
      "Workers for Platforms"
    ],
    "pathParams": [
      "account_id",
      "dispatch_namespace",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/domains",
    "operationId": "workers.domains.list",
    "tags": [
      "Domains"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "zone_id",
      "zone_name",
      "service",
      "hostname",
      "environment"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/domains/{domain_id}",
    "operationId": "workers.domains.get",
    "tags": [
      "Domains"
    ],
    "pathParams": [
      "account_id",
      "domain_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/durable_objects/namespaces",
    "operationId": "durable-objects-namespace-list-namespaces",
    "tags": [
      "Durable Objects Namespace"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/durable_objects/namespaces/{id}/objects",
    "operationId": "durable-objects-namespace-list-objects",
    "tags": [
      "Durable Objects Namespace"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": [
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/observability/destinations",
    "operationId": "destination.list",
    "tags": [
      "Destinations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "perPage",
      "order",
      "orderBy"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/observability/queries",
    "operationId": "queries.list",
    "tags": [
      "Saved Queries"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "perPage",
      "order",
      "orderBy"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/observability/queries/{queryId}",
    "operationId": "queries.get",
    "tags": [
      "Saved Queries"
    ],
    "pathParams": [
      "account_id",
      "queryId"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/observability/shared/query/{id}",
    "operationId": "shared.query.get",
    "tags": [
      "Shared",
      "Query"
    ],
    "pathParams": [
      "account_id",
      "id"
    ],
    "queryParams": [
      "view"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/observability/usage",
    "operationId": "usage.get",
    "tags": [
      "Usage"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "from",
      "to"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/placement/regions",
    "operationId": "worker-placement-list-regions",
    "tags": [
      "Worker Placement"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts",
    "operationId": "worker-script-list-workers",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "tags"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts-search",
    "operationId": "worker-script-search-workers",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "id",
      "order_by",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}",
    "operationId": "worker-script-download-worker",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/content/v2",
    "operationId": "worker-script-get-content",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
    "operationId": "worker-deployments-list-deployments",
    "tags": [
      "Worker Deployments"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/deployments/{deployment_id}",
    "operationId": "worker-deployments-get-deployment",
    "tags": [
      "Worker Deployments"
    ],
    "pathParams": [
      "account_id",
      "script_name",
      "deployment_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/schedules",
    "operationId": "worker-cron-trigger-get-cron-triggers",
    "tags": [
      "Worker Cron Trigger"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/script-settings",
    "operationId": "worker-script-settings-get-settings",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/secrets",
    "operationId": "worker-list-script-secrets",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/secrets/{secret_name}",
    "operationId": "worker-get-script-secret",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name",
      "secret_name"
    ],
    "queryParams": [
      "url_encoded"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/settings",
    "operationId": "worker-script-get-settings",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/subdomain",
    "operationId": "worker-script-get-subdomain",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/tails",
    "operationId": "worker-tail-logs-list-tails",
    "tags": [
      "Worker Tail Logs"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/usage-model",
    "operationId": "worker-script-fetch-usage-model",
    "tags": [
      "Worker Script"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/versions",
    "operationId": "worker-versions-list-versions",
    "tags": [
      "Worker Versions"
    ],
    "pathParams": [
      "account_id",
      "script_name"
    ],
    "queryParams": [
      "deployable",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}",
    "operationId": "worker-versions-get-version-detail",
    "tags": [
      "Worker Versions"
    ],
    "pathParams": [
      "account_id",
      "script_name",
      "version_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/services/{service_name}/environments/{environment_name}/content",
    "operationId": "worker-environment-get-script-content",
    "tags": [
      "Worker Environment"
    ],
    "pathParams": [
      "account_id",
      "service_name",
      "environment_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/services/{service_name}/environments/{environment_name}/settings",
    "operationId": "worker-script-environment-get-settings",
    "tags": [
      "Worker Environment"
    ],
    "pathParams": [
      "account_id",
      "service_name",
      "environment_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/subdomain",
    "operationId": "worker-subdomain-get-subdomain",
    "tags": [
      "Worker Subdomain"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/workers",
    "operationId": "listWorkers",
    "tags": [
      "Workers"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order_by",
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/workers/{worker_id}",
    "operationId": "getWorker",
    "tags": [
      "Workers"
    ],
    "pathParams": [
      "account_id",
      "worker_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/workers/{worker_id}/versions",
    "operationId": "listWorkerVersions",
    "tags": [
      "Versions"
    ],
    "pathParams": [
      "account_id",
      "worker_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workers/workers/{worker_id}/versions/{version_id}",
    "operationId": "getWorkerVersion",
    "tags": [
      "Versions"
    ],
    "pathParams": [
      "account_id",
      "worker_id",
      "version_id"
    ],
    "queryParams": [
      "include"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows",
    "operationId": "wor-list-workflows",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "per_page",
      "page",
      "search"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}",
    "operationId": "wor-get-workflow-details",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/instances",
    "operationId": "wor-list-workflow-instances",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "account_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "cursor",
      "direction",
      "status",
      "date_start",
      "date_end"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}",
    "operationId": "wor-describe-workflow-instance",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "instance_id",
      "account_id"
    ],
    "queryParams": [
      "simple",
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}/step",
    "operationId": "wor-get-workflow-instance-step",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "instance_id",
      "account_id"
    ],
    "queryParams": [
      "name",
      "type",
      "attempt"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/terminate",
    "operationId": "wor-status-terminate-workflow-instances",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/versions",
    "operationId": "wor-list-workflow-versions",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "account_id"
    ],
    "queryParams": [
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/versions/{version_id}",
    "operationId": "wor-describe-workflow-versions",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "version_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/versions/{version_id}/dag",
    "operationId": "wor-describe-workflow-versions-dag",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "version_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/workflows/{workflow_name}/versions/{version_id}/graph",
    "operationId": "wor-describe-workflow-versions-graph",
    "tags": [
      "Workflows"
    ],
    "pathParams": [
      "workflow_name",
      "version_id",
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zerotrust/connectivity_settings",
    "operationId": "zero-trust-accounts-get-connectivity-settings",
    "tags": [
      "Zero Trust Connectivity Settings"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zerotrust/routes/hostname",
    "operationId": "zero-trust-networks-route-hostname-list",
    "tags": [
      "Zero Trust Hostname Route"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "id",
      "hostname",
      "tunnel_id",
      "comment",
      "existed_at",
      "is_deleted",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zerotrust/routes/hostname/{hostname_route_id}",
    "operationId": "zero-trust-networks-route-hostname-get",
    "tags": [
      "Zero Trust Hostname Route"
    ],
    "pathParams": [
      "account_id",
      "hostname_route_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zerotrust/subnets",
    "operationId": "zero-trust-networks-subnets-list",
    "tags": [
      "Zero Trust Subnets"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": [
      "name",
      "comment",
      "network",
      "existed_at",
      "address_family",
      "is_default_network",
      "is_deleted",
      "sort_order",
      "subnet_types",
      "per_page",
      "page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zerotrust/subnets/warp/{subnet_id}",
    "operationId": "zero-trust-networks-subnet-get-warp",
    "tags": [
      "Zero Trust Subnets"
    ],
    "pathParams": [
      "account_id",
      "subnet_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/{user_id}",
    "operationId": "dlp-risk-score-summary-get-for-user",
    "tags": [
      "Zero Trust Risk Scoring"
    ],
    "pathParams": [
      "account_id",
      "user_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/behaviors",
    "operationId": "dlp-risk-score-behaviors-get",
    "tags": [
      "Zero Trust Risk Scoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/integrations",
    "operationId": "dlp-zt-risk-score-integration-list",
    "tags": [
      "Zero Trust Risk Scoring Integrations"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/integrations/{integration_id}",
    "operationId": "dlp-zt-risk-score-integration-get",
    "tags": [
      "Zero Trust Risk Scoring Integrations"
    ],
    "pathParams": [
      "account_id",
      "integration_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/integrations/reference_id/{reference_id}",
    "operationId": "dlp-zt-risk-score-integration-get-by-reference-id",
    "tags": [
      "Zero Trust Risk Scoring Integrations"
    ],
    "pathParams": [
      "account_id",
      "reference_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_id}/zt_risk_scoring/summary",
    "operationId": "dlp-risk-score-summary-get",
    "tags": [
      "Zero Trust Risk Scoring"
    ],
    "pathParams": [
      "account_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_identifier}/custom_pages",
    "operationId": "custom-pages-for-an-account-list-custom-pages",
    "tags": [
      "Custom pages for an account"
    ],
    "pathParams": [
      "account_identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_identifier}/custom_pages/{identifier}",
    "operationId": "custom-pages-for-an-account-get-a-custom-page",
    "tags": [
      "Custom pages for an account"
    ],
    "pathParams": [
      "identifier",
      "account_identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/accounts/{account_identifier}/custom_pages/assets",
    "operationId": "custom-assets-for-an-account-list-custom-assets",
    "tags": [
      "Custom assets for an account"
    ],
    "pathParams": [
      "account_identifier"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/accounts/{account_identifier}/custom_pages/assets/{asset_name}",
    "operationId": "custom-assets-for-an-account-get-a-custom-asset",
    "tags": [
      "Custom assets for an account"
    ],
    "pathParams": [
      "asset_name",
      "account_identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/applications",
    "operationId": "list_applications_v2",
    "tags": [
      "Applications"
    ],
    "pathParams": [],
    "queryParams": [
      "environment"
    ]
  },
  {
    "method": "GET",
    "path": "/applications/{slug}",
    "operationId": "get_application_v2",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "slug"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/applications/{slug}/setup-flows",
    "operationId": "get_application_setup_flows_v2",
    "tags": [
      "Applications"
    ],
    "pathParams": [
      "slug"
    ],
    "queryParams": [
      "auth_method",
      "environment"
    ]
  },
  {
    "method": "GET",
    "path": "/certificates",
    "operationId": "origin-ca-list-certificates",
    "tags": [
      "Origin CA"
    ],
    "pathParams": [],
    "queryParams": [
      "zone_id",
      "page",
      "per_page",
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/certificates/{certificate_id}",
    "operationId": "origin-ca-get-certificate",
    "tags": [
      "Origin CA"
    ],
    "pathParams": [
      "certificate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/integrations",
    "operationId": "list_integrations_v2",
    "tags": [
      "Integrations"
    ],
    "pathParams": [],
    "queryParams": [
      "application",
      "direction",
      "dlp_enabled",
      "order",
      "page",
      "page_size",
      "search",
      "status",
      "use_cases"
    ]
  },
  {
    "method": "GET",
    "path": "/integrations/{id}",
    "operationId": "get_integration_v2",
    "tags": [
      "Integrations"
    ],
    "pathParams": [
      "id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/ips",
    "operationId": "cloudflare-ips-cloudflare-ip-details",
    "tags": [
      "Cloudflare IPs"
    ],
    "pathParams": [],
    "queryParams": [
      "networks"
    ]
  },
  {
    "method": "GET",
    "path": "/live",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/memberships",
    "operationId": "user'-s-account-memberships-list-memberships",
    "tags": [
      "User's Account Memberships"
    ],
    "pathParams": [],
    "queryParams": [
      "account.name",
      "page",
      "per_page",
      "order",
      "direction",
      "name",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/memberships/{membership_id}",
    "operationId": "user'-s-account-memberships-membership-details",
    "tags": [
      "User's Account Memberships"
    ],
    "pathParams": [
      "membership_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/oauth/scopes",
    "operationId": "oauth-scopes-list",
    "tags": [
      "OAuth Clients"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations",
    "operationId": "Organization_listOrganizations",
    "tags": [
      "Organizations"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}",
    "operationId": "Organizations_retrieve",
    "tags": [
      "Organizations"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/accounts",
    "operationId": "Organizations_getAccounts",
    "tags": [
      "Organizations"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": [
      "account_pubname",
      "account_pubname.startsWith",
      "account_pubname.endsWith",
      "account_pubname.contains",
      "name",
      "name.startsWith",
      "name.endsWith",
      "name.contains",
      "order_by",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/billable/usage",
    "operationId": "billable-usage-v2-get-organization-usage",
    "tags": [
      "Billable Usage V2"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/logs/audit",
    "operationId": "audit-logs-v2-get-organization-audit-logs",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": [
      "action_result",
      "action_type",
      "actor_context",
      "actor_email",
      "actor_id",
      "actor_ip_address",
      "actor_token_id",
      "actor_token_name",
      "actor_type",
      "id",
      "raw_cf_ray_id",
      "raw_method",
      "raw_status_code",
      "raw_uri",
      "resource_id",
      "resource_product",
      "resource_type",
      "resource_scope",
      "action_result.not",
      "action_type.not",
      "actor_context.not",
      "actor_email.not",
      "actor_id.not",
      "actor_ip_address.not",
      "actor_token_id.not",
      "actor_token_name.not",
      "actor_type.not",
      "id.not",
      "raw_cf_ray_id.not",
      "raw_method.not",
      "raw_status_code.not",
      "raw_uri.not",
      "resource_id.not",
      "resource_product.not",
      "resource_type.not",
      "resource_scope.not",
      "since",
      "before",
      "direction",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/logs/audit/{id}/history",
    "operationId": "audit-logs-v2-get-organization-audit-log-history",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [
      "organization_id",
      "id"
    ],
    "queryParams": [
      "action_time",
      "since",
      "before",
      "direction",
      "limit",
      "cursor"
    ]
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/members",
    "operationId": "Members_list",
    "tags": [
      "OrganizationMembers"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": [
      "status",
      "user.email",
      "user.email.contains",
      "user.email.startsWith",
      "user.email.endsWith"
    ]
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/members/{member_id}",
    "operationId": "Members_retrieve",
    "tags": [
      "OrganizationMembers"
    ],
    "pathParams": [
      "organization_id",
      "member_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/profile",
    "operationId": "Organizations_getProfile",
    "tags": [
      "Organizations"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/organizations/{organization_id}/shares",
    "operationId": "organization-shares-list",
    "tags": [
      "Resource Sharing"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/radar/agent_readiness/summary/{dimension}",
    "operationId": "radar-get-agent-readiness-summary",
    "tags": [
      "Radar Agent Readiness"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "date",
      "domainCategory",
      "name",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/bots/summary/{dimension}",
    "operationId": "radar-get-ai-bots-summary",
    "tags": [
      "Radar AI Bots"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "crawlPurpose",
      "userAgent",
      "vertical",
      "industry",
      "contentType",
      "responseStatus",
      "responseStatusCategory",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/bots/summary/user_agent",
    "operationId": "radar-get-ai-bots-summary-by-user-agent",
    "tags": [
      "Radar AI Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/bots/timeseries",
    "operationId": "radar-get-ai-bots-timeseries",
    "tags": [
      "Radar AI Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "crawlPurpose",
      "userAgent",
      "industry",
      "vertical",
      "contentType",
      "responseStatus",
      "responseStatusCategory",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/bots/timeseries_groups/{dimension}",
    "operationId": "radar-get-ai-bots-timeseries-group",
    "tags": [
      "Radar AI Bots"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "crawlPurpose",
      "userAgent",
      "industry",
      "vertical",
      "contentType",
      "responseStatus",
      "responseStatusCategory",
      "limitPerGroup",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/bots/timeseries_groups/user_agent",
    "operationId": "radar-get-ai-bots-timeseries-group-by-user-agent",
    "tags": [
      "Radar AI Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/summary/{dimension}",
    "operationId": "radar-get-ai-inference-summary",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/summary/model",
    "operationId": "radar-get-ai-inference-summary-by-model",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/summary/task",
    "operationId": "radar-get-ai-inference-summary-by-task",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/timeseries_groups/{dimension}",
    "operationId": "radar-get-ai-inference-timeseries-group",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/timeseries_groups/model",
    "operationId": "radar-get-ai-inference-timeseries-group-by-model",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/inference/timeseries_groups/task",
    "operationId": "radar-get-ai-inference-timeseries-group-by-task",
    "tags": [
      "Radar AI Inference"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/markdown_for_agents/summary",
    "operationId": "radar-get-ai-markdown-for-agents-summary",
    "tags": [
      "Radar Markdown for Agents"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ai/markdown_for_agents/timeseries",
    "operationId": "radar-get-ai-markdown-for-agents-timeseries",
    "tags": [
      "Radar Markdown for Agents"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/annotations",
    "operationId": "radar-get-annotations",
    "tags": [
      "Radar Annotations"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "dateRange",
      "dateStart",
      "dateEnd",
      "dataSource",
      "eventType",
      "asn",
      "location",
      "origin",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/annotations/outages",
    "operationId": "radar-get-annotations-outages",
    "tags": [
      "Radar Annotations"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "origin",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/annotations/outages/locations",
    "operationId": "radar-get-annotations-outages-top",
    "tags": [
      "Radar Annotations"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/{dimension}",
    "operationId": "radar-get-dns-as112-summary",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/dnssec",
    "operationId": "radar-get-dns-as112-timeseries-by-dnssec",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/edns",
    "operationId": "radar-get-dns-as112-timeseries-by-edns",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/ip_version",
    "operationId": "radar-get-dns-as112-timeseries-by-ip-version",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/protocol",
    "operationId": "radar-get-dns-as112-timeseries-by-protocol",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/query_type",
    "operationId": "radar-get-dns-as112-timeseries-by-query-type",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "protocol",
      "responseCode",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/summary/response_codes",
    "operationId": "radar-get-dns-as112-timeseries-by-response-codes",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries",
    "operationId": "radar-get-dns-as112-timeseries",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/{dimension}",
    "operationId": "radar-get-dns-as112-timeseries-group",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/dnssec",
    "operationId": "radar-get-dns-as112-timeseries-group-by-dnssec",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/edns",
    "operationId": "radar-get-dns-as112-timeseries-group-by-edns",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/ip_version",
    "operationId": "radar-get-dns-as112-timeseries-group-by-ip-version",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/protocol",
    "operationId": "radar-get-dns-as112-timeseries-group-by-protocol",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "responseCode",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/query_type",
    "operationId": "radar-get-dns-as112-timeseries-group-by-query-type",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "protocol",
      "responseCode",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/timeseries_groups/response_codes",
    "operationId": "radar-get-dns-as112-timeseries-group-by-response-codes",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "queryType",
      "protocol",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/top/locations",
    "operationId": "radar-get-dns-as112-top-locations",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/top/locations/dnssec/{dnssec}",
    "operationId": "radar-get-dns-as112-top-locations-by-dnssec",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [
      "dnssec"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/top/locations/edns/{edns}",
    "operationId": "radar-get-dns-as112-top-locations-by-edns",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [
      "edns"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/as112/top/locations/ip_version/{ip_version}",
    "operationId": "radar-get-dns-as112-top-locations-by-ip-version",
    "tags": [
      "Radar AS112"
    ],
    "pathParams": [
      "ip_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/{dimension}",
    "operationId": "radar-get-attacks-layer3-summary",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/bitrate",
    "operationId": "radar-get-attacks-layer3-summary-by-bitrate",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/duration",
    "operationId": "radar-get-attacks-layer3-summary-by-duration",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/industry",
    "operationId": "radar-get-attacks-layer3-summary-by-industry",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/ip_version",
    "operationId": "radar-get-attacks-layer3-summary-by-ip-version",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "protocol",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/protocol",
    "operationId": "radar-get-attacks-layer3-summary-by-protocol",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/vector",
    "operationId": "radar-get-attacks-layer3-summary-by-vector",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/summary/vertical",
    "operationId": "radar-get-attacks-layer3-summary-by-vertical",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries",
    "operationId": "radar-get-attacks-layer3-timeseries-by-bytes",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "metric",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/{dimension}",
    "operationId": "radar-get-attacks-layer3-timeseries-group",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/bitrate",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-bitrate",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/duration",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-duration",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/industry",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-industry",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/ip_version",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-ip-version",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "protocol",
      "normalization",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/protocol",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-protocol",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "normalization",
      "direction",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/vector",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-vector",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/timeseries_groups/vertical",
    "operationId": "radar-get-attacks-layer3-timeseries-group-by-vertical",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "normalization",
      "direction",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/top/attacks",
    "operationId": "radar-get-attacks-layer3-top-attacks",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "limitDirection",
      "limitPerLocation",
      "magnitude",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/top/industry",
    "operationId": "radar-get-attacks-layer3-top-industries",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/top/locations/origin",
    "operationId": "radar-get-attacks-layer3-top-origin-locations",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/top/locations/target",
    "operationId": "radar-get-attacks-layer3-top-target-locations",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer3/top/vertical",
    "operationId": "radar-get-attacks-layer3-top-verticals",
    "tags": [
      "Radar Layer 3 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "protocol",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/{dimension}",
    "operationId": "radar-get-attacks-layer7-summary",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/http_method",
    "operationId": "radar-get-attacks-layer7-summary-by-http-method",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "mitigationProduct",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/http_version",
    "operationId": "radar-get-attacks-layer7-summary-by-http-version",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/industry",
    "operationId": "radar-get-attacks-layer7-summary-by-industry",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/ip_version",
    "operationId": "radar-get-attacks-layer7-summary-by-ip-version",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/managed_rules",
    "operationId": "radar-get-attacks-layer7-summary-by-managed-rules",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/mitigation_product",
    "operationId": "radar-get-attacks-layer7-summary-by-mitigation-product",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/summary/vertical",
    "operationId": "radar-get-attacks-layer7-summary-by-vertical",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries",
    "operationId": "radar-get-attacks-layer7-timeseries",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "normalization",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/{dimension}",
    "operationId": "radar-get-attacks-layer7-timeseries-group",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/http_method",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-http-method",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "mitigationProduct",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/http_version",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-http-version",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/industry",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-industry",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/ip_version",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-ip-version",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/managed_rules",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-managed-rules",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/mitigation_product",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-mitigation-product",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/timeseries_groups/vertical",
    "operationId": "radar-get-attacks-layer7-timeseries-group-by-vertical",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "normalization",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/ases/origin",
    "operationId": "radar-get-attacks-layer7-top-origin-as",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/attacks",
    "operationId": "radar-get-attacks-layer7-top-attacks",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "mitigationProduct",
      "limitDirection",
      "limitPerLocation",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/industry",
    "operationId": "radar-get-attacks-layer7-top-industries",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/locations/origin",
    "operationId": "radar-get-attacks-layer7-top-origin-location",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/locations/target",
    "operationId": "radar-get-attacks-layer7-top-target-location",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "continent",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/attacks/layer7/top/vertical",
    "operationId": "radar-get-attacks-layer7-top-verticals",
    "tags": [
      "Radar Layer 7 Attacks"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "ipVersion",
      "httpVersion",
      "httpMethod",
      "mitigationProduct",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/hijacks/events",
    "operationId": "radar-get-bgp-hijacks-events",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "page",
      "per_page",
      "eventId",
      "hijackerAsn",
      "victimAsn",
      "involvedAsn",
      "involvedCountry",
      "prefix",
      "minConfidence",
      "maxConfidence",
      "dateRange",
      "dateStart",
      "dateEnd",
      "sortBy",
      "sortOrder",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/ips/timeseries",
    "operationId": "radar-get-bgp-ips-timeseries",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "ipVersion",
      "includeDelay",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/ips/top/ases",
    "operationId": "radar-get-bgp-ips-top-ases",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "date",
      "limit",
      "metric",
      "country",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/leaks/events",
    "operationId": "radar-get-bgp-route-leak-events",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "page",
      "per_page",
      "eventId",
      "leakAsn",
      "involvedAsn",
      "involvedCountry",
      "dateRange",
      "dateStart",
      "dateEnd",
      "sortBy",
      "sortOrder",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/routes/ases",
    "operationId": "radar-get-bgp-routes-asns",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "location",
      "limit",
      "sortBy",
      "sortOrder",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/routes/moas",
    "operationId": "radar-get-bgp-pfx2as-moas",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "origin",
      "prefix",
      "invalid_only",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/routes/pfx2as",
    "operationId": "radar-get-bgp-pfx2as",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "prefix",
      "origin",
      "rpkiStatus",
      "longestPrefixMatch",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/routes/realtime",
    "operationId": "radar-get-bgp-routes-realtime",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "prefix",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/routes/stats",
    "operationId": "radar-get-bgp-routes-stats",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "asn",
      "location",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/rpki/aspa/changes",
    "operationId": "radar-get-bgp-rpki-aspa-changes",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "dateStart",
      "dateEnd",
      "asn",
      "includeAsnInfo",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/rpki/aspa/snapshot",
    "operationId": "radar-get-bgp-rpki-aspa-snapshot",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "customerAsn",
      "providerAsn",
      "date",
      "includeAsnInfo",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/rpki/aspa/timeseries",
    "operationId": "radar-get-bgp-rpki-aspa-timeseries",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "dateStart",
      "dateEnd",
      "name",
      "rir",
      "location",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/rpki/roas/timeseries",
    "operationId": "radar-get-bgp-rpki-roas-timeseries",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "dateStart",
      "dateEnd",
      "metric",
      "asn",
      "location",
      "name",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/timeseries",
    "operationId": "radar-get-bgp-timeseries",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "prefix",
      "updateType",
      "asn",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/top/ases",
    "operationId": "radar-get-bgp-top-ases",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "prefix",
      "updateType",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/top/ases/prefixes",
    "operationId": "radar-get-bgp-top-asns-by-prefixes",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "country",
      "limit",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bgp/top/prefixes",
    "operationId": "radar-get-bgp-top-prefixes",
    "tags": [
      "Radar BGP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "updateType",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots",
    "operationId": "radar-get-bots",
    "tags": [
      "Radar Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "botCategory",
      "botOperator",
      "kind",
      "botVerificationStatus",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/{bot_slug}",
    "operationId": "radar-get-bot-details",
    "tags": [
      "Radar Bots"
    ],
    "pathParams": [
      "bot_slug"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/crawlers/summary/{dimension}",
    "operationId": "radar-get-crawlers-summary",
    "tags": [
      "Radar Web Crawlers"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "botOperator",
      "vertical",
      "industry",
      "clientType",
      "responseStatus",
      "responseStatusCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/crawlers/timeseries_groups/{dimension}",
    "operationId": "radar-get-crawlers-timeseries-group",
    "tags": [
      "Radar Web Crawlers"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "normalization",
      "botOperator",
      "vertical",
      "industry",
      "clientType",
      "responseStatus",
      "responseStatusCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/summary/{dimension}",
    "operationId": "radar-get-bots-summary",
    "tags": [
      "Radar Bots"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "bot",
      "botOperator",
      "botCategory",
      "botKind",
      "botVerificationStatus",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/timeseries",
    "operationId": "radar-get-bots-timeseries",
    "tags": [
      "Radar Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "bot",
      "botOperator",
      "botCategory",
      "botKind",
      "botVerificationStatus",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/bots/timeseries_groups/{dimension}",
    "operationId": "radar-get-bots-timeseries-group",
    "tags": [
      "Radar Bots"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "limitPerGroup",
      "bot",
      "botOperator",
      "botCategory",
      "botKind",
      "botVerificationStatus",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/authorities",
    "operationId": "radar-get-certificate-authorities",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/authorities/{ca_slug}",
    "operationId": "radar-get-certificate-authority-details",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [
      "ca_slug"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/logs",
    "operationId": "radar-get-certificate-logs",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/logs/{log_slug}",
    "operationId": "radar-get-certificate-log-details",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [
      "log_slug"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/summary/{dimension}",
    "operationId": "radar-get-ct-summary",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "ca",
      "caOwner",
      "duration",
      "entryType",
      "expirationStatus",
      "hasIps",
      "hasWildcards",
      "log",
      "logApi",
      "logOperator",
      "publicKeyAlgorithm",
      "signatureAlgorithm",
      "tld",
      "validationLevel",
      "uniqueEntries",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/timeseries",
    "operationId": "radar-get-ct-timeseries",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "ca",
      "caOwner",
      "duration",
      "entryType",
      "expirationStatus",
      "hasIps",
      "hasWildcards",
      "log",
      "logApi",
      "logOperator",
      "publicKeyAlgorithm",
      "signatureAlgorithm",
      "tld",
      "validationLevel",
      "uniqueEntries",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ct/timeseries_groups/{dimension}",
    "operationId": "radar-get-ct-timeseries-group",
    "tags": [
      "Radar Certificate Transparency"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "ca",
      "caOwner",
      "duration",
      "entryType",
      "expirationStatus",
      "hasIps",
      "hasWildcards",
      "log",
      "logApi",
      "logOperator",
      "publicKeyAlgorithm",
      "signatureAlgorithm",
      "validationLevel",
      "tld",
      "normalization",
      "uniqueEntries",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/datasets",
    "operationId": "radar-get-reports-datasets",
    "tags": [
      "Radar Datasets"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "datasetType",
      "date",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/datasets/{alias}",
    "operationId": "radar-get-reports-dataset-download",
    "tags": [
      "Radar Datasets"
    ],
    "pathParams": [
      "alias"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/{dimension}",
    "operationId": "radar-get-dns-summary",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "cacheHit",
      "nodata",
      "protocol",
      "queryType",
      "responseCode",
      "responseTtl",
      "dnssec",
      "dnssecAware",
      "dnssecE2e",
      "ipVersion",
      "limitPerGroup",
      "matchingAnswer",
      "tld",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/cache_hit",
    "operationId": "radar-get-dns-summary-by-cache-hit-status",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/dnssec",
    "operationId": "radar-get-dns-summary-by-dnssec",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/dnssec_aware",
    "operationId": "radar-get-dns-summary-by-dnssec-awareness",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/dnssec_e2e",
    "operationId": "radar-get-dns-summary-by-dnssec-e2e-version",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/ip_version",
    "operationId": "radar-get-dns-summary-by-ip-version",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/matching_answer",
    "operationId": "radar-get-dns-summary-by-matching-answer-status",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/protocol",
    "operationId": "radar-get-dns-summary-by-protocol",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/query_type",
    "operationId": "radar-get-dns-summary-by-query-type",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "protocol",
      "responseCode",
      "nodata",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/response_code",
    "operationId": "radar-get-dns-summary-by-response-code",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "nodata",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/summary/response_ttl",
    "operationId": "radar-get-dns-summary-by-response-ttl",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries",
    "operationId": "radar-get-dns-timeseries",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "cacheHit",
      "nodata",
      "protocol",
      "queryType",
      "responseCode",
      "responseTtl",
      "dnssec",
      "dnssecAware",
      "dnssecE2e",
      "ipVersion",
      "matchingAnswer",
      "tld",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/{dimension}",
    "operationId": "radar-get-dns-timeseries-group",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "cacheHit",
      "nodata",
      "protocol",
      "queryType",
      "responseCode",
      "responseTtl",
      "dnssec",
      "dnssecAware",
      "dnssecE2e",
      "ipVersion",
      "limitPerGroup",
      "matchingAnswer",
      "tld",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/cache_hit",
    "operationId": "radar-get-dns-timeseries-group-by-cache-hit-status",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/dnssec",
    "operationId": "radar-get-dns-timeseries-group-by-dnssec",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/dnssec_aware",
    "operationId": "radar-get-dns-timeseries-group-by-dnssec-awareness",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/dnssec_e2e",
    "operationId": "radar-get-dns-timeseries-group-by-dnssec-e2e-version",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/ip_version",
    "operationId": "radar-get-dns-timeseries-group-by-ip-version",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/matching_answer",
    "operationId": "radar-get-dns-timeseries-group-by-matching-answer-status",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/protocol",
    "operationId": "radar-get-dns-timeseries-group-by-protocol",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/query_type",
    "operationId": "radar-get-dns-timeseries-group-by-query-type",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "protocol",
      "responseCode",
      "nodata",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/response_code",
    "operationId": "radar-get-dns-timeseries-group-by-response-code",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "nodata",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/timeseries_groups/response_ttl",
    "operationId": "radar-get-dns-timeseries-group-by-response-ttl",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "tld",
      "queryType",
      "protocol",
      "responseCode",
      "nodata",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/top/ases",
    "operationId": "radar-get-dns-top-ases",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "domain",
      "cacheHit",
      "nodata",
      "protocol",
      "queryType",
      "responseCode",
      "responseTtl",
      "dnssec",
      "dnssecAware",
      "dnssecE2e",
      "ipVersion",
      "matchingAnswer",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/dns/top/locations",
    "operationId": "radar-get-dns-top-locations",
    "tags": [
      "Radar DNS"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "domain",
      "cacheHit",
      "nodata",
      "protocol",
      "queryType",
      "responseCode",
      "responseTtl",
      "dnssec",
      "dnssecAware",
      "dnssecE2e",
      "ipVersion",
      "matchingAnswer",
      "tld",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/{dimension}",
    "operationId": "radar-get-email-routing-summary",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/arc",
    "operationId": "radar-get-email-routing-summary-by-arc",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/dkim",
    "operationId": "radar-get-email-routing-summary-by-dkim",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/dmarc",
    "operationId": "radar-get-email-routing-summary-by-dmarc",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/encrypted",
    "operationId": "radar-get-email-routing-summary-by-encrypted",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/ip_version",
    "operationId": "radar-get-email-routing-summary-by-ip-version",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/summary/spf",
    "operationId": "radar-get-email-routing-summary-by-spf",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/{dimension}",
    "operationId": "radar-get-email-routing-timeseries-group",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/arc",
    "operationId": "radar-get-email-routing-timeseries-group-by-arc",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/dkim",
    "operationId": "radar-get-email-routing-timeseries-group-by-dkim",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dmarc",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/dmarc",
    "operationId": "radar-get-email-routing-timeseries-group-by-dmarc",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "spf",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/encrypted",
    "operationId": "radar-get-email-routing-timeseries-group-by-encrypted",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "ipVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/ip_version",
    "operationId": "radar-get-email-routing-timeseries-group-by-ip-version",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/routing/timeseries_groups/spf",
    "operationId": "radar-get-email-routing-timeseries-group-by-spf",
    "tags": [
      "Radar Email Routing"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "ipVersion",
      "encrypted",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/{dimension}",
    "operationId": "radar-get-email-security-summary",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/arc",
    "operationId": "radar-get-email-security-summary-by-arc",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/dkim",
    "operationId": "radar-get-email-security-summary-by-dkim",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/dmarc",
    "operationId": "radar-get-email-security-summary-by-dmarc",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/malicious",
    "operationId": "radar-get-email-security-summary-by-malicious",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/spam",
    "operationId": "radar-get-email-security-summary-by-spam",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/spf",
    "operationId": "radar-get-email-security-summary-by-spf",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/spoof",
    "operationId": "radar-get-email-security-summary-by-spoof",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/threat_category",
    "operationId": "radar-get-email-security-summary-by-threat-category",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/summary/tls_version",
    "operationId": "radar-get-email-security-summary-by-tls-version",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/{dimension}",
    "operationId": "radar-get-email-security-timeseries-group",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/arc",
    "operationId": "radar-get-email-security-timeseries-group-by-arc",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/dkim",
    "operationId": "radar-get-email-security-timeseries-group-by-dkim",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/dmarc",
    "operationId": "radar-get-email-security-timeseries-group-by-dmarc",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/malicious",
    "operationId": "radar-get-email-security-timeseries-group-by-malicious",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/spam",
    "operationId": "radar-get-email-security-timeseries-group-by-spam",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/spf",
    "operationId": "radar-get-email-security-timeseries-group-by-spf",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/spoof",
    "operationId": "radar-get-email-security-timeseries-group-by-spoof",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/threat_category",
    "operationId": "radar-get-email-security-timeseries-group-by-threat-category",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/timeseries_groups/tls_version",
    "operationId": "radar-get-email-security-timeseries-group-by-tls-version",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/top/tlds",
    "operationId": "radar-get-email-security-top-tlds-by-messages",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "tldCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/top/tlds/malicious/{malicious}",
    "operationId": "radar-get-email-security-top-tlds-by-malicious",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [
      "malicious"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "tldCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/top/tlds/spam/{spam}",
    "operationId": "radar-get-email-security-top-tlds-by-spam",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [
      "spam"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "tldCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/email/security/top/tlds/spoof/{spoof}",
    "operationId": "radar-get-email-security-top-tlds-by-spoof",
    "tags": [
      "Radar Email Security"
    ],
    "pathParams": [
      "spoof"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "arc",
      "dkim",
      "dmarc",
      "spf",
      "tlsVersion",
      "tldCategory",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns",
    "operationId": "radar-get-entities-asn-list",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "asn",
      "location",
      "orderBy",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns/{asn}",
    "operationId": "radar-get-entities-asn-by-id",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [
      "asn"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns/{asn}/as_set",
    "operationId": "radar-get-asns-as-set",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [
      "asn"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns/{asn}/rel",
    "operationId": "radar-get-asns-rel",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [
      "asn"
    ],
    "queryParams": [
      "asn2",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns/botnet_threat_feed",
    "operationId": "radar-get-as-botnet-threat-feed",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "metric",
      "date",
      "compareDateRange",
      "location",
      "asn",
      "sortOrder",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/asns/ip",
    "operationId": "radar-get-entities-asn-by-ip",
    "tags": [
      "Radar Autonomous Systems"
    ],
    "pathParams": [],
    "queryParams": [
      "ip",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/ip",
    "operationId": "radar-get-entities-ip",
    "tags": [
      "Radar IP"
    ],
    "pathParams": [],
    "queryParams": [
      "ip",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/locations",
    "operationId": "radar-get-entities-locations",
    "tags": [
      "Radar Locations"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "location",
      "region",
      "subregion",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/entities/locations/{location}",
    "operationId": "radar-get-entities-location-by-alpha2",
    "tags": [
      "Radar Locations"
    ],
    "pathParams": [
      "location"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/geolocations",
    "operationId": "radar-get-geolocations",
    "tags": [
      "Radar Geolocations"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "geoId",
      "location",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/geolocations/{geo_id}",
    "operationId": "radar-get-geolocation-details",
    "tags": [
      "Radar Geolocations"
    ],
    "pathParams": [
      "geo_id"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/{dimension}",
    "operationId": "radar-get-http-summary",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "apiTraffic",
      "botClass",
      "contentType",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/bot_class",
    "operationId": "radar-get-http-summary-by-bot-class",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/device_type",
    "operationId": "radar-get-http-summary-by-device-type",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/http_protocol",
    "operationId": "radar-get-http-summary-by-http-protocol",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/http_version",
    "operationId": "radar-get-http-summary-by-http-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/ip_version",
    "operationId": "radar-get-http-summary-by-ip-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/os",
    "operationId": "radar-get-http-summary-by-operating-system",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/post_quantum",
    "operationId": "radar-get-http-summary-by-post-quantum",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/summary/tls_version",
    "operationId": "radar-get-http-summary-by-tls-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries",
    "operationId": "radar-get-http-timeseries",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "normalization",
      "apiTraffic",
      "botClass",
      "contentType",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/{dimension}",
    "operationId": "radar-get-http-timeseries-group",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "apiTraffic",
      "botClass",
      "contentType",
      "limitPerGroup",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "normalization",
      "ipVersion",
      "os",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/bot_class",
    "operationId": "radar-get-http-timeseries-group-by-bot-class",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/browser",
    "operationId": "radar-get-http-timeseries-group-by-browsers",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/browser_family",
    "operationId": "radar-get-http-timeseries-group-by-browser-families",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/device_type",
    "operationId": "radar-get-http-timeseries-group-by-device-type",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/http_protocol",
    "operationId": "radar-get-http-timeseries-group-by-http-protocol",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/http_version",
    "operationId": "radar-get-http-timeseries-group-by-http-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/ip_version",
    "operationId": "radar-get-http-timeseries-group-by-ip-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/os",
    "operationId": "radar-get-http-timeseries-group-by-operating-system",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/post_quantum",
    "operationId": "radar-get-http-timeseries-group-by-post-quantum",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/timeseries_groups/tls_version",
    "operationId": "radar-get-http-timeseries-group-by-tls-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases",
    "operationId": "radar-get-http-top-ases-by-http-requests",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/bot_class/{bot_class}",
    "operationId": "radar-get-http-top-ases-by-bot-class",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "bot_class"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/browser_family/{browser_family}",
    "operationId": "radar-get-http-top-ases-by-browser-family",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "browser_family"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/device_type/{device_type}",
    "operationId": "radar-get-http-top-ases-by-device-type",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "device_type"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/http_protocol/{http_protocol}",
    "operationId": "radar-get-http-top-ases-by-http-protocol",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "http_protocol"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/http_version/{http_version}",
    "operationId": "radar-get-http-top-ases-by-http-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "http_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/ip_version/{ip_version}",
    "operationId": "radar-get-http-top-ases-by-ip-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "ip_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/os/{os}",
    "operationId": "radar-get-http-top-ases-by-operating-system",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "os"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/ases/tls_version/{tls_version}",
    "operationId": "radar-get-http-top-ases-by-tls-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "tls_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/browser",
    "operationId": "radar-get-http-top-browsers",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/browser_family",
    "operationId": "radar-get-http-top-browser-families",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations",
    "operationId": "radar-get-http-top-locations-by-http-requests",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/bot_class/{bot_class}",
    "operationId": "radar-get-http-top-locations-by-bot-class",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "bot_class"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/browser_family/{browser_family}",
    "operationId": "radar-get-http-top-locations-by-browser-family",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "browser_family"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/device_type/{device_type}",
    "operationId": "radar-get-http-top-locations-by-device-type",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "device_type"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/http_protocol/{http_protocol}",
    "operationId": "radar-get-http-top-locations-by-http-protocol",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "http_protocol"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpVersion",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/http_version/{http_version}",
    "operationId": "radar-get-http-top-locations-by-http-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "http_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "ipVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/ip_version/{ip_version}",
    "operationId": "radar-get-http-top-locations-by-ip-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "ip_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "os",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/os/{os}",
    "operationId": "radar-get-http-top-locations-by-operating-system",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "os"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "tlsVersion",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/http/top/locations/tls_version/{tls_version}",
    "operationId": "radar-get-http-top-locations-by-tls-version",
    "tags": [
      "Radar HTTP"
    ],
    "pathParams": [
      "tls_version"
    ],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "botClass",
      "deviceType",
      "httpProtocol",
      "httpVersion",
      "ipVersion",
      "os",
      "browserFamily",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/summary/{dimension}",
    "operationId": "radar-get-leaked-credential-checks-summary",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "botClass",
      "compromised",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/summary/bot_class",
    "operationId": "radar-get-leaked-credential-checks-summary-by-bot-class",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "compromised",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/summary/compromised",
    "operationId": "radar-get-leaked-credential-checks-summary-by-compromised",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "botClass",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/timeseries_groups/{dimension}",
    "operationId": "radar-get-leaked-credential-checks-timeseries-group",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "botClass",
      "compromised",
      "checkResult",
      "limitPerGroup",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/timeseries_groups/bot_class",
    "operationId": "radar-get-leaked-credential-checks-timeseries-group-by-bot-class",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "compromised",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/leaked_credential_checks/timeseries_groups/compromised",
    "operationId": "radar-get-leaked-credential-checks-timeseries-group-by-compromised",
    "tags": [
      "Radar Leaked Credential Checks"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "botClass",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/summary",
    "operationId": "radar-get-netflows-summary-deprecated",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/summary/{dimension}",
    "operationId": "radar-get-netflows-summary",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "product",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/timeseries",
    "operationId": "radar-get-netflows-timeseries",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "product",
      "asn",
      "location",
      "continent",
      "geoId",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/timeseries_groups/{dimension}",
    "operationId": "radar-get-netflows-timeseries-group",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "limitPerGroup",
      "normalization",
      "product",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/top/ases",
    "operationId": "radar-get-netflows-top-ases",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/netflows/top/locations",
    "operationId": "radar-get-netflows-top-locations",
    "tags": [
      "Radar NetFlows"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "geoId",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/origins",
    "operationId": "radar-get-origins",
    "tags": [
      "Radar Origins"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/origins/{slug}",
    "operationId": "radar-get-origin-details",
    "tags": [
      "Radar Origins"
    ],
    "pathParams": [
      "slug"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/origins/summary/{dimension}",
    "operationId": "radar-get-origins-summary",
    "tags": [
      "Radar Origins"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "origin",
      "metric",
      "region",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/origins/timeseries",
    "operationId": "radar-get-origins-timeseries",
    "tags": [
      "Radar Origins"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "origin",
      "metric",
      "region",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/origins/timeseries_groups/{dimension}",
    "operationId": "radar-get-origins-timeseries-group",
    "tags": [
      "Radar Origins"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "limitPerGroup",
      "origin",
      "metric",
      "region",
      "normalization",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/post_quantum/origin/summary/{dimension}",
    "operationId": "radar-get-origin-post-quantum-summary",
    "tags": [
      "Radar Post-Quantum"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/post_quantum/origin/timeseries_groups/{dimension}",
    "operationId": "radar-get-origin-post-quantum-timeseries-groups",
    "tags": [
      "Radar Post-Quantum"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/post_quantum/tls/support",
    "operationId": "radar-get-post-quantum-tls-support",
    "tags": [
      "Radar Post-Quantum"
    ],
    "pathParams": [],
    "queryParams": [
      "host"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/iqi/summary",
    "operationId": "radar-get-quality-index-summary",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "metric",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/iqi/timeseries_groups",
    "operationId": "radar-get-quality-index-timeseries-group",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "interpolation",
      "metric",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/speed/histogram",
    "operationId": "radar-get-quality-speed-histogram",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "bucketSize",
      "metricGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/speed/summary",
    "operationId": "radar-get-quality-speed-summary",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/speed/top/ases",
    "operationId": "radar-get-quality-speed-top-ases",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "orderBy",
      "reverse",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/quality/speed/top/locations",
    "operationId": "radar-get-quality-speed-top-locations",
    "tags": [
      "Radar Quality"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "orderBy",
      "reverse",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/domain/{domain}",
    "operationId": "radar-get-ranking-domain-details",
    "tags": [
      "Radar Domains Ranking"
    ],
    "pathParams": [
      "domain"
    ],
    "queryParams": [
      "limit",
      "rankingType",
      "name",
      "includeTopLocations",
      "date",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/internet_services/categories",
    "operationId": "radar-get-ranking-internet-services-categories",
    "tags": [
      "Radar Internet Services Ranking"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "date",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/internet_services/timeseries_groups",
    "operationId": "radar-get-ranking-internet-services-timeseries",
    "tags": [
      "Radar Internet Services Ranking"
    ],
    "pathParams": [],
    "queryParams": [
      "serviceCategory",
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/internet_services/top",
    "operationId": "radar-get-ranking-top-internet-services",
    "tags": [
      "Radar Internet Services Ranking"
    ],
    "pathParams": [],
    "queryParams": [
      "serviceCategory",
      "limit",
      "name",
      "date",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/timeseries_groups",
    "operationId": "radar-get-ranking-domain-timeseries",
    "tags": [
      "Radar Domains Ranking"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "rankingType",
      "name",
      "location",
      "domains",
      "domainCategory",
      "dateRange",
      "dateStart",
      "dateEnd",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/ranking/top",
    "operationId": "radar-get-ranking-top-domains",
    "tags": [
      "Radar Domains Ranking"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "location",
      "domainCategory",
      "date",
      "rankingType",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/robots_txt/top/domain_categories",
    "operationId": "radar-get-robots-txt-top-domain-categories-by-files-parsed",
    "tags": [
      "Radar Robots.txt"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "userAgentCategory",
      "date",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/robots_txt/top/user_agents/directive",
    "operationId": "radar-get-robots-txt-top-user-agents-by-directive",
    "tags": [
      "Radar Robots.txt"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "userAgentCategory",
      "date",
      "domainCategory",
      "directive",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/search/global",
    "operationId": "radar-get-search-global",
    "tags": [
      "Radar Search"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "limitPerGroup",
      "query",
      "include",
      "exclude",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tcp_resets_timeouts/summary",
    "operationId": "radar-get-tcp-resets-timeouts-summary",
    "tags": [
      "Radar TCP Resets and Timeouts"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tcp_resets_timeouts/timeseries_groups",
    "operationId": "radar-get-tcp-resets-timeouts-timeseries-group",
    "tags": [
      "Radar TCP Resets and Timeouts"
    ],
    "pathParams": [],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tlds",
    "operationId": "radar-get-tlds",
    "tags": [
      "Radar Top-Level Domains"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "tldManager",
      "tldType",
      "tld",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tlds/{tld}",
    "operationId": "radar-get-tld-details",
    "tags": [
      "Radar Top-Level Domains"
    ],
    "pathParams": [
      "tld"
    ],
    "queryParams": [
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tlds/performance/summary/{dimension}",
    "operationId": "radar-get-tlds-performance-summary",
    "tags": [
      "Radar Top-Level Domains"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "tld",
      "nameserver",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/tlds/performance/timeseries_groups/{dimension}",
    "operationId": "radar-get-tlds-performance-timeseries-groups",
    "tags": [
      "Radar Top-Level Domains"
    ],
    "pathParams": [
      "dimension"
    ],
    "queryParams": [
      "aggInterval",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "location",
      "continent",
      "tld",
      "nameserver",
      "limitPerGroup",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/traffic_anomalies",
    "operationId": "radar-get-traffic-anomalies",
    "tags": [
      "Radar Traffic Anomalies"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "offset",
      "dateRange",
      "dateStart",
      "dateEnd",
      "status",
      "type",
      "asn",
      "location",
      "origin",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/traffic_anomalies/locations",
    "operationId": "radar-get-traffic-anomalies-top",
    "tags": [
      "Radar Traffic Anomalies"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "dateRange",
      "dateStart",
      "dateEnd",
      "status",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/verified_bots/top/bots",
    "operationId": "radar-get-verified-bots-top-by-http-requests",
    "tags": [
      "Radar Verified Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/radar/verified_bots/top/categories",
    "operationId": "radar-get-verified-bots-top-categories-by-http-requests",
    "tags": [
      "Radar Verified Bots"
    ],
    "pathParams": [],
    "queryParams": [
      "limit",
      "name",
      "dateRange",
      "dateStart",
      "dateEnd",
      "asn",
      "location",
      "continent",
      "format"
    ]
  },
  {
    "method": "GET",
    "path": "/ready",
    "tags": [
      "brand_protection"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/signed-url",
    "tags": [
      "logo_match"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/system/accounts/{account_tag}/stores",
    "operationId": "secrets-store-system-list",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/system/accounts/{account_tag}/stores/{store_id}",
    "operationId": "secrets-store-system-get-store-by-id",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "store_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/system/accounts/{account_tag}/stores/{store_id}/secrets",
    "operationId": "secrets-store-system-secrets-list",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "store_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/system/accounts/{account_tag}/stores/{store_id}/secrets/{secret_id}",
    "operationId": "secrets-store-system-get-by-id",
    "tags": [
      "Secrets Store"
    ],
    "pathParams": [
      "store_id",
      "secret_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_id}",
    "operationId": "Tenants_retrieveTenant",
    "tags": [
      "Tenants"
    ],
    "pathParams": [
      "tenant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_id}/account_types",
    "operationId": "Tenants_validAccountTypes",
    "tags": [
      "Tenants"
    ],
    "pathParams": [
      "tenant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_id}/accounts",
    "operationId": "Tenants_listAccounts",
    "tags": [
      "Tenants"
    ],
    "pathParams": [
      "tenant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_id}/entitlements",
    "operationId": "Tenants_listEntitlements",
    "tags": [
      "Tenants"
    ],
    "pathParams": [
      "tenant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_id}/memberships",
    "operationId": "Tenants_listMemberships",
    "tags": [
      "Tenants"
    ],
    "pathParams": [
      "tenant_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/tenants/{tenant_tag}/custom_ns",
    "operationId": "tenant-level-custom-nameservers-list-tenant-custom-nameservers",
    "tags": [
      "Tenant-Level Custom Nameservers"
    ],
    "pathParams": [
      "tenant_tag"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user",
    "operationId": "user-user-details",
    "tags": [
      "User"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/analytics/dashboard",
    "operationId": "user-analytics-get-dashboard",
    "tags": [
      "User Analytics (Deprecated)"
    ],
    "pathParams": [],
    "queryParams": [
      "since",
      "until",
      "continuous"
    ]
  },
  {
    "method": "GET",
    "path": "/user/audit_logs",
    "operationId": "audit-logs-get-user-audit-logs",
    "tags": [
      "Audit Logs"
    ],
    "pathParams": [],
    "queryParams": [
      "id",
      "export",
      "action.type",
      "actor.ip",
      "actor.email",
      "since",
      "before",
      "zone.name",
      "direction",
      "per_page",
      "page",
      "hide_user_logs"
    ]
  },
  {
    "method": "GET",
    "path": "/user/billing/history",
    "operationId": "user-billing-history-(-deprecated)-billing-history-details",
    "tags": [
      "User Billing History"
    ],
    "pathParams": [],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "occurred_at",
      "type",
      "action"
    ]
  },
  {
    "method": "GET",
    "path": "/user/billing/profile",
    "operationId": "user-billing-profile-(-deprecated)-billing-profile-details",
    "tags": [
      "User Billing Profile"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/firewall/access_rules/rules",
    "operationId": "ip-access-rules-for-a-user-list-ip-access-rules",
    "tags": [
      "IP Access rules for a user"
    ],
    "pathParams": [],
    "queryParams": [
      "mode",
      "configuration.target",
      "configuration.value",
      "notes",
      "match",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/user/firewall/access_rules/rules/{rule_id}",
    "operationId": "ip-access-rules-for-a-user-get-an-ip-access-rule",
    "tags": [
      "IP Access rules for a user"
    ],
    "pathParams": [
      "rule_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/invites",
    "operationId": "user'-s-invites-list-invitations",
    "tags": [
      "User's Invites"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/invites/{invite_id}",
    "operationId": "user'-s-invites-invitation-details",
    "tags": [
      "User's Invites"
    ],
    "pathParams": [
      "invite_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/monitors",
    "operationId": "load-balancer-monitors-list-monitors",
    "tags": [
      "Load Balancer Monitors"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/monitors/{monitor_id}",
    "operationId": "load-balancer-monitors-monitor-details",
    "tags": [
      "Load Balancer Monitors"
    ],
    "pathParams": [
      "monitor_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/monitors/{monitor_id}/references",
    "operationId": "load-balancer-monitors-list-monitor-references",
    "tags": [
      "Load Balancer Monitors"
    ],
    "pathParams": [
      "monitor_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/pools",
    "operationId": "load-balancer-pools-list-pools",
    "tags": [
      "Load Balancer Pools"
    ],
    "pathParams": [],
    "queryParams": [
      "monitor"
    ]
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/pools/{pool_id}",
    "operationId": "load-balancer-pools-pool-details",
    "tags": [
      "Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/pools/{pool_id}/health",
    "operationId": "load-balancer-pools-pool-health-details",
    "tags": [
      "Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/pools/{pool_id}/references",
    "operationId": "load-balancer-pools-list-pool-references",
    "tags": [
      "Load Balancer Pools"
    ],
    "pathParams": [
      "pool_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancers/preview/{preview_id}",
    "operationId": "load-balancer-monitors-preview-result",
    "tags": [
      "Load Balancer Monitors"
    ],
    "pathParams": [
      "preview_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/load_balancing_analytics/events",
    "operationId": "load-balancer-healthcheck-events-list-healthcheck-events",
    "tags": [
      "Load Balancer Healthcheck Events"
    ],
    "pathParams": [],
    "queryParams": [
      "until",
      "pool_name",
      "origin_healthy",
      "pool_id",
      "since",
      "origin_name",
      "pool_healthy"
    ]
  },
  {
    "method": "GET",
    "path": "/user/organizations",
    "operationId": "user'-s-organizations-list-organizations",
    "tags": [
      "User's Organizations"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "page",
      "per_page",
      "order",
      "direction",
      "match",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/user/organizations/{organization_id}",
    "operationId": "user'-s-organizations-organization-details",
    "tags": [
      "User's Organizations"
    ],
    "pathParams": [
      "organization_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/subscriptions",
    "operationId": "user-subscription-get-user-subscriptions",
    "tags": [
      "User Subscription"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/tenants",
    "operationId": "User_listUserTenants",
    "tags": [
      "User"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/tokens",
    "operationId": "user-api-tokens-list-tokens",
    "tags": [
      "User API Tokens"
    ],
    "pathParams": [],
    "queryParams": [
      "page",
      "per_page",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/user/tokens/{token_id}",
    "operationId": "user-api-tokens-token-details",
    "tags": [
      "User API Tokens"
    ],
    "pathParams": [
      "token_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/user/tokens/permission_groups",
    "operationId": "permission-groups-list-permission-groups",
    "tags": [
      "User API Tokens"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "scope"
    ]
  },
  {
    "method": "GET",
    "path": "/user/tokens/verify",
    "operationId": "user-api-tokens-verify-token",
    "tags": [
      "User API Tokens"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones",
    "operationId": "zones-get",
    "tags": [
      "Zone"
    ],
    "pathParams": [],
    "queryParams": [
      "name",
      "status",
      "type",
      "account.id",
      "account.name",
      "page",
      "per_page",
      "order",
      "direction",
      "match"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}",
    "operationId": "zones-0-get",
    "tags": [
      "Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps",
    "operationId": "zone-level-access-applications-list-access-applications",
    "tags": [
      "Zone-Level Access applications"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/{app_id}",
    "operationId": "zone-level-access-applications-get-an-access-application",
    "tags": [
      "Zone-Level Access applications"
    ],
    "pathParams": [
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/{app_id}/ca",
    "operationId": "zone-level-access-short-lived-certificate-c-as-get-a-short-lived-certificate-ca",
    "tags": [
      "Zone-Level Access short-lived certificate CAs"
    ],
    "pathParams": [
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/{app_id}/policies",
    "operationId": "zone-level-access-policies-list-access-policies",
    "tags": [
      "Zone-Level Access policies"
    ],
    "pathParams": [
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/{app_id}/policies/{policy_id}",
    "operationId": "zone-level-access-policies-get-an-access-policy",
    "tags": [
      "Zone-Level Access policies"
    ],
    "pathParams": [
      "policy_id",
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/{app_id}/user_policy_checks",
    "operationId": "zone-level-access-applications-test-access-policies",
    "tags": [
      "Zone-Level Access applications"
    ],
    "pathParams": [
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/apps/ca",
    "operationId": "zone-level-access-short-lived-certificate-c-as-list-short-lived-certificate-c-as",
    "tags": [
      "Zone-Level Access short-lived certificate CAs"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/certificates",
    "operationId": "zone-level-access-mtls-authentication-list-mtls-certificates",
    "tags": [
      "Zone-Level Access mTLS authentication"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/certificates/{certificate_id}",
    "operationId": "zone-level-access-mtls-authentication-get-an-mtls-certificate",
    "tags": [
      "Zone-Level Access mTLS authentication"
    ],
    "pathParams": [
      "certificate_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/certificates/settings",
    "operationId": "zone-level-access-mtls-authentication-list-mtls-certificates-hostname-settings",
    "tags": [
      "Zone-Level Access mTLS authentication"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/groups",
    "operationId": "zone-level-access-groups-list-access-groups",
    "tags": [
      "Zone-Level Access groups"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/groups/{group_id}",
    "operationId": "zone-level-access-groups-get-an-access-group",
    "tags": [
      "Zone-Level Access groups"
    ],
    "pathParams": [
      "group_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/identity_providers",
    "operationId": "zone-level-access-identity-providers-list-access-identity-providers",
    "tags": [
      "Zone-Level Access identity providers"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/identity_providers/{identity_provider_id}",
    "operationId": "zone-level-access-identity-providers-get-an-access-identity-provider",
    "tags": [
      "Zone-Level Access identity providers"
    ],
    "pathParams": [
      "identity_provider_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/organizations",
    "operationId": "zone-level-zero-trust-organization-get-your-zero-trust-organization",
    "tags": [
      "Zone-Level Zero Trust organization"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/service_tokens",
    "operationId": "zone-level-access-service-tokens-list-service-tokens",
    "tags": [
      "Zone-Level Access service tokens"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/access/service_tokens/{service_token_id}",
    "operationId": "zone-level-access-service-tokens-get-a-service-token",
    "tags": [
      "Zone-Level Access service tokens"
    ],
    "pathParams": [
      "service_token_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/acm/custom_trust_store",
    "operationId": "custom-origin-trust-store-list-details",
    "tags": [
      "Custom Origin Trust Store"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/acm/custom_trust_store/{custom_origin_trust_store_id}",
    "operationId": "custom-origin-trust-store-details",
    "tags": [
      "Custom Origin Trust Store"
    ],
    "pathParams": [
      "custom_origin_trust_store_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/acm/total_tls",
    "operationId": "total-tls-total-tls-settings-details",
    "tags": [
      "Total TLS"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/addressing/regional_hostnames",
    "operationId": "dls-zone-regional-hostnames-list",
    "tags": [
      "DLS Regional Services"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/addressing/regional_hostnames/{hostname}",
    "operationId": "dls-zone-regional-hostnames-fetch",
    "tags": [
      "DLS Regional Services"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ai-security/custom-topics",
    "operationId": "ai-security-custom-topics-get",
    "tags": [
      "AI Security for Apps"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ai-security/settings",
    "operationId": "ai-security-settings-get",
    "tags": [
      "AI Security for Apps"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/analytics/latency",
    "operationId": "argo-analytics-for-zone-argo-analytics-for-a-zone",
    "tags": [
      "Argo Analytics for Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "bins"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/analytics/latency/colos",
    "operationId": "argo-analytics-for-geolocation-argo-analytics-for-a-zone-at-different-po-ps",
    "tags": [
      "Argo Analytics for Geolocation"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/configuration",
    "operationId": "api-shield-settings-retrieve-information-about-specific-configuration-properties",
    "tags": [
      "API Shield Settings"
    ],
    "pathParams": [],
    "queryParams": [
      "normalize"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/discovery",
    "operationId": "api-shield-api-discovery-retrieve-discovered-operations-on-a-zone-as-openapi",
    "tags": [
      "API Shield API Discovery"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/discovery/operations",
    "operationId": "api-shield-api-discovery-retrieve-discovered-operations-on-a-zone",
    "tags": [
      "API Shield API Discovery"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/discovery/operations/{discovery_id}",
    "operationId": "api-shield-api-discovery-retrieve-discovered-operation-by-id",
    "tags": [
      "API Shield API Discovery"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/labels",
    "operationId": "api-shield-labels-get-labels",
    "tags": [
      "API Shield Labels"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/labels/managed/{name}",
    "operationId": "api-shield-labels-get-managed-label",
    "tags": [
      "API Shield Labels"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/labels/user/{name}",
    "operationId": "api-shield-labels-get-user-label",
    "tags": [
      "API Shield Labels"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/operations",
    "operationId": "api-shield-endpoint-management-retrieve-information-about-all-operations-on-a-zone",
    "tags": [
      "API Shield Endpoint Management"
    ],
    "pathParams": [],
    "queryParams": [
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/operations/{operation_id}",
    "operationId": "api-shield-endpoint-management-retrieve-information-about-an-operation",
    "tags": [
      "API Shield Endpoint Management"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/operations/{operation_id}/schema_validation",
    "operationId": "api-shield-schema-validation-retrieve-operation-level-settings",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/schemas",
    "operationId": "api-shield-endpoint-management-retrieve-operations-and-features-as-open-api-schemas",
    "tags": [
      "API Shield Endpoint Management"
    ],
    "pathParams": [],
    "queryParams": [
      "host"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/settings/schema_validation",
    "operationId": "api-shield-schema-validation-retrieve-zone-level-settings",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/user_schemas",
    "operationId": "api-shield-schema-validation-retrieve-information-about-all-schemas",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": [
      "validation_enabled"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/user_schemas/{schema_id}",
    "operationId": "api-shield-schema-validation-retrieve-information-about-specific-schema",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/user_schemas/{schema_id}/operations",
    "operationId": "api-shield-schema-validation-extract-operations-from-schema",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": [
      "operation_status"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/api_gateway/user_schemas/hosts",
    "operationId": "api-shield-schema-validation-retrieve-user-schema-hosts",
    "tags": [
      "API Shield Schema Validation 2.0"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/argo/smart_routing",
    "operationId": "argo-smart-routing-get-argo-smart-routing-setting",
    "tags": [
      "Argo Smart Routing"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/argo/tiered_caching",
    "operationId": "tiered-caching-get-tiered-caching-setting",
    "tags": [
      "Tiered Caching"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/available_plans",
    "operationId": "zone-rate-plan-list-available-plans",
    "tags": [
      "Zone Rate Plan"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/available_plans/{plan_identifier}",
    "operationId": "zone-rate-plan-available-plan-details",
    "tags": [
      "Zone Rate Plan"
    ],
    "pathParams": [
      "plan_identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/available_rate_plans",
    "operationId": "zone-rate-plan-list-available-rate-plans",
    "tags": [
      "Zone Rate Plan"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/bot_management",
    "operationId": "bot-management-for-a-zone-get-config",
    "tags": [
      "Bot Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/bot_management/feedback",
    "operationId": "bot-management-zone-feedback-list",
    "tags": [
      "Feedback"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/cache_reserve",
    "operationId": "zone-cache-settings-get-cache-reserve-setting",
    "tags": [
      "Zone Cache Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/cache_reserve_clear",
    "operationId": "zone-cache-settings-get-cache-reserve-clear",
    "tags": [
      "Zone Cache Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/origin_cloud_regions",
    "operationId": "origin-cloud-regions-list",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/origin_cloud_regions/{origin_ip}",
    "operationId": "origin-cloud-regions-get",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id",
      "origin_ip"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/origin_cloud_regions/supported_regions",
    "operationId": "origin-cloud-regions-supported-regions",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/origin_post_quantum_encryption",
    "operationId": "zone-cache-settings-get-origin-post-quantum-encryption-setting",
    "tags": [
      "Origin Post-Quantum"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/regional_tiered_cache",
    "operationId": "zone-cache-settings-get-regional-tiered-cache-setting",
    "tags": [
      "Zone Cache Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/tiered_cache_smart_topology_enable",
    "operationId": "smart-tiered-cache-get-smart-tiered-cache-setting",
    "tags": [
      "Smart Tiered Cache"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cache/variants",
    "operationId": "zone-cache-settings-get-variants-setting",
    "tags": [
      "Zone Cache Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/certificate_authorities/hostname_associations",
    "operationId": "client-certificate-for-a-zone-list-hostname-associations",
    "tags": [
      "API Shield Client Certificates for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "mtls_certificate_id"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/client_certificates",
    "operationId": "client-certificate-for-a-zone-list-client-certificates",
    "tags": [
      "API Shield Client Certificates for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "status",
      "page",
      "per_page",
      "limit",
      "offset"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/client_certificates/{client_certificate_id}",
    "operationId": "client-certificate-for-a-zone-client-certificate-details",
    "tags": [
      "API Shield Client Certificates for a Zone"
    ],
    "pathParams": [
      "zone_id",
      "client_certificate_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/cloud_connector/rules",
    "operationId": "zone-cloud-connector-rules",
    "tags": [
      "Zone Cloud Connector Rules GET"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/content-upload-scan/payloads",
    "operationId": "waf-content-scanning-list-custom-scan-expressions",
    "tags": [
      "Content Scanning"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/content-upload-scan/settings",
    "operationId": "waf-content-scanning-get-status",
    "tags": [
      "Content Scanning"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ct/alerting",
    "operationId": "ct-alerting-get-subscription",
    "tags": [
      "CT Alerting"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_certificates",
    "operationId": "custom-ssl-for-a-zone-list-ssl-configurations",
    "tags": [
      "Custom SSL for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "match",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_certificates/{custom_certificate_id}",
    "operationId": "custom-ssl-for-a-zone-ssl-configuration-details",
    "tags": [
      "Custom SSL for a Zone"
    ],
    "pathParams": [
      "custom_certificate_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_csrs",
    "operationId": "custom-csrs-for-a-zone-list-custom-csrs",
    "tags": [
      "Custom CSRs for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_csrs/{custom_csr_id}",
    "operationId": "custom-csrs-for-a-zone-custom-csr-details",
    "tags": [
      "Custom CSRs for a Zone"
    ],
    "pathParams": [
      "custom_csr_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_hostnames",
    "operationId": "custom-hostname-for-a-zone-list-custom-hostnames",
    "tags": [
      "Custom Hostname for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "hostname",
      "hostname.exact",
      "hostname.startsWith",
      "hostname.contain",
      "id",
      "page",
      "per_page",
      "order",
      "direction",
      "ssl_status",
      "hostname_status",
      "certificate_authority",
      "wildcard",
      "custom_origin_server",
      "ssl"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_hostnames/{custom_hostname_id}",
    "operationId": "custom-hostname-for-a-zone-custom-hostname-details",
    "tags": [
      "Custom Hostname for a Zone"
    ],
    "pathParams": [
      "custom_hostname_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_hostnames/fallback_origin",
    "operationId": "custom-hostname-fallback-origin-for-a-zone-get-fallback-origin-for-custom-hostnames",
    "tags": [
      "Custom Hostname Fallback Origin for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_hostnames/quota",
    "operationId": "custom-hostname-for-a-zone-get-custom-hostname-quota",
    "tags": [
      "Custom Hostname for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/custom_ns",
    "operationId": "account-level-custom-nameservers-usage-for-a-zone-get-account-custom-nameserver-related-zone-metadata",
    "tags": [
      "Account-Level Custom Nameservers Usage for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dcv_delegation/uuid",
    "operationId": "dcv-delegation-uuid-get",
    "tags": [
      "DCV Delegation"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/devices/policy/certificates",
    "operationId": "devices-get-policy-certificates",
    "tags": [
      "Devices"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_analytics/report",
    "operationId": "dns-analytics-table",
    "tags": [
      "DNS Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "metrics",
      "dimensions",
      "since",
      "until",
      "limit",
      "sort",
      "filters"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_analytics/report/bytime",
    "operationId": "dns-analytics-by-time",
    "tags": [
      "DNS Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "metrics",
      "dimensions",
      "since",
      "until",
      "limit",
      "sort",
      "filters",
      "time_delta"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_records",
    "operationId": "dns-records-for-a-zone-list-dns-records",
    "tags": [
      "DNS Records for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "name",
      "name.exact",
      "name.contains",
      "name.startswith",
      "name.endswith",
      "type",
      "content",
      "content.exact",
      "content.contains",
      "content.startswith",
      "content.endswith",
      "proxied",
      "match",
      "comment",
      "comment.present",
      "comment.absent",
      "comment.exact",
      "comment.contains",
      "comment.startswith",
      "comment.endswith",
      "tag",
      "tag.present",
      "tag.absent",
      "tag.exact",
      "tag.contains",
      "tag.startswith",
      "tag.endswith",
      "search",
      "tag_match",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_records/{dns_record_id}",
    "operationId": "dns-records-for-a-zone-dns-record-details",
    "tags": [
      "DNS Records for a Zone"
    ],
    "pathParams": [
      "dns_record_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_records/export",
    "operationId": "dns-records-for-a-zone-export-dns-records",
    "tags": [
      "DNS Records for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_records/scan/review",
    "operationId": "dns-records-for-a-zone-review-dns-scan",
    "tags": [
      "DNS Records for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_records/usage",
    "operationId": "dns-records-for-a-zone-get-usage",
    "tags": [
      "DNS Records for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dns_settings",
    "operationId": "dns-settings-for-a-zone-list-dns-settings",
    "tags": [
      "DNS Settings for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dnssec",
    "operationId": "dnssec-dnssec-details",
    "tags": [
      "DNSSEC"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/dnssec/zsk",
    "operationId": "dnssec-list-dnssec-zsks",
    "tags": [
      "DNSSEC"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/auth/dmarc-reports",
    "operationId": "get_dmarc_reports_status",
    "tags": [
      "Email Auth"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/auth/spf/inspect",
    "operationId": "inspect_spf",
    "tags": [
      "Email Auth"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing",
    "operationId": "email-routing-settings-get-email-routing-settings",
    "tags": [
      "Email Routing settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/dns",
    "operationId": "email-routing-settings-email-routing-dns-settings",
    "tags": [
      "Email Routing settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "subdomain"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/rules",
    "operationId": "email-routing-routing-rules-list-routing-rules",
    "tags": [
      "Email Routing routing rules"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "enabled"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/rules/{rule_identifier}",
    "operationId": "email-routing-routing-rules-get-routing-rule",
    "tags": [
      "Email Routing routing rules"
    ],
    "pathParams": [
      "rule_identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/rules/catch_all",
    "operationId": "email-routing-routing-rules-get-catch-all-rule",
    "tags": [
      "Email Routing routing rules"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/suppression",
    "operationId": "get_publicListSuppressionZoneRouting",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/routing/suppression/{suppression_id}",
    "operationId": "get_publicGetSuppressionZoneRouting",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "zone_id",
      "suppression_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/subdomains",
    "operationId": "email-sending-subdomains-list-sending-subdomains",
    "tags": [
      "Email Sending subdomains"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/subdomains/{subdomain_id}",
    "operationId": "email-sending-subdomains-get-sending-subdomain",
    "tags": [
      "Email Sending subdomains"
    ],
    "pathParams": [
      "subdomain_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/subdomains/{subdomain_id}/dns",
    "operationId": "email-sending-subdomains-get-sending-subdomain-dns",
    "tags": [
      "Email Sending subdomains"
    ],
    "pathParams": [
      "subdomain_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/subdomains/{subdomain_id}/dns/status",
    "operationId": "email-sending-subdomains-get-sending-subdomain-dns-status",
    "tags": [
      "Email Sending subdomains"
    ],
    "pathParams": [
      "subdomain_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/suppression",
    "operationId": "get_publicListSuppressionZoneSending",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/email/sending/suppression/{suppression_id}",
    "operationId": "get_publicGetSuppressionZoneSending",
    "tags": [
      "Public"
    ],
    "pathParams": [
      "zone_id",
      "suppression_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/environments",
    "operationId": "zonesEnvironmentsList",
    "tags": [
      "Zone Environments"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/filters",
    "operationId": "filters-list-filters",
    "tags": [
      "Filters"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "paused",
      "expression",
      "description",
      "ref",
      "page",
      "per_page",
      "id"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/filters/{filter_id}",
    "operationId": "filters-get-a-filter",
    "tags": [
      "Filters"
    ],
    "pathParams": [
      "filter_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/access_rules/rules",
    "operationId": "ip-access-rules-for-a-zone-list-ip-access-rules",
    "tags": [
      "IP Access rules for a zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "mode",
      "configuration.target",
      "configuration.value",
      "notes",
      "match",
      "page",
      "per_page",
      "order",
      "direction"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/lockdowns",
    "operationId": "zone-lockdown-list-zone-lockdown-rules",
    "tags": [
      "Zone Lockdown"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "description",
      "modified_on",
      "ip",
      "priority",
      "uri_search",
      "ip_range_search",
      "per_page",
      "created_on",
      "description_search",
      "ip_search"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/lockdowns/{lock_downs_id}",
    "operationId": "zone-lockdown-get-a-zone-lockdown-rule",
    "tags": [
      "Zone Lockdown"
    ],
    "pathParams": [
      "lock_downs_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/rules",
    "operationId": "firewall-rules-list-firewall-rules",
    "tags": [
      "Firewall rules"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "description",
      "action",
      "page",
      "per_page",
      "id",
      "paused"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/rules/{rule_id}",
    "operationId": "firewall-rules-get-a-firewall-rule",
    "tags": [
      "Firewall rules"
    ],
    "pathParams": [
      "rule_id",
      "zone_id"
    ],
    "queryParams": [
      "id"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/ua_rules",
    "operationId": "user-agent-blocking-rules-list-user-agent-blocking-rules",
    "tags": [
      "User Agent Blocking rules"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "description",
      "per_page",
      "user_agent",
      "paused"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/ua_rules/{ua_rule_id}",
    "operationId": "user-agent-blocking-rules-get-a-user-agent-blocking-rule",
    "tags": [
      "User Agent Blocking rules"
    ],
    "pathParams": [
      "ua_rule_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/overrides",
    "operationId": "waf-overrides-list-waf-overrides",
    "tags": [
      "WAF overrides"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/overrides/{overrides_id}",
    "operationId": "waf-overrides-get-a-waf-override",
    "tags": [
      "WAF overrides"
    ],
    "pathParams": [
      "overrides_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages",
    "operationId": "waf-packages-list-waf-packages",
    "tags": [
      "WAF packages"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "order",
      "direction",
      "match",
      "name"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}",
    "operationId": "waf-packages-get-a-waf-package",
    "tags": [
      "WAF packages"
    ],
    "pathParams": [
      "package_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/groups",
    "operationId": "waf-rule-groups-list-waf-rule-groups",
    "tags": [
      "WAF rule groups"
    ],
    "pathParams": [
      "package_id",
      "zone_id"
    ],
    "queryParams": [
      "mode",
      "page",
      "per_page",
      "order",
      "direction",
      "match",
      "name",
      "rules_count"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/groups/{group_id}",
    "operationId": "waf-rule-groups-get-a-waf-rule-group",
    "tags": [
      "WAF rule groups"
    ],
    "pathParams": [
      "group_id",
      "package_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/rules",
    "operationId": "waf-rules-list-waf-rules",
    "tags": [
      "WAF rules"
    ],
    "pathParams": [
      "package_id",
      "zone_id"
    ],
    "queryParams": [
      "mode",
      "group_id",
      "page",
      "per_page",
      "order",
      "direction",
      "match",
      "description",
      "priority"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/rules/{rule_id}",
    "operationId": "waf-rules-get-a-waf-rule",
    "tags": [
      "WAF rules"
    ],
    "pathParams": [
      "rule_id",
      "package_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/fraud_detection/settings",
    "operationId": "fraud-detection-zone-get-settings",
    "tags": [
      "Fraud Detection"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/healthchecks",
    "operationId": "health-checks-list-health-checks",
    "tags": [
      "Health Checks"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/healthchecks/{healthcheck_id}",
    "operationId": "health-checks-health-check-details",
    "tags": [
      "Health Checks"
    ],
    "pathParams": [
      "healthcheck_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/healthchecks/preview/{healthcheck_id}",
    "operationId": "health-checks-health-check-preview-details",
    "tags": [
      "Health Checks"
    ],
    "pathParams": [
      "healthcheck_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/hold",
    "operationId": "zones-0-hold-get",
    "tags": [
      "Zone Holds"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/hostnames/settings/{setting_id}",
    "operationId": "per-hostname-tls-settings-list",
    "tags": [
      "Per-Hostname TLS Settings"
    ],
    "pathParams": [
      "zone_id",
      "setting_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/hostnames/settings/{setting_id}/{hostname}",
    "operationId": "per-hostname-tls-settings-get",
    "tags": [
      "Per-Hostname TLS Settings"
    ],
    "pathParams": [
      "zone_id",
      "setting_id",
      "hostname"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/intel/sinkholes/{sinkhole_id}/ingresses/{ingress_id}",
    "operationId": "sinkhole-config-get-ingress",
    "tags": [
      "Sinkhole Config"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/keyless_certificates",
    "operationId": "keyless-ssl-for-a-zone-list-keyless-ssl-configurations",
    "tags": [
      "Keyless SSL for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/keyless_certificates/{keyless_certificate_id}",
    "operationId": "keyless-ssl-for-a-zone-get-keyless-ssl-configuration",
    "tags": [
      "Keyless SSL for a Zone"
    ],
    "pathParams": [
      "keyless_certificate_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/leaked-credential-checks",
    "operationId": "waf-product-api-leaked-credentials-get-status",
    "tags": [
      "Leaked Credential Checks"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/leaked-credential-checks/detections",
    "operationId": "waf-product-api-leaked-credentials-list-detections",
    "tags": [
      "Leaked Credential Checks"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/leaked-credential-checks/detections/{detection_id}",
    "operationId": "waf-product-api-leaked-credentials-get-detection",
    "tags": [
      "Leaked Credential Checks"
    ],
    "pathParams": [
      "zone_id",
      "detection_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/load_balancers",
    "operationId": "load-balancers-list-load-balancers",
    "tags": [
      "Load Balancers"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/load_balancers/{load_balancer_id}",
    "operationId": "load-balancers-load-balancer-details",
    "tags": [
      "Load Balancers"
    ],
    "pathParams": [
      "zone_id",
      "load_balancer_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logpush/datasets/{dataset_id}/fields",
    "operationId": "get-zones-zone_id-logpush-datasets-dataset_id-fields",
    "tags": [
      "Logpush jobs for a zone"
    ],
    "pathParams": [
      "dataset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logpush/datasets/{dataset_id}/jobs",
    "operationId": "get-zones-zone_id-logpush-datasets-dataset_id-jobs",
    "tags": [
      "Logpush jobs for a zone"
    ],
    "pathParams": [
      "dataset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logpush/edge/jobs",
    "operationId": "get-zones-zone_id-logpush-edge-jobs",
    "tags": [
      "Instant Logs jobs for a zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logpush/jobs",
    "operationId": "get-zones-zone_id-logpush-jobs",
    "tags": [
      "Logpush jobs for a zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logpush/jobs/{job_id}",
    "operationId": "get-zones-zone_id-logpush-jobs-job_id",
    "tags": [
      "Logpush jobs for a zone"
    ],
    "pathParams": [
      "job_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/control/retention/flag",
    "operationId": "get-zones-zone_id-logs-control-retention-flag",
    "tags": [
      "Logs Received"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/explorer/datasets",
    "operationId": "zones-logs-explorer-datasets-list",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/explorer/datasets/{dataset_id}",
    "operationId": "zones-logs-explorer-datasets-get",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/explorer/datasets/available",
    "operationId": "zones-logs-explorer-datasets-available-list",
    "tags": [
      "Log Explorer Datasets"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/explorer/query/sql",
    "operationId": "zones-logs-explorer-query-get",
    "tags": [
      "Log Explorer Queries"
    ],
    "pathParams": [],
    "queryParams": [
      "query"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/rayids/{ray_id}",
    "operationId": "get-zones-zone_id-logs-rayids-ray_id",
    "tags": [
      "Logs Received"
    ],
    "pathParams": [
      "zone_id",
      "ray_id"
    ],
    "queryParams": [
      "fields",
      "timestamps"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/received",
    "operationId": "get-zones-zone_id-logs-received",
    "tags": [
      "Logs Received"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "start",
      "end",
      "fields",
      "sample",
      "count",
      "timestamps"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/logs/received/fields",
    "operationId": "get-zones-zone_id-logs-received-fields",
    "tags": [
      "Logs Received"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/managed_headers",
    "operationId": "listManagedTransforms",
    "tags": [
      "Managed Transforms"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth",
    "operationId": "zone-level-authenticated-origin-pulls-list-certificates",
    "tags": [
      "Zone-Level Authenticated Origin Pulls"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/{certificate_id}",
    "operationId": "zone-level-authenticated-origin-pulls-get-certificate-details",
    "tags": [
      "Zone-Level Authenticated Origin Pulls"
    ],
    "pathParams": [
      "certificate_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames",
    "operationId": "per-hostname-authenticated-origin-pull-list-hostname-associations",
    "tags": [
      "Per-hostname Authenticated Origin Pull"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames/{hostname}",
    "operationId": "per-hostname-authenticated-origin-pull-get-the-hostname-status-for-client-authentication",
    "tags": [
      "Per-hostname Authenticated Origin Pull"
    ],
    "pathParams": [
      "hostname",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames/certificates",
    "operationId": "per-hostname-authenticated-origin-pull-list-certificates",
    "tags": [
      "Per-hostname Authenticated Origin Pull"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames/certificates/{certificate_id}",
    "operationId": "per-hostname-authenticated-origin-pull-get-the-hostname-client-certificate",
    "tags": [
      "Per-hostname Authenticated Origin Pull"
    ],
    "pathParams": [
      "certificate_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin_tls_client_auth/settings",
    "operationId": "zone-level-authenticated-origin-pulls-get-enablement-setting-for-zone",
    "tags": [
      "Zone-Level Authenticated Origin Pulls"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin/cloud_regions",
    "operationId": "origin-cloud-regions-v2-list",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin/cloud_regions/{origin_ip}",
    "operationId": "origin-cloud-regions-v2-get",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id",
      "origin_ip"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/origin/cloud_regions/supported_regions",
    "operationId": "origin-cloud-regions-v2-supported-regions",
    "tags": [
      "Origin Cloud Regions"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield",
    "operationId": "page-shield-get-settings",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/connections",
    "operationId": "page-shield-list-connections",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "exclude_urls",
      "urls",
      "hosts",
      "page",
      "per_page",
      "order_by",
      "direction",
      "prioritize_malicious",
      "exclude_cdn_cgi",
      "status",
      "page_url",
      "export"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/connections/{connection_id}",
    "operationId": "page-shield-get-connection",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id",
      "connection_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/cookies",
    "operationId": "page-shield-list-cookies",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "hosts",
      "page",
      "per_page",
      "order_by",
      "direction",
      "page_url",
      "export",
      "name",
      "secure",
      "http_only",
      "same_site",
      "type",
      "path",
      "domain"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/cookies/{cookie_id}",
    "operationId": "page-shield-get-cookie",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id",
      "cookie_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/policies",
    "operationId": "page-shield-list-policies",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/policies/{policy_id}",
    "operationId": "page-shield-get-policy",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id",
      "policy_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/scripts",
    "operationId": "page-shield-list-scripts",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "exclude_urls",
      "urls",
      "hosts",
      "page",
      "per_page",
      "order_by",
      "direction",
      "prioritize_malicious",
      "exclude_cdn_cgi",
      "exclude_duplicates",
      "status",
      "page_url",
      "export"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/page_shield/scripts/{script_id}",
    "operationId": "page-shield-get-script",
    "tags": [
      "Page Shield"
    ],
    "pathParams": [
      "zone_id",
      "script_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/pagerules",
    "operationId": "page-rules-list-page-rules",
    "tags": [
      "Page Rules"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "order",
      "direction",
      "match",
      "status"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/pagerules/{pagerule_id}",
    "operationId": "page-rules-get-a-page-rule",
    "tags": [
      "Page Rules"
    ],
    "pathParams": [
      "pagerule_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/pagerules/settings",
    "operationId": "available-page-rules-settings-list-available-page-rules-settings",
    "tags": [
      "Available Page Rules settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/pay-per-crawl/configuration",
    "operationId": "pay-per-crawl.getConfig",
    "tags": [
      "ppc_config"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rate_limits",
    "operationId": "rate-limits-for-a-zone-list-rate-limits",
    "tags": [
      "Rate limits for a zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rate_limits/{rate_limit_id}",
    "operationId": "rate-limits-for-a-zone-get-a-rate-limit",
    "tags": [
      "Rate limits for a zone"
    ],
    "pathParams": [
      "rate_limit_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets",
    "operationId": "listZoneRulesets",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "cursor",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/{ruleset_id}",
    "operationId": "getZoneRuleset",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/{ruleset_id}/versions",
    "operationId": "listZoneRulesetVersions",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/{ruleset_id}/versions/{ruleset_version}",
    "operationId": "getZoneRulesetVersion",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_version",
      "ruleset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/{ruleset_id}/versions/{ruleset_version}/by_tag/{rule_tag}",
    "operationId": "listZoneRulesetVersionRulesByTag",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "rule_tag",
      "ruleset_version",
      "ruleset_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint",
    "operationId": "getZoneEntrypointRuleset",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_phase",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint/versions",
    "operationId": "listZoneEntrypointRulesetVersions",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_phase",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint/versions/{ruleset_version}",
    "operationId": "getZoneEntrypointRulesetVersion",
    "tags": [
      "Zone Rulesets"
    ],
    "pathParams": [
      "ruleset_version",
      "ruleset_phase",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/schemas",
    "operationId": "schema-validation-list-schemas-paginated",
    "tags": [
      "Schema Validation"
    ],
    "pathParams": [],
    "queryParams": [
      "validation_enabled"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/schemas/{schema_id}",
    "operationId": "schema-validation-get-schema",
    "tags": [
      "Schema Validation"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/schemas/{schema_id}/operations",
    "operationId": "schema-validation-extract-operations-from-schema",
    "tags": [
      "Schema Validation"
    ],
    "pathParams": [],
    "queryParams": [
      "operation_status"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/schemas/hosts",
    "operationId": "schema-validation-list-schema-hosts",
    "tags": [
      "Schema Validation"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/settings",
    "operationId": "schema-validation-get-settings",
    "tags": [
      "Schema Validation Settings"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/settings/operations",
    "operationId": "schema-validation-list-per-operation-settings",
    "tags": [
      "Schema Validation Settings"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/schema_validation/settings/operations/{operation_id}",
    "operationId": "schema-validation-get-per-operation-setting",
    "tags": [
      "Schema Validation Settings"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/secondary_dns/incoming",
    "operationId": "secondary-dns-(-secondary-zone)-secondary-zone-configuration-details",
    "tags": [
      "Secondary DNS (Secondary Zone)"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/secondary_dns/outgoing",
    "operationId": "secondary-dns-(-primary-zone)-primary-zone-configuration-details",
    "tags": [
      "Secondary DNS (Primary Zone)"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/secondary_dns/outgoing/status",
    "operationId": "secondary-dns-(-primary-zone)-get-outgoing-zone-transfer-status",
    "tags": [
      "Secondary DNS (Primary Zone)"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights",
    "operationId": "get-zone-security-center-insights",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq",
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/{issue_id}/audit-log",
    "operationId": "get-zone-security-center-issue-audit-log",
    "tags": [
      "Security Center Audit Log"
    ],
    "pathParams": [
      "zone_id",
      "issue_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/audit-log",
    "operationId": "get-zone-security-center-audit-log",
    "tags": [
      "Security Center Audit Log"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/class",
    "operationId": "get-zone-security-center-insight-counts-by-class",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/scans",
    "operationId": "get-security-center-zone-scans",
    "tags": [
      "Security Center Scans"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/severity",
    "operationId": "get-zone-security-center-insight-counts-by-severity",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/insights/type",
    "operationId": "get-zone-security-center-insight-counts-by-type",
    "tags": [
      "Security Center Insights"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dismissed",
      "issue_class",
      "issue_type",
      "product",
      "severity",
      "subject",
      "issue_class~neq",
      "issue_type~neq",
      "product~neq",
      "severity~neq",
      "subject~neq"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/security-center/securitytxt",
    "operationId": "get-security-txt",
    "tags": [
      "security.txt"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings",
    "operationId": "zone-settings-get-all-zone-settings",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/{setting_id}",
    "operationId": "zone-settings-get-single-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id",
      "setting_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/aegis",
    "operationId": "zone-cache-settings-get-aegis-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/auto_origin_tls_kex",
    "operationId": "ssl-detector-auto-origin-tls-kex-get-enrollment",
    "tags": [
      "Origin TLS"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/csam_scanner_third_party",
    "operationId": "csam-scanner-get-setting",
    "tags": [
      "CSAM Scanner Settings"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/fonts",
    "operationId": "zone-settings-get-fonts-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/google-tag-gateway/config",
    "operationId": "zone-settings-get-google-tag-gateway-config",
    "tags": [
      "Google Tag Gateway"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/origin_h2_max_streams",
    "operationId": "zone-cache-settings-get-origin-h2-max-streams-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/origin_max_http_version",
    "operationId": "zone-cache-settings-get-origin-max-http-version-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/origin_tls_compliance_modes",
    "operationId": "zone-cache-settings-get-origin-tls-compliance-modes-setting",
    "tags": [
      "Origin TLS"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/rum",
    "operationId": "web-analytics-get-rum-status",
    "tags": [
      "Web Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/speed_brain",
    "operationId": "zone-settings-get-speed-brain-setting",
    "tags": [
      "Zone Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/ssl_automatic_mode",
    "operationId": "ssl-detector-automatic-mode-get-enrollment",
    "tags": [
      "Automatic SSL/TLS"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/config",
    "operationId": "get-zones-zone_identifier-zaraz-config",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/default",
    "operationId": "get-zones-zone_identifier-zaraz-default",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/export",
    "operationId": "get-zones-zone_identifier-zaraz-export",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/history",
    "operationId": "get-zones-zone_identifier-zaraz-history",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "offset",
      "limit",
      "sortField",
      "sortOrder"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/history/configs",
    "operationId": "get-zones-zone_identifier-zaraz-config-history",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "ids"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/settings/zaraz/workflow",
    "operationId": "get-zones-zone_identifier-zaraz-workflow",
    "tags": [
      "Zaraz"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/smart_shield",
    "operationId": "smart-shield-get-settings",
    "tags": [
      "Smart Shield Settings"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/smart_shield/cache_reserve_clear",
    "operationId": "smart-shield-settings-get-cache-reserve-clear",
    "tags": [
      "Cache Reserve Clear"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/smart_shield/healthchecks",
    "operationId": "smart-shield-list-health-checks",
    "tags": [
      "Health Checks"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/smart_shield/healthchecks/{healthcheck_id}",
    "operationId": "smart-shield-health-check-details",
    "tags": [
      "Health Checks"
    ],
    "pathParams": [
      "healthcheck_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/snippets",
    "operationId": "listZoneSnippets",
    "tags": [
      "Zone Snippets"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/snippets/{snippet_name}",
    "operationId": "getZoneSnippet",
    "tags": [
      "Zone Snippets"
    ],
    "pathParams": [
      "zone_id",
      "snippet_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/snippets/{snippet_name}/content",
    "operationId": "getZoneSnippetContent",
    "tags": [
      "Zone Snippets"
    ],
    "pathParams": [
      "zone_id",
      "snippet_name"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/snippets/snippet_rules",
    "operationId": "listZoneSnippetRules",
    "tags": [
      "Zone Snippets"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/spectrum/analytics/aggregate/current",
    "operationId": "spectrum-aggregate-analytics-get-current-aggregated-analytics",
    "tags": [
      "Spectrum Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "appID",
      "colo_name"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/spectrum/analytics/events/bytime",
    "operationId": "spectrum-analytics-(-by-time)-get-analytics-by-time",
    "tags": [
      "Spectrum Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dimensions",
      "sort",
      "until",
      "metrics",
      "filters",
      "since",
      "time_delta"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/spectrum/analytics/events/summary",
    "operationId": "spectrum-analytics-(-summary)-get-analytics-summary",
    "tags": [
      "Spectrum Analytics"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "dimensions",
      "sort",
      "until",
      "metrics",
      "filters",
      "since"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/spectrum/apps",
    "operationId": "spectrum-applications-list-spectrum-applications",
    "tags": [
      "Spectrum Applications"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "direction",
      "order"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/spectrum/apps/{app_id}",
    "operationId": "spectrum-applications-get-spectrum-application-configuration",
    "tags": [
      "Spectrum Applications"
    ],
    "pathParams": [
      "app_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/availabilities",
    "operationId": "speed-get-availabilities",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/pages",
    "operationId": "speed-list-pages",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/pages/{url}/tests",
    "operationId": "speed-list-test-history",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id",
      "url"
    ],
    "queryParams": [
      "page",
      "per_page",
      "region"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/pages/{url}/tests/{test_id}",
    "operationId": "speed-get-test",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id",
      "url",
      "test_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/pages/{url}/trend",
    "operationId": "speed-list-page-trend",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id",
      "url"
    ],
    "queryParams": [
      "region",
      "deviceType",
      "start",
      "end",
      "tz",
      "metrics"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/speed_api/schedule/{url}",
    "operationId": "speed-get-scheduled-test",
    "tags": [
      "Observatory"
    ],
    "pathParams": [
      "zone_id",
      "url"
    ],
    "queryParams": [
      "region"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ssl/certificate_packs",
    "operationId": "certificate-packs-list-certificate-packs",
    "tags": [
      "Certificate Packs"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "page",
      "per_page",
      "status",
      "deploy"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ssl/certificate_packs/{certificate_pack_id}",
    "operationId": "certificate-packs-get-certificate-pack",
    "tags": [
      "Certificate Packs"
    ],
    "pathParams": [
      "certificate_pack_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ssl/certificate_packs/quota",
    "operationId": "certificate-packs-get-certificate-pack-quotas",
    "tags": [
      "Certificate Packs"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ssl/universal/settings",
    "operationId": "universal-ssl-settings-for-a-zone-universal-ssl-settings-details",
    "tags": [
      "Universal SSL Settings for a Zone"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/ssl/verification",
    "operationId": "ssl-verification-ssl-verification-details",
    "tags": [
      "SSL Verification"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "retry"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/subscription",
    "operationId": "zone-subscription-zone-subscription-details",
    "tags": [
      "Zone Subscription"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/tags",
    "operationId": "tags-zone-get",
    "tags": [
      "Resource Tagging"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": [
      "resource_id",
      "resource_type",
      "access_application_id"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/token_validation/config",
    "operationId": "token-validation-config-list",
    "tags": [
      "Token Validation Token Configuration"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/token_validation/config/{config_id}",
    "operationId": "token-validation-config-get",
    "tags": [
      "Token Validation Token Configuration"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/token_validation/rules",
    "operationId": "token-validation-rules-list",
    "tags": [
      "Token Validation Token Rules"
    ],
    "pathParams": [],
    "queryParams": [
      "token_configuration",
      "action",
      "enabled",
      "id",
      "rule_id",
      "host",
      "hostname"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/token_validation/rules/{rule_id}",
    "operationId": "token-validation-rules-get",
    "tags": [
      "Token Validation Token Rules"
    ],
    "pathParams": [],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/url_normalization",
    "operationId": "getUrlNormalization",
    "tags": [
      "URL Normalization"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms",
    "operationId": "waiting-room-list-waiting-rooms",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}",
    "operationId": "waiting-room-waiting-room-details",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events",
    "operationId": "waiting-room-list-events",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events/{event_id}",
    "operationId": "waiting-room-event-details",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "event_id",
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events/{event_id}/details",
    "operationId": "waiting-room-preview-active-event-details",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "event_id",
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/rules",
    "operationId": "waiting-room-list-waiting-room-rules",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/status",
    "operationId": "waiting-room-get-waiting-room-status",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "waiting_room_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/waiting_rooms/settings",
    "operationId": "waiting-room-get-zone-settings",
    "tags": [
      "Waiting Room"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/web3/hostnames",
    "operationId": "web3-hostname-list-web3-hostnames",
    "tags": [
      "Web3 Hostname"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/web3/hostnames/{identifier}",
    "operationId": "web3-hostname-web3-hostname-details",
    "tags": [
      "Web3 Hostname"
    ],
    "pathParams": [
      "identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list",
    "operationId": "web3-hostname-ipfs-universal-path-gateway-content-list-details",
    "tags": [
      "Web3 Hostname"
    ],
    "pathParams": [
      "identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list/entries",
    "operationId": "web3-hostname-list-ipfs-universal-path-gateway-content-list-entries",
    "tags": [
      "Web3 Hostname"
    ],
    "pathParams": [
      "identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list/entries/{content_list_entry_identifier}",
    "operationId": "web3-hostname-ipfs-universal-path-gateway-content-list-entry-details",
    "tags": [
      "Web3 Hostname"
    ],
    "pathParams": [
      "content_list_entry_identifier",
      "identifier",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/workers/routes",
    "operationId": "worker-routes-list-routes",
    "tags": [
      "Worker Routes"
    ],
    "pathParams": [
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_id}/workers/routes/{route_id}",
    "operationId": "worker-routes-get-route",
    "tags": [
      "Worker Routes"
    ],
    "pathParams": [
      "route_id",
      "zone_id"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/analytics/colos",
    "operationId": "zone-analytics-(-deprecated)-get-analytics-by-co-locations",
    "tags": [
      "Zone Analytics (Deprecated)"
    ],
    "pathParams": [
      "zone_identifier"
    ],
    "queryParams": [
      "until",
      "since",
      "continuous"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/analytics/dashboard",
    "operationId": "zone-analytics-(-deprecated)-get-dashboard",
    "tags": [
      "Zone Analytics (Deprecated)"
    ],
    "pathParams": [
      "zone_identifier"
    ],
    "queryParams": [
      "until",
      "since",
      "continuous"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/custom_pages",
    "operationId": "custom-pages-for-a-zone-list-custom-pages",
    "tags": [
      "Custom pages for a zone"
    ],
    "pathParams": [
      "zone_identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/custom_pages/{identifier}",
    "operationId": "custom-pages-for-a-zone-get-a-custom-page",
    "tags": [
      "Custom pages for a zone"
    ],
    "pathParams": [
      "identifier",
      "zone_identifier"
    ],
    "queryParams": []
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/custom_pages/assets",
    "operationId": "custom-assets-for-a-zone-list-custom-assets",
    "tags": [
      "Custom assets for a zone"
    ],
    "pathParams": [
      "zone_identifier"
    ],
    "queryParams": [
      "page",
      "per_page"
    ]
  },
  {
    "method": "GET",
    "path": "/zones/{zone_identifier}/custom_pages/assets/{asset_name}",
    "operationId": "custom-assets-for-a-zone-get-a-custom-asset",
    "tags": [
      "Custom assets for a zone"
    ],
    "pathParams": [
      "asset_name",
      "zone_identifier"
    ],
    "queryParams": []
  }
];
