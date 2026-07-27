export interface MigrationConfig {
  sourceToken: string;
  destToken: string;
  sourceZoneId: string;
  sourceAccountId: string;
  destAccountId: string;
  domainName?: string;
  dryRun: boolean;
  customCertificates?: CertificateInput[];
  workerSecrets?: Record<string, Record<string, string>>;
  // API Key auth (alternative to tokens)
  apiKey?: string;
  apiEmail?: string;
  useApiKey?: boolean;
  // Separate destination API key credentials (when source and dest use different keys)
  destApiKey?: string;
  destApiEmail?: string;
  // Selective migration: which items to include (by category and item ID)
  selections?: Record<string, Record<string, boolean>>;
  // Target zone plan to assign before migrating (e.g. 'enterprise', 'business', 'pro')
  targetPlan?: string;
  // Durable Object migration config
  doMigration?: DOMigrationInput[];
  // Conflict resolution strategy for "already exists" resources
  conflictStrategy?: 'skip' | 'overwrite';
  // When true, zone migration skips account-level resources (workers, storage,
  // LB monitors/pools, Access, Turnstile) because they were pre-deployed via
  // the /api/migrate/account-resources endpoint.
  skipAccountResources?: boolean;
  // R2 S3-compatible API credentials for data migration (per-account)
  r2Credentials?: {
    source?: { accessKeyId: string; secretAccessKey: string };
    dest?: { accessKeyId: string; secretAccessKey: string };
  };
  /** Pre-migration acknowledgments: string keys from the UI (capability/licensing group keys the user accepted) */
  acknowledgments?: string[];
  /** Email forwarding addresses the user explicitly chose to skip in Step 2 (lowercased). Rules forwarding to these addresses will be acknowledged at migrate time. */
  skippedEmailAddresses?: string[];
  /** Origin CA certificate re-issuance inputs supplied in Step 3.
   * Each entry contains a CSR (with a freshly-generated private key the
   * user keeps locally) plus the cert metadata to re-issue on the
   * destination. The original cert body is exportable but the private
   * key was never stored by Cloudflare. */
  originCaCertificates?: OriginCaCertificateInput[];
  /** Notification webhook signing secrets supplied by the user via the
   * Step 2 OutOfScopePanel inline fix-it form (or the equivalent Step 3
   * section). Keyed by webhook NAME — source and destination IDs differ
   * after migration, but the name is preserved on recreate, so we use
   * the source name as the stable lookup key. When a value is present
   * here, the migrate code passes it on the POST body to
   * /alerting/v3/destinations/webhooks instead of omitting the secret
   * and emitting a "re-paste manually" warning.
   *
   * The API accepts `secret` on create (write-only on subsequent GETs). */
  notificationWebhookSecrets?: Record<string, string>;
  /** Access IdP OAuth/SAML client_secret values, keyed by source IdP
   *  name. When supplied, the migrator merges the secret with the
   *  IdP config captured at export time and POSTs to
   *  /access/identity_providers. When absent for a given IdP, the
   *  IdP is acknowledged-only (previous behaviour) and the user must
   *  recreate it manually post-migration.
   *
   *  The API accepts `client_secret` inside `config` on create (write-
   *  only on subsequent GETs). */
  identityProviderSecrets?: Record<string, string>;
  /** Secondary DNS TSIG secrets, keyed by source TSIG name. The
   *  secret bytes are write-only at create time (the API never
   *  returns them on subsequent GETs), so they must be re-supplied
   *  by the user via the Step 3 UI mirror of workerSecrets. When
   *  present, the migrator POSTs the TSIG to /accounts/{}/secondary_dns/tsigs
   *  with the supplied secret. When absent, the TSIG is acknowledged
   *  via the `secondary_dns_tsig_secrets` IMPOSSIBLE entry and the
   *  user must paste the secret in the dest dashboard.
   *
   *  Step 3 UI integration is deferred — adding the data shape here
   *  lets the migrator pick up secrets when the UI catches up. */
  tsigSecrets?: Record<string, string>;
  /** Hyperdrive origin database credentials, keyed by source config
   *  name. Each entry supplies the write-only credentials the source
   *  API never returns:
   *    - `password` (required for all origin types)
   *    - `access_client_secret` (only when origin is Access-protected)
   *  When a Hyperdrive config name is present here, the migrator POSTs
   *  the full config with these credentials merged into the origin
   *  block. When absent, the config is acknowledged via
   *  `hyperdrive_origin_credentials` IMPOSSIBLE entry. Step 3 UI
   *  integration is deferred. */
  hyperdriveOriginCredentials?: Record<string, { password?: string; access_client_secret?: string }>;
  /** Bucket 2.3: Authenticated Origin Pulls mTLS certificate
   * bundles (per-zone client cert + private key the dest origin
   * will use to verify Cloudflare). Each entry uploads to
   * /accounts/{id}/mtls_certificates and is then associated with
   * one or more hostnames. The user supplies cert + key + optional
   * CA flag via the Step 2 inline fix-it form. */
  aopMtlsBundles?: Array<{
    /** Display name for the bundle (also used as dedup key). */
    name: string;
    /** PEM-encoded certificate (may be a chain). */
    certificates: string;
    /** PEM-encoded private key. */
    private_key: string;
    /** Default false — set true for CA-style bundles (e.g. signing
     * client certs). Matches the Cloudflare API's `ca` parameter. */
    ca?: boolean;
  }>;
  /** Bucket 2.4: API keys for AI Gateway custom providers, keyed by
   * source provider SLUG. The migrator creates the custom provider
   * on dest, then creates a corresponding entry in Cloudflare
   * Secrets Store with `scopes: ["ai_gateway"]` so the user's
   * worker code can reference it. This is a two-step create per
   * the spike findings. */
  aiGatewayProviderApiKeys?: Record<string, string>;
}

export interface DOMigrationInput {
  scriptName: string;
  classNames: string[];
  objectNames: string[]; // Names used with idFromName()
  sourceWorkerUrl: string; // e.g., https://my-worker.account.workers.dev
  destWorkerUrl: string;
}

export interface CertificateInput {
  certificate: string;
  privateKey: string;
  bundleMethod?: string;
}

export interface MigrationReport {
  timestamp: string;
  sourceZone: string;
  destZone: string;
  destAccountId: string;
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    acknowledged?: number;
  };
  sections: ReportSection[];
  errors: MigrationError[];
  conflicts: MigrationError[]; // Resources that already exist at destination
  warnings: string[];
  manualActions: string[];
  newNameservers: string[];
  /**
   * Destination zone tag, ALWAYS set once the zone is resolved — whether it
   * was freshly created OR an existing destination-account zone was reused.
   * Distinct from `createdResources.zoneId`, which is set ONLY when we created
   * the zone (rollback + the "zones migrated" stat counter depend on that
   * narrower meaning, so it must not be populated for a reused zone). The
   * post-migration verification (Step 4 "Verify Now") keys off THIS field so
   * it works for reused zones too.
   */
  destZoneId?: string;
  // [R13] Track all created resource IDs for rollback support
  createdResources?: {
    zoneId?: string;
    workers: string[];
    kvNamespaces: string[];
    r2Buckets: string[];
    d1Databases: string[];
    queues: string[];
    doNamespaces: string[];
    dnsRecords: string[];
    pageRules: string[];
    rulesets: string[];
    accessApps: string[];
    emailRules: string[];
    customHostnames: string[];
    turnstileWidgets: string[];
  };
  doMigrationResults?: DOMigrationResultSummary[];
  /**
   * Destination Access organization ("team domain") — populated by
   * IdP migration when at least one IdP was created on dest. Used by
   * the Step 4 "Test Configuration" workflow to build per-IdP login
   * URLs of the form
   * `https://<auth_domain>.cloudflareaccess.com/cdn-cgi/access/sso/<type>/<id>/login`.
   *
   * Undefined when:
   *   - No IdPs were migrated (no need to fetch).
   *   - The dest account has no Access org configured (404 / no team
   *     domain). The Step 4 card renders a fallback message in that
   *     case rather than broken links.
   *   - The fetch itself failed transiently (logged as a warning,
   *     non-fatal).
   */
  destAccessOrg?: { auth_domain: string; name: string };
  /**
   * IdPs that were actually created on dest, captured here so Step 4
   * can render Test login buttons keyed by destination IdP ID. The
   * destination ID is what appears in the login URL.
   *
   * Excludes IdPs that fell back to acknowledged-only (missing
   * secret) or onetimepin (auto-provisioned). SAML IdPs ARE included
   * — they migrate without a user-supplied client_secret but still
   * benefit from end-to-end login testing.
   */
  migratedIdentityProviders?: Array<{
    /** Destination IdP UUID (from create POST response). */
    destId: string;
    /** Source IdP name (also reused as dest name). */
    name: string;
    /** IdP type slug (oidc, saml, okta, azureAD, etc.). */
    type: string;
  }>;
  /** Post-migration validation results (GET-back from destination) */
  validation?: ValidationResult;
  /** Post-cutover verification: full source vs destination diff. Optional;
   *  produced by the Step 4 "Re-verify" action, not the initial migrate run. */
  verification?: {
    destExport: ZoneExport;
    diff: {
      discrepancies: Array<{
        path: string;
        type: 'missing' | 'extra' | 'mismatched';
        reason?: string;
        /** Resource grouping for the discrepancy (e.g. "dnsRecords"). */
        resource?: string;
        /** Source-side value for mismatched entries. */
        source?: unknown;
        /** Destination-side value for mismatched entries. */
        dest?: unknown;
      }>;
    };
    timestamp: string;
  };
}

export interface DOMigrationResultSummary {
  workerName: string;
  className: string;
  sourceNamespaceId: string;
  destNamespaceId: string;
  objectsSynced: number;
  objectsFailed: number;
  status: 'success' | 'partial' | 'failed';
  error?: string;
}

export interface ReportSection {
  name: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  /** Pre-acknowledged items that user accepted won't migrate (defaults to 0) */
  acknowledged?: number;
  items: ReportItem[];
}

export interface ReportItem {
  name: string;
  status: 'success' | 'failed' | 'skipped' | 'acknowledged';
  error?: string;
  /** Optional human-readable detail rendered inline in the Step 4 report. */
  detail?: string;
  /** Optional reason explaining why this item is acknowledged or skipped. */
  reason?: string;
  /** Optional description for richer display contexts. */
  description?: string;
  /** Dashboard deep-link metadata (Step 4 source/dest links). See
   * app/lib/dashLinks.ts. `dashGroupKey` is the resource group key (enables a
   * section-level link); `sourceDashId`/`destDashId` enable item-level links
   * when the resource's dashboard id is known. */
  dashGroupKey?: string;
  sourceDashId?: string;
  destDashId?: string;
}

/**
 * Migration run logging (beta troubleshooting telemetry).
 *
 * A PII-stripped, allowlisted projection of MigrationReport that is persisted
 * to the RUN_LOG KV namespace so we can debug failures users hit during the
 * beta. Only the fields below are ever logged. Credentials/tokens/secrets/keys
 * (which live on MigrationConfig, never on MigrationReport) are NEVER included,
 * and the full `verification.destExport` ZoneExport is deliberately excluded.
 * Free-text fields are additionally redacted (emails/IPs → `[email]`/`[ip]`).
 *
 * See src/migrate/run-log.ts and docs/SECURITY.md § "Data collection".
 */
export interface RunLogRecord {
  schemaVersion: number;
  runId: string;
  timestamp: string;
  kind: 'zone' | 'account-resources' | 'maxconfig' | 'minconfig';
  toolVersion: string;
  /** Zone identity — kept on purpose (the thing being migrated, not PII). */
  sourceZone: string;
  destZone: string;
  destAccountId: string;
  summary: MigrationReport['summary'];
  sections: Array<{
    name: string;
    total: number;
    success: number;
    failed: number;
    skipped: number;
    acknowledged?: number;
    items: Array<{
      name: string;
      status: ReportItem['status'];
      error?: string;
      reason?: string;
      detail?: string;
    }>;
  }>;
  errors: Array<{ resource: string; name: string; error: string; category?: ErrorCategory }>;
  conflicts: Array<{ resource: string; name: string; error: string; category?: ErrorCategory }>;
  warnings: string[];
  manualActions: string[];
  newNameservers: string[];
  createdResources?: MigrationReport['createdResources'];
  /** IdP display name dropped; only non-PII dest id + type retained. */
  migratedIdentityProviders?: Array<{ destId: string; type: string }>;
  doMigrationResults?: DOMigrationResultSummary[];
}

/** Aggregate, non-PII stats surfaced by GET /api/stats for the landing-page counter. */
export interface MigrationStats {
  /** Successful zone migrations that created a new destination zone. */
  zonesMigrated: number;
  /** zonesMigrated × hoursPerMigration (an estimate, surfaced as such). */
  hoursSaved: number;
  /** The per-migration hours estimate used to derive hoursSaved. */
  hoursPerMigration: number;
}

/** Pre-migration acknowledgment: user accepted that certain items won't migrate */
export interface Acknowledgment {
  /** Category key matching resource group (e.g. 'rateLimits', 'loadBalancers') */
  category: string;
  /** Human-readable reason the user acknowledged */
  reason: string;
  /** Specific item names within the category (empty = entire category) */
  items?: string[];
}

/** Post-migration validation: GET-back resources from destination to confirm they saved */
export interface ValidationResult {
  timestamp: string;
  sections: ValidationSection[];
  summary: {
    total: number;
    verified: number;
    missing: number;
    mismatched: number;
    acknowledged?: number;
    /** How many rows could NOT be verified because the read-back GET itself
     * failed (token scope, transient 429/5xx) — distinct from `missing`
     * (verification ran, resource absent). Per Principle 1, an unverified row
     * is NOT a failure: verification did not run, so we make no claim about
     * presence/absence. Defaults to 0. */
    unverified?: number;
  };
}

export interface ValidationSection {
  name: string;
  /** How many resources the migration attempted to create */
  expected: number;
  /** How many were confirmed via GET */
  verified: number;
  /** How many were expected but not found */
  missing: number;
  /** How many exist but have different values */
  mismatched: number;
  /** How many were pre-acknowledged by user (known won't migrate) — defaults to 0 */
  acknowledged?: number;
  /** How many could not be verified because the read-back GET failed — distinct
   * from `missing`. Defaults to 0. */
  unverified?: number;
  items: ValidationItem[];
}

export interface ValidationItem {
  name: string;
  status: 'verified' | 'missing' | 'mismatched' | 'acknowledged' | 'unverified';
  /** Detail about the mismatch or absence */
  detail?: string;
  /** Dashboard deep-link metadata for Step 4 source/dest links. See
   * app/lib/dashLinks.ts. `dashGroupKey` enables a section-level link;
   * `sourceDashId`/`destDashId` enable item-level links when the resource's
   * dashboard id is known. `destDashId` is only meaningful for verified /
   * mismatched rows (the resource exists on the destination). */
  dashGroupKey?: string;
  sourceDashId?: string;
  destDashId?: string;
}

export type ErrorCategory = 'api' | 'manual_setup' | 'billing' | 'permission';

export interface MigrationError {
  resource: string;
  name: string;
  error: string;
  suggestion?: string;
  category?: ErrorCategory;
}

export interface ZoneExport {
  zone: CFZone;
  /** Source account ID; mirrors zone.account.id for callers that want a
   *  top-level shortcut. Optional because legacy exports may omit it. */
  sourceAccountId?: string;
  dnsRecords: CFDNSRecord[];
  settings: CFZoneSetting[];
  pageRules: CFPageRule[];
  rulesets: CFRuleset[];
  workers: CFWorkerScript[];
  workerRoutes: CFWorkerRoute[];
  workerCustomDomains?: CFWorkerCustomDomain[];
  loadBalancers: CFLoadBalancer[];
  pools: CFPool[];
  monitors: CFMonitor[];
  spectrumApps: CFSpectrumApp[];
  customCertificates: CFCustomCertificate[];
  customHostnames: CFCustomHostname[];
  accessApps: CFAccessApp[];
  accessPolicies: CFAccessPolicy[];
  firewallRules: CFFirewallRule[];
  rateLimits: CFRateLimit[];
  emailRoutingRules: CFEmailRoutingRule[];
  waitingRooms: CFWaitingRoom[];
  zarazConfig: CFZarazConfig | null;
  /** Google Tag Gateway (server-side gtag/GTM) config — zone-scoped singleton. */
  googleTagGateway?: Record<string, unknown> | null;
  /** Smart Shield (Enterprise) settings singleton + its health checks. */
  smartShield?: Record<string, unknown> | null;
  smartShieldHealthchecks?: Record<string, unknown>[];
  turnstileWidgets: CFTurnstileWidget[];
  // Separate-endpoint features (not part of /zone/settings)
  argoSmartRouting?: { value: string } | null;    // 'on' | 'off', from /argo/smart_routing
  argoTieredCaching?: { value: string } | null;   // 'on' | 'off', from /argo/tiered_caching
  botManagement?: BotManagementExport | null;      // from /bot_management
  // Storage resources (Account-level)
  kvNamespaces: CFKVNamespace[];
  r2Buckets: CFR2Bucket[];
  d1Databases: CFD1Database[];
  queues: CFQueue[];
  durableObjectNamespaces: CFDurableObjectNamespace[];
  // Zone-relatedness tracking for account-level resources
  zoneRelatedness?: {
    kvNamespaces: string[];
    r2Buckets: string[];
    d1Databases: string[];
    queues: string[];
    durableObjects: string[];
    loadBalancers: string[];
    pools: string[];
    monitors: string[];
    accessApps: string[];
    turnstileWidgets: string[];
  };
  // Additional zone-scoped resources with dedicated endpoints
  managedHeaders?: { managed_request_headers?: { id: string; enabled: boolean }[]; managed_response_headers?: { id: string; enabled: boolean }[] } | null;
  cloudConnectorRules?: { id?: string; expression: string; provider: string; parameters: { host: string }; description?: string; enabled?: boolean }[];
  urlNormalization?: { type: string; scope: string } | null;
  /** Precursor enforcement config (singleton). Migrated via PUT /zones/{}/precursor. */
  precursor?: {
    default_mode?: 'off' | 'min-friction' | 'max-security';
    enforcement_rules?: { expression: string; mode: 'min-friction' | 'max-security'; description?: string; enabled?: boolean }[];
  } | null;
  cacheReserve?: { value: 'on' | 'off' } | null;
  snippets?: { snippet_name: string; code: string }[];
  snippetRules?: { id?: string; expression: string; description?: string; enabled?: boolean; snippet_name: string }[];
  healthchecks?: {
    id?: string;
    name: string;
    description?: string;
    address: string;
    type: 'HTTP' | 'HTTPS' | 'TCP';
    interval?: number;
    timeout?: number;
    retries?: number;
    http_config?: {
      method?: string;
      port?: number;
      path?: string;
      expected_codes?: string[];
      follow_redirects?: boolean;
      allow_insecure?: boolean;
      expected_body?: string;
      header?: Record<string, string[]>;
    };
    tcp_config?: { method?: string; port?: number };
    suspended?: boolean;
    check_regions?: string[];
  }[];
  // 100%-coverage additions
  dnsSettings?: unknown | null;
  dnssecStatus?: { status: string } | null;          // read-only flag only
  regionalHostnames?: { hostname: string; region_key: string }[];
  regionalTieredCache?: { value: 'on' | 'off' } | null;
  cacheVariants?: { value: unknown } | null;
  originPostQuantum?: { value: 'preferred' | 'supported' | 'off' } | null;
  clientCertificates?: { id?: string; certificate: string; csr?: string }[];
  fraudDetectionSettings?: Record<string, unknown> | null;
  accessRules?: { id?: string; mode: string; notes?: string; configuration: { target: string; value: string } }[];
  firewallLockdowns?: { id?: string; description?: string; urls: string[]; configurations: { target: string; value: string }[] }[];
  uaRules?: { id?: string; mode: string; description?: string; configuration: { target: 'ua'; value: string } }[];
  pageShieldSettings?: { enabled?: boolean } | null;
  pageShieldPolicies?: { id?: string; description?: string; enabled?: boolean; expression: string; action: 'allow' | 'log'; value?: string }[];
  logpushJobs?: { id?: number; dataset?: string; destination_conf: string; enabled?: boolean; filter?: string; frequency?: string; kind?: string; logpull_options?: string; max_upload_bytes?: number; max_upload_interval_seconds?: number; max_upload_records?: number; name?: string; output_options?: unknown; ownership_challenge?: string }[];
  schemaValidationSchemas?: { schema_id?: string; name: string; kind: 'openapi_v3'; source: string; validation_enabled?: boolean }[];
  schemaValidationSettings?: { validation_default_mitigation_action?: string; validation_override_mitigation_action?: string } | null;
  tokenValidationConfigs?: { id?: string; name?: string; source?: { id?: string; type?: string }; validation?: { algorithm?: string; key?: string } }[];
  tokenValidationRules?: { id?: string; config?: string; expression: string; enabled?: boolean; description?: string }[];
  certificatePacks?: { id?: string; type?: string; hosts?: string[]; certificate_authority?: string; validation_method?: string; validity_days?: number }[];
  acmTotalTls?: { enabled: boolean; certificate_authority?: string } | null;
  /** Certificate Transparency (CT) Monitoring alerting subscription
   *  (SSL/TLS → Edge Certificates → Certificate Transparency Monitoring).
   *  Singleton `{ enabled, emails? }`, migrated via PATCH /zones/{}/ct/alerting.
   *  `emails` only applies to Business/Enterprise zones (Principle 2/7). */
  ctAlerting?: { enabled: boolean; emails?: string[] } | null;
  /** Automatic Origin TLS Key Exchange (SSL/TLS → Origin Server). Dedicated
   *  Origin-TLS singleton, migrated via PATCH /zones/{}/settings/auto_origin_tls_kex
   *  with a { enabled } body (not the standard { value } setting shape). */
  autoOriginTlsKex?: { enabled: boolean } | null;
  /** Email Routing settings singleton. `enabled` is provisioned by the enable
   *  flow; the request-affecting `support_subaddress` (and `skip_wizard`) are
   *  carried via PATCH /zones/{}/email/routing after routing is enabled. */
  emailRoutingSettings?: { enabled?: boolean; skip_wizard?: boolean; support_subaddress?: boolean } | null;
  apiGatewayOperations?: { operation_id?: string; method: string; endpoint: string; host: string }[];
  apiGatewaySchemas?: { schema_id?: string; name: string; kind: string; source: string; validation_enabled?: boolean }[];
  /** API Shield zone-wide configuration (auth_id_characteristics —
   *  defines how API Shield identifies API sessions). Singleton. */
  apiGatewayConfiguration?: { auth_id_characteristics?: unknown[] } | null;
  /** API Shield user labels (user-defined operation tags). Attach to
   *  operations by NAME, so no ID remap is needed. */
  apiGatewayUserLabels?: { label_id?: string; name: string; description?: string; metadata?: Record<string, unknown> }[];
  /** Per-operation schema-validation mitigation overrides, keyed by the
   *  operation triple (method|host|endpoint) which is stable across
   *  accounts. The migrate step remaps to the dest operation ID after
   *  operations are re-created, then bulk-PATCHes. */
  apiGatewayOperationSchemaValidation?: { method: string; host: string; endpoint: string; mitigation_action?: string | null }[];
  waitingRoomEvents?: { roomName: string; events: { id?: string; name: string; event_start_time: string; event_end_time: string }[] }[];
  hostnameAssociations?: { mtls_certificate_id?: string; hostnames?: string[] } | null;
  originTlsSettings?: { enabled?: boolean } | null;
  originTlsHostnames?: { id?: string; hostname: string; cert_id?: string; enabled?: boolean }[];
  // ── Newer zone-level features (AGENTS.md Principle 7) ────────────
  // Each of these would change destination behaviour if missing, and
  // the API supports moving them. Implementations live alongside
  // similar singleton/list patterns in src/migrate/zone-extras.ts.
  /** Fallback origin used by SaaS / custom-hostname routing when no
   *  custom hostname matches the request. */
  customHostnameFallbackOrigin?: { origin: string; status?: string } | null;
  /** AI Security zone settings (App Sec Advanced bundle). Two opaque
   *  config blobs; structure varies by entitlement so typed as
   *  Record<string, unknown>. */
  aiSecuritySettings?: Record<string, unknown> | null;
  aiSecurityCustomTopics?: Record<string, unknown> | null;
  /** Workers Observability — account-scoped log routing destinations
   *  and saved queries. `config.token` on destinations is write-only;
   *  the user re-supplies tokens in Step 3 (acknowledged via
   *  worker_observability_destination_tokens). */
  workersObservabilityDestinations?: { id?: string; slug?: string; name: string; type: string; enabled?: boolean; config?: Record<string, unknown> }[];
  workersObservabilityQueries?: { id?: string; name: string; query: string; description?: string }[];
  /** Vectorize indexes (account-scoped). Index definition migrates;
   *  vector data inside does not (data_offline). */
  vectorizeIndexes?: { name: string; description?: string; config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' } }[];
  /** Waiting Room zone-level singleton settings (search-engine crawler
   *  bypass, etc.). Per-room config migrates via `waitingRooms`. */
  waitingRoomSettings?: Record<string, unknown> | null;
  /** WAF Content Upload Scanning zone settings. Gated by App Sec
   *  Advanced bundle; the capability probe surfaces missing entitlement
   *  as an acknowledgment (per Principle 2) — the migration itself is a
   *  simple PUT. */
  contentUploadScanSettings?: Record<string, unknown> | null;
  /** Cache Origin Cloud Regions — list of IP-to-cloud-region mappings
   *  (AWS / Azure / GCP / OCI) that route Tiered Cache through the
   *  nearest upper-tier colo for that cloud. Requires Tiered Cache
   *  to be enabled on the zone. Migrated as a batch PATCH (idempotent
   *  upsert, up to 100 mappings per call; zones cap at 3,500).
   *  API note: list endpoint returns mappings as `{origin-ip, region,
   *  vendor}` (note the hyphenated key); write endpoints use `ip`. */
  cacheOriginCloudRegions?: { ip: string; region: string; vendor: 'aws' | 'azure' | 'gcp' | 'oci' }[];
  /** Leaked Credential Checks — zone-wide enable toggle plus a list of
   *  user-defined "custom detection" patterns (each is a pair of
   *  ruleset expressions matching where username/password live in the
   *  request body). The toggle itself is the zone-level on/off; the
   *  custom detections augment the auto-managed detections that ship
   *  with the WAF managed ruleset (which is what the
   *  `leaked_credential_detection` IMPOSSIBLE entry refers to — the
   *  auto-detections are auto-managed, but user customs are not). */
  leakedCredentialChecksStatus?: { enabled?: boolean } | null;
  leakedCredentialCustomDetections?: { id?: string; username?: string; password?: string }[];
  /** Email Sending Subdomains — outbound transactional sending domains
   *  registered to the zone. Each entry is a `mail.example.com`-style
   *  subdomain that the dest zone needs in order to send mail on
   *  behalf of the customer. The DKIM selector and return-path domain
   *  are provisioned automatically by CF on create — only the `name`
   *  is user-supplied. Distinct from Email Routing (inbound forwarding)
   *  even though both share the /email/* path prefix. */
  emailSendingSubdomains?: { name: string; tag?: string; enabled?: boolean; dkim_selector?: string; return_path_domain?: string }[];
  /** Web3 Gateway Hostnames — IPFS / IPFS Universal Path / Ethereum
   *  gateways exposed via a CNAME on the zone (e.g. gateway.example.com
   *  → CF's IPFS gateway). Each hostname has `{name, target, description?,
   *  dnslink?}` and migrates cleanly via POST. For `ipfs_universal_path`
   *  hostnames, the optional IPFS content block-list is captured at
   *  `contentList: { action, entries: [...] }` and migrates via the
   *  full-replace PUT on the dest after the parent hostname is created. */
  web3Hostnames?: {
    id?: string;
    name: string;
    target: 'ethereum' | 'ipfs' | 'ipfs_universal_path';
    description?: string;
    dnslink?: string;
    contentList?: { action: 'block'; entries: { content: string; type: 'cid' | 'content_path'; description?: string }[] } | null;
  }[];
  /** Secondary DNS — Enterprise feature for using CF as a secondary
   *  nameserver (incoming, AXFR/IXFR from a customer-operated primary)
   *  or as a primary that ships zone transfers to customer secondaries
   *  (outgoing). Configuration spans two scopes:
   *
   *  Account-scoped (shared across all zones in the account):
   *    - `secondaryDnsAcls`   — IP ACLs (`{name, ip_range}`).
   *    - `secondaryDnsPeers`  — remote nameserver definitions
   *                              (`{name, ip, port, ixfr_enable, tsig_id?}`).
   *                              Each peer references a TSIG by ID.
   *    - `secondaryDnsTsigs`  — TSIG key metadata
   *                              (`{name, algo}`). Secret material is
   *                              acknowledged via `secondary_dns_tsig_secrets`
   *                              IMPOSSIBLE entry — not migratable.
   *
   *  Zone-scoped (per-zone):
   *    - `secondaryDnsIncoming` — incoming-zone config; references peers
   *                                 by ID (remapped at migrate time).
   *    - `secondaryDnsOutgoing` — outgoing-zone config; references peers
   *                                 by ID (remapped at migrate time).
   *
   *  The 2026-05-26 audit removed the `secondary_dns_incoming` and
   *  `secondary_dns_outgoing` IMPOSSIBLE entries (the "manual coordination
   *  with the primary DNS provider" was customer-side, not CF-side; the
   *  CF-side config IS programmable). TSIG secrets remain cryptographic
   *  and acknowledged separately. */
  secondaryDnsAcls?: { id?: string; name: string; ip_range: string }[];
  secondaryDnsPeers?: { id?: string; name: string; ip?: string; port?: number; ixfr_enable?: boolean; tsig_id?: string }[];
  secondaryDnsTsigs?: { id?: string; name: string; algo: string }[];
  /** Per-zone incoming secondary DNS config. `peers` is an array of
   *  source peer IDs that the migrator remaps to dest peer IDs before
   *  POST. */
  secondaryDnsIncoming?: { id?: string; name?: string; auto_refresh_seconds?: number; peers?: string[] } | null;
  /** Per-zone outgoing secondary DNS config. Same peer ID remapping as
   *  incoming. */
  secondaryDnsOutgoing?: { id?: string; name?: string; peers?: string[] } | null;
  /** Load Balancer Monitor Groups — account-scoped grouping of monitors
   *  for shared health-check policy on pools. Each group has
   *  `{description, members: [{monitor_id, enabled, monitoring_only,
   *  must_be_healthy}]}`. Source monitor IDs in members are remapped to
   *  dest monitor IDs at migrate time using the same monitorIdMap that
   *  pools use. Pools that reference a monitor group via `monitor_group`
   *  also need a group-id remap, but that's handled separately when (if)
   *  the pool plumbing is extended to surface `monitor_group`. */
  loadBalancerMonitorGroups?: {
    id?: string;
    description?: string;
    members?: { monitor_id: string; enabled?: boolean; monitoring_only?: boolean; must_be_healthy?: boolean }[];
  }[];
  /** Hyperdrive configs — account-scoped connection pools for upstream
   *  databases (Postgres / MySQL / Workers VPC service-backed). Each
   *  config has `{name, origin: {scheme, host, port, database, user,
   *  password}, caching?, mtls?, origin_connection_limit?}`. The
   *  `password` (and `access_client_secret` for Access-protected
   *  databases) is write-only — never returned by GET — so the source
   *  config exports without it. Users re-supply credentials at Step 3
   *  via MigrationConfig.hyperdriveOriginCredentials. Configs without
   *  supplied credentials are acknowledged via
   *  `hyperdrive_origin_credentials` (cryptographic). */
  hyperdriveConfigs?: {
    id?: string;
    name: string;
    origin?: {
      scheme?: 'postgres' | 'postgresql' | 'mysql';
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      // password / access_client_secret intentionally omitted
      access_client_id?: string;
      service_id?: string;
    };
    caching?: { disabled?: boolean; max_age?: number; stale_while_revalidate?: number };
    mtls?: { ca_certificate_id?: string; mtls_certificate_id?: string; sslmode?: string };
    origin_connection_limit?: number;
  }[];
  /** Secrets Store stores — account-scoped namespaces for secret
   *  values consumed by Workers via the `secrets_store_secrets`
   *  binding. Only the store METADATA (`{id, name}`) migrates here;
   *  the secret VALUES inside each store are write-only and remain
   *  acknowledged via `worker_binding_secrets_store`. After the store
   *  is recreated on the destination, the migrator remaps Worker
   *  binding `store_id` via secretsStoreIdMap; the user must then
   *  re-populate each secret on the dest dashboard (the binding's
   *  `secret_name` is preserved). */
  secretsStoreStores?: { id?: string; name: string }[];
  /** Custom Nameservers metadata — `{enabled, ns_set}` controls
   *  whether the zone uses account-level custom nameservers and
   *  which set (1-5). Account-level CNS provisioning is admin_only
   *  (out of scope); the per-zone ON/OFF toggle migrates as a
   *  singleton. */
  customNameserversMetadata?: { enabled?: boolean; ns_set?: number } | null;
  /** Pay-per-Crawl configuration — `{enabled, price_usd_microcents,
   *  bot_overrides}`. Per-zone monetization toggle for AI crawler
   *  tolls. Created via POST (singleton). */
  payPerCrawlConfiguration?: { enabled?: boolean; price_usd_microcents?: number; bot_overrides?: Record<string, unknown> } | null;
  /** Per-room Waiting Room override rules — each room has its own
   *  list of `{action, expression, description?, enabled?}` rules
   *  that selectively bypass / queue. Migrates per-room with the
   *  full-replace PUT after the parent room is created on the dest. */
  waitingRoomRules?: { roomName: string; rules: { id?: string; action: string; expression: string; description?: string; enabled?: boolean }[] }[];
  /** AI Gateway Custom Provider Costs — per-provider cost config
   *  (e.g. $/1k tokens). Migrates as a list (account-scoped POST). */
  aiGatewayCustomProviderCosts?: { id?: string; name?: string; provider?: string; model?: string; per_token_cost?: number; per_image_cost?: number; per_audio_cost?: number; per_video_cost?: number; per_request_cost?: number; per_search_cost?: number; per_cached_token_cost?: number; per_output_token_cost?: number }[];
  /** AI Gateway per-gateway Provider Configs — BYOK bindings between a
   *  gateway, a provider, and a Secrets Store secret. The raw `secret`
   *  is write-only (never exported) and `secret_id` references a
   *  source-account secret, so these are acknowledged at migrate time
   *  rather than re-created. Exported for disclosure/reporting only. */
  aiGatewayProviderConfigs?: { gatewayId: string; configs: { id?: string; alias?: string; default_config?: boolean; provider_slug?: string; secret_id?: string; secret_preview?: string; rate_limit?: number; rate_limit_period?: number }[] }[];
  // Account-scoped sub-resources
  accessGroups?: { id?: string; name: string; include?: unknown[]; exclude?: unknown[]; require?: unknown[] }[];
  accessServiceTokens?: { id?: string; name: string; duration?: string }[];   // client_secret intentionally excluded
  /** Access IdPs. `config` is captured with PRIVATE secret-like
   * fields (client_secret, private_key) stripped — see
   * SECRET_LIKE_CONFIG_FIELDS in src/migrate/export-zone.ts. The
   * remaining fields (auth_url, token_url, certs_url, client_id,
   * scopes, idp_public_certs, sso_target_url, issuer_url, etc.) are
   * required at apply time so the dest IdP can be recreated.
   *
   * For OAuth-family IdPs (oidc, okta, azureAD, etc.) the user
   * supplies the missing client_secret via the Step 2 inline fix-it
   * form.
   *
   * SAML IdPs auto-migrate from `config` alone because SAML's trust
   * model is cert-based — the captured `idp_public_certs` is public
   * X.509 material the customer hands out to every relying party.
   *
   * Older export files without `config` fall back to the
   * acknowledgment-only path. */
  identityProviders?: { id?: string; name: string; type: string; config?: Record<string, unknown> }[];
  // D4: Access sub-resources used by Access apps for branding, organisation,
  // and the user-facing dashboard. Tags + bookmarks migrate programmatically.
  // Custom pages migrate including their HTML (which is exportable from
  // /accounts/{id}/access/custom_pages/{uid}). gateway_ca is observable but
  // not migratable — the dest account auto-generates its own CA.
  accessTags?: { name: string }[];
  accessBookmarks?: { id?: string; name?: string; domain?: string; app_launcher_visible?: boolean; logo_url?: string }[];
  accessCustomPages?: { uid?: string; name: string; type: 'identity_denied' | 'forbidden'; custom_html: string }[];
  customLists?: { id?: string; name: string; kind: string; description?: string }[];
  customListItems?: Record<string, unknown[]>;                                 // keyed by list name
  queueConsumers?: Record<string, { script_name: string; environment?: string; settings?: unknown }[]>;  // keyed by queue name
  // Account-level custom rulesets referenced by the zone's rulesets (via
  // `action=execute, action_parameters.id=<account_ruleset_id>`) OR by an
  // account-level phase entrypoint (kind=root) — the canonical CF API path
  // for deploying a custom account ruleset to apply across the account's
  // zones. Only the subset actually referenced is exported (not the whole
  // account inventory). Migration recreates these on the destination
  // account and remaps the execute references both in the zone's rules
  // AND in the dest account's phase entrypoint (see
  // `accountPhaseEntrypointReferences` below).
  accountRulesets?: CFRuleset[];
  // IDs that this zone's rulesets OR the source account's phase entrypoints
  // reference via execute actions, captured at export time so migration can
  // detect "referenced but not exportable" cases (e.g. account read
  // permission missing).
  referencedAccountRulesetIds?: string[];
  // Account-level phase entrypoint rules that execute custom account
  // rulesets. Captured at export time so migration can replay them on the
  // dest account's phase entrypoints (with the source ruleset IDs remapped
  // to the new dest IDs).
  //
  // Each entry is `{ phase, sourceRuleId?, expression, description?, enabled, sourceTargetId }`
  // where sourceTargetId is the source-account ruleset ID being executed.
  accountPhaseEntrypointReferences?: Array<{
    phase: string;
    expression: string;
    description?: string;
    enabled?: boolean;
    sourceTargetId: string;
  }>;
  // Account-scoped Logpush jobs whose filter references this zone ID.
  // The job runs on the destination account but the destination_conf
  // (S3 access keys, Splunk tokens, Datadog API keys, etc.) is opaque —
  // the user must rotate any embedded credentials post-migration.
  accountLogpushJobs?: Array<{
    id?: number;
    dataset?: string;
    destination_conf: string;
    enabled?: boolean;
    filter?: string;
    frequency?: string;
    kind?: string;
    logpull_options?: string;
    max_upload_bytes?: number;
    max_upload_interval_seconds?: number;
    max_upload_records?: number;
    name?: string;
    output_options?: unknown;
  }>;
  // Notification policies filtered to this zone (filters.zones[] contains
  // the source zone ID). Migration remaps the zone ID to the dest zone's
  // ID and recreates the destinations + policies on the dest account.
  // Webhook secret tokens are write-only and surface as acknowledgments.
  notificationPolicies?: Array<{
    id?: string;
    name: string;
    description?: string;
    alert_type: string;
    enabled: boolean;
    mechanisms: {
      email?: { id: string }[];
      webhooks?: { id: string }[];
      pagerduty?: { id: string }[];
    };
    filters?: Record<string, unknown>;
    conditions?: Record<string, unknown>;
    alert_interval?: string;
  }>;
  // Webhook destinations referenced by the migrated notification policies.
  // Secrets are intentionally omitted (write-only).
  notificationWebhooks?: Array<{
    id?: string;
    name: string;
    type: string;
    url: string;
  }>;
  // PagerDuty destinations — name only; the OAuth token is account-bound
  // and is not migrated automatically (acknowledged separately).
  notificationPagerDuty?: Array<{ id?: string; name: string }>;
  // ── R2 bucket sub-configurations ─────────────────────────────────
  // Per-bucket CORS rules, lifecycle rules, and managed-domain settings.
  // Indexed by bucket name (keys must match an entry in `r2Buckets`).
  // Migration applies these AFTER the bucket itself is created.
  r2BucketConfigs?: CFR2BucketConfig[];
  // ── Pages projects (account-scoped) ──────────────────────────────
  // Cloudflare Pages projects with their build config + env vars +
  // deployment_configs. Deployment bundles (static assets) are NOT
  // migratable via API — the user must redeploy via `wrangler pages
  // deploy` post-migration (acknowledged via `pages_deployment_data`).
  pagesProjects?: CFPagesProject[];
  // ── AI Gateway (account-scoped) ─────────────────────────────────
  // AI Gateway configurations + custom providers. Usage logs/analytics
  // are NOT migratable (data_ephemeral). Custom provider API keys are
  // NOT migratable (cryptographic — user must re-supply post-migration).
  aiGateways?: CFAiGateway[];
  aiGatewayCustomProviders?: CFAiGatewayCustomProvider[];
  // ── Origin CA certificates ──────────────────────────────────────
  // List of Origin CA certs issued for this zone. Certificate body IS
  // exportable; private keys are NOT (generated client-side, never
  // stored by CF). UI prompts for re-upload OR regenerate in Step 3.
  originCaCertificates?: CFOriginCaCertificate[];
}

// Bot Management export (covers BFM, SBFM, and Enterprise Bot Management)
export interface BotManagementExport {
  fight_mode?: boolean;
  sbfm_definitely_automated?: string;
  sbfm_likely_automated?: string;
  sbfm_verified_bots?: string;
  sbfm_static_resource_protection?: boolean;
  enable_js?: boolean;
  suppress_session_score?: boolean;
  optimize_wordpress?: boolean;
  using_latest_model?: boolean;
  auto_update_model?: boolean;
  ai_bots_protection?: string;
}

// Cloudflare API Types
export interface CFZone {
  id: string;
  name: string;
  account: { id: string; name: string };
  name_servers: string[];
  status: string;
  plan: { id: string; name: string };
}

export interface CFDNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  comment?: string;
  tags?: string[];
  settings?: Record<string, unknown>;
}

export interface CFZoneSetting {
  id: string;
  value: unknown;
  editable: boolean;
}

export interface CFPageRule {
  id: string;
  targets: { target: string; constraint: { operator: string; value: string } }[];
  actions: { id: string; value?: unknown }[];
  priority: number;
  status: string;
}

export interface CFRuleset {
  id: string;
  name: string;
  description: string;
  kind: string;
  phase: string;
  rules: CFRulesetRule[];
}

export interface CFRulesetRule {
  id?: string;
  action: string;
  action_parameters?: Record<string, unknown>;
  expression: string;
  description?: string;
  enabled?: boolean;
  ratelimit?: {
    characteristics?: string[];
    requests_per_period?: number;
    period?: number;
    mitigation_timeout?: number;
    counting_expression?: string;
  };
}

export interface CFWorkerScript {
  id: string;
  etag: string;
  handlers: string[];
  modified_on: string;
  script?: string;
  bindings?: CFWorkerBinding[];
  /** Cloudflare script format: legacy Service Worker vs Modules (ESM). */
  script_format?: CFWorkerScriptFormat;
  /** For Modules workers, the entrypoint module file name (e.g. "worker.js"). */
  main_module?: string;
  /** For Modules workers, map of module file name -> text content (text/js only). */
  modules?: Record<string, string>;
}

export type CFWorkerScriptFormat = 'service_worker' | 'modules';

export interface CFWorkerBinding {
  name: string;
  type: string;
  text?: string;
  namespace_id?: string;
  bucket_name?: string;
  database_id?: string;
  database_name?: string;
  service?: string;
  environment?: string;
  // Durable Object binding properties
  class_name?: string;
  script_name?: string;
  // Queue binding properties
  queue_name?: string;
  // Hyperdrive binding
  id?: string;
  // Vectorize binding
  index_name?: string;
  // mTLS certificate binding
  certificate_id?: string;
  // Analytics Engine binding
  dataset?: string;
  // Pipeline binding
  pipeline?: string;
  // Dispatch Namespace (Workers for Platforms)
  namespace?: string;
  // Workflow binding
  workflow_name?: string;
  // Secrets Store binding
  store_id?: string;
  secret_name?: string;
  // VPC Service binding
  service_id?: string;
  // Send Email binding
  destination_address?: string;
  // Rate Limit binding inline config
  simple?: Record<string, unknown>;
  // Service binding entrypoint (RPC)
  entrypoint?: string;
}

export interface CFWorkerRoute {
  id: string;
  pattern: string;
  script: string;
}

export interface CFWorkerCustomDomain {
  id: string;
  zone_id: string;
  zone_name: string;
  hostname: string;
  service: string;
  environment: string;
}

export interface CFLoadBalancer {
  id: string;
  name: string;
  description: string;
  default_pools: string[];
  fallback_pool: string;
  /** Geo-steering: PoP code → ordered pool IDs. Pool IDs are account-specific
   * and MUST be remapped on migration (see migrateLoadBalancers). */
  pop_pools?: Record<string, string[]>;
  /** Geo-steering: region code → ordered pool IDs. Same remap requirement as
   * pop_pools. */
  region_pools?: Record<string, string[]>;
  proxied: boolean;
  ttl: number;
  steering_policy: string;
  session_affinity: string;
  session_affinity_ttl: number;
  rules?: CFLBRule[];
}

export interface CFLBRule {
  name: string;
  condition: string;
  disabled: boolean;
  fixed_response?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  priority: number;
  terminates: boolean;
}

export interface CFPool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  origins: CFOrigin[];
  monitor: string;
  notification_email: string;
  minimum_origins: number;
}

export interface CFOrigin {
  name: string;
  address: string;
  enabled: boolean;
  weight: number;
  header?: Record<string, string[]>;
}

export interface CFMonitor {
  id: string;
  description: string;
  type: string;
  method: string;
  path: string;
  port: number;
  timeout: number;
  retries: number;
  interval: number;
  expected_codes: string;
  expected_body: string;
  follow_redirects: boolean;
  allow_insecure: boolean;
  header?: Record<string, string[]>;
}

export interface CFSpectrumApp {
  id: string;
  protocol: string;
  dns: { type: string; name: string };
  origin_dns: { name: string };
  origin_port: number;
  tls: string;
  proxy_protocol: string;
  ip_firewall: boolean;
  edge_ips: { type: string; connectivity: string };
}

export interface CFCustomCertificate {
  id: string;
  hosts: string[];
  issuer: string;
  signature: string;
  status: string;
  bundle_method: string;
  expires_on: string;
}

export interface CFCustomHostname {
  id: string;
  hostname: string;
  ssl: {
    method: string;
    type: string;
    status: string;
    settings: Record<string, unknown>;
  };
  custom_origin_server?: string;
}

// A single entry in an Access app's `destinations[]` array. The array is a
// union of three shapes keyed by `type`:
//   • public  — { type: "public", uri }            (hostname + path, wildcards ok)
//   • private — { type: "private", cidr?, hostname?, l4_protocol?, port_range?, vnet_id? }
//   • via_mcp_server_portal — { type, mcp_server_id }
// `destinations` supersedes `self_hosted_domains`; when both are sent the API
// ignores `self_hosted_domains`. Only `uri` (public) and `hostname` (private)
// reference a zone hostname and get source→dest zone-rewritten on migrate;
// `cidr`/`vnet_id`/`mcp_server_id` are network/account identifiers left as-is.
export interface CFAccessDestination {
  type?: string;
  uri?: string;
  hostname?: string;
  cidr?: string;
  l4_protocol?: string;
  port_range?: string;
  vnet_id?: string;
  mcp_server_id?: string;
}

export interface CFAccessApp {
  id: string;
  name: string;
  domain: string;
  type: string;
  session_duration: string;
  allowed_idps: string[];
  auto_redirect_to_identity: boolean;
  // Modern self-hosted apps route via these arrays instead of the single
  // legacy `domain`. `self_hosted_domains` is an array of public hostnames
  // (deprecated in favor of `destinations`); `destinations` is the richer
  // replacement. An app relying on either must have them migrated or it
  // loses its routing on the destination.
  self_hosted_domains?: string[];
  destinations?: CFAccessDestination[];
}

export interface CFAccessPolicy {
  id: string;
  name: string;
  decision: string;
  include: Record<string, unknown>[];
  exclude: Record<string, unknown>[];
  require: Record<string, unknown>[];
  precedence: number;
}

export interface CFFirewallRule {
  id: string;
  paused: boolean;
  description: string;
  action: string;
  priority?: number;
  /** Required by the CF API when `action` is `bypass`: the list of products to
   *  bypass (e.g. "waf", "rateLimit", "uaBlock", "bic", "hot", "securityLevel",
   *  "zoneLockdown"). Dropping it makes the create call fail with
   *  "products must be specified for the 'bypass' action". */
  products?: string[];
  filter: { id?: string; expression: string; paused: boolean };
}

export interface CFRateLimit {
  id: string;
  disabled: boolean;
  description: string;
  match: {
    request: { methods: string[]; schemes: string[]; url: string };
    response?: { origin_traffic: boolean; headers: Record<string, unknown>[] };
  };
  threshold: number;
  period: number;
  action: { mode: string; timeout?: number; response?: Record<string, unknown> };
}

export interface CFEmailRoutingRule {
  id: string;
  tag: string;
  name: string;
  priority: number;
  enabled: boolean;
  matchers: { type: string; field?: string; value?: string }[];
  actions: { type: string; value: string[] }[];
}

export interface CFEmailRoutingAddress {
  id: string;
  tag: string;
  email: string;
  verified: string;
  created: string;
  modified: string;
}

export interface CFWaitingRoom {
  id: string;
  name: string;
  description: string;
  host: string;
  path: string;
  queue_all: boolean;
  disable_session_renewal: boolean;
  suspended: boolean;
  json_response_enabled: boolean;
  new_users_per_minute: number;
  total_active_users: number;
  session_duration: number;
  custom_page_html?: string;
  default_template_language: string;
  cookie_suffix?: string;
  additional_routes?: { host: string; path: string }[];
  cookie_attributes?: { samesite: string; secure: string };
  enabled_origin_commands?: string[];
}

export interface CFZarazConfig {
  tools: Record<string, {
    enabled: boolean;
    name: string;
    type: string;
    settings: Record<string, unknown>;
    actions: Record<string, unknown>[];
  }>;
  triggers: Record<string, {
    name: string;
    rules: Record<string, unknown>[];
    excludeRules: Record<string, unknown>[];
  }>;
  variables: Record<string, {
    name: string;
    type: string;
    value: unknown;
  }>;
  consent?: {
    enabled: boolean;
    purposes: Record<string, unknown>;
  };
  settings?: Record<string, unknown>;
}

export interface CFTurnstileWidget {
  sitekey: string;
  secret?: string;
  name: string;
  domains: string[];
  mode: string;
  region: string;
  bot_fight_mode: boolean;
  offlabel: boolean;
  created_on: string;
  modified_on: string;
}

// Storage Resources (Account-level)
export interface CFKVNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

export interface CFKVKey {
  name: string;
  expiration?: number;
  metadata?: Record<string, unknown>;
}

export interface CFR2Bucket {
  name: string;
  creation_date: string;
  location?: string;
}

export interface CFD1Database {
  uuid: string;
  name: string;
  version: string;
  num_tables?: number;
  file_size?: number;
  created_at: string;
}

export interface CFQueue {
  queue_id: string;
  queue_name: string;
  created_on: string;
  modified_on: string;
  producers_total_count?: number;
  consumers_total_count?: number;
}

export interface CFDurableObjectNamespace {
  id: string;
  name: string;
  script?: string;
  class?: string;
}

// ── R2 bucket sub-configurations ────────────────────────────────────────
//
// Cloudflare exposes three distinct config surfaces for an R2 bucket
// beyond the bucket itself:
//
//   1. CORS rules — `/accounts/{id}/r2/buckets/{name}/cors`
//   2. Object lifecycle rules — `/accounts/{id}/r2/buckets/{name}/lifecycle`
//   3. Managed domain (public access via r2.dev) —
//      `/accounts/{id}/r2/buckets/{name}/domains/managed`
//
// All three are migratable across accounts and are NOT covered by the
// basic bucket POST. We export and re-apply them per-bucket alongside
// the bucket creation step.

/** R2 bucket CORS rule. Cloudflare's CORS API matches the AWS S3 spec
 * shape. Multiple rules can apply per bucket. */
export interface CFR2CorsRule {
  /** Comma-separated list of allowed origins, or `["*"]` for any. */
  allowed: {
    origins: string[];
    methods: ('GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD')[];
    headers?: string[];
  };
  exposeHeaders?: string[];
  /** Max age in seconds for preflight cache. */
  maxAgeSeconds?: number;
}

/** R2 object lifecycle rule. Cloudflare R2 supports `expire` and
 * `abortMultipartUpload` conditions to age out old data automatically. */
export interface CFR2LifecycleRule {
  id: string;
  enabled: boolean;
  /** Filter — when matched, the rule's conditions apply. */
  conditions?: {
    prefix?: string;
  };
  /** Delete objects after N days OR at an absolute date. */
  deleteObjectsTransition?: {
    condition?: { type: 'Age'; maxAge: number } | { type: 'Date'; date: string };
  };
  /** Abort multipart uploads that haven't completed after N days. */
  abortMultipartUploadsTransition?: {
    condition?: { type: 'Age'; maxAge: number };
  };
  /** Move objects to infrequent-access storage class after N days. */
  storageClassTransitions?: Array<{
    condition: { type: 'Age'; maxAge: number };
    storageClass: 'InfrequentAccess';
  }>;
}

/** R2 managed (r2.dev) domain config. Each bucket can expose itself
 * via a Cloudflare-managed public URL (off by default for cost/security). */
export interface CFR2ManagedDomain {
  bucketId?: string;
  domain?: string;
  enabled: boolean;
}

/** Aggregated R2 bucket configuration that travels with the bucket
 * during export. The bucket itself migrates via name; this carries the
 * settings that need to be re-applied after bucket creation. */
export interface CFR2BucketConfig {
  bucketName: string;
  cors?: CFR2CorsRule[];
  lifecycle?: CFR2LifecycleRule[];
  managedDomain?: CFR2ManagedDomain;
  /** Custom domains attached to the bucket (r2.dev replacement). The TLS
   *  cert is provisioned by Cloudflare; the domain's zone must exist on the
   *  destination account for the connection to come up. */
  customDomains?: CFR2CustomDomain[];
  /** Object-lock (immutability) retention rules. */
  lock?: CFR2BucketLock | null;
}

/** A custom domain bound to an R2 bucket. */
export interface CFR2CustomDomain {
  domain: string;
  enabled?: boolean;
  /** zoneId/zoneName are informational (read-only on GET); the dest derives
   *  the zone from the domain at attach time. */
  zoneId?: string;
  zoneName?: string;
  minTLS?: string;
}

/** R2 object-lock configuration: a set of retention rules. The exact rule
 *  shape is passed through verbatim from the source GET to the dest PUT. */
export interface CFR2BucketLock {
  rules?: Record<string, unknown>[];
}

// ── Pages projects ──────────────────────────────────────────────────────
//
// Cloudflare Pages is account-scoped. Each project has metadata (name,
// build config, source repo), environment variables (production +
// preview), and a set of deployments. We migrate the project metadata +
// env vars; the actual deployment bundles must be re-deployed via
// `wrangler pages deploy` (acknowledged in IMPOSSIBLE_TO_MIGRATE under
// the `pages_deployment_data` key).

export interface CFPagesProjectDeploymentConfig {
  /** Environment variables — values may be secret (`type:'secret_text'`) or plain. */
  env_vars?: Record<string, { value?: string; type?: 'plain_text' | 'secret_text' }>;
  /** Compatibility date (e.g. "2024-09-01") */
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Record<string, { id: string }>;
  kv_namespaces?: Record<string, { namespace_id: string }>;
  r2_buckets?: Record<string, { name: string; jurisdiction?: string }>;
  durable_object_namespaces?: Record<string, { namespace_id: string }>;
  queue_producers?: Record<string, { name: string }>;
  services?: Record<string, { service: string; environment?: string }>;
  /** Build/runtime fail-open settings, placement, etc. */
  fail_open?: boolean;
  always_use_latest_compatibility_date?: boolean;
  placement?: { mode?: 'smart' };
}

export interface CFPagesProject {
  name: string;
  /** Domain at which the Pages site is served (e.g. `my-app.pages.dev`). */
  subdomain?: string;
  /** Canonical deployment's URL — read-only. */
  canonical_deployment?: { id: string; url: string } | null;
  production_branch?: string;
  /** Build settings (npm script, output dir, etc.) */
  build_config?: {
    build_command?: string;
    destination_dir?: string;
    root_dir?: string;
    web_analytics_tag?: string;
    web_analytics_token?: string;
  };
  /** Source repo (GitHub/GitLab) — informational; not migratable directly. */
  source?: {
    type?: 'github' | 'gitlab';
    config?: {
      owner?: string;
      repo_name?: string;
      production_branch?: string;
      pr_comments_enabled?: boolean;
      deployments_enabled?: boolean;
    };
  };
  /** Deployment configs split per environment. */
  deployment_configs?: {
    production?: CFPagesProjectDeploymentConfig;
    preview?: CFPagesProjectDeploymentConfig;
  };
  created_on?: string;
  /** Custom domains attached to this project (separate from the .pages.dev subdomain). */
  domains?: string[];
}

// ── AI Gateway ──────────────────────────────────────────────────────────
//
// Cloudflare AI Gateway is account-scoped. Each gateway routes requests
// to one or more AI providers with caching, rate limiting, and logging.
// We migrate gateway configs + custom providers; usage logs/analytics
// are not migratable (data_ephemeral).

export interface CFAiGateway {
  /** Gateway ID — URL slug (e.g. "my-gateway"). 64-char limit. */
  id: string;
  /** Cache TTL in seconds (0 = caching off). */
  cache_ttl?: number;
  /** Whether caching is invalidated on schema changes. */
  cache_invalidate_on_update?: boolean;
  /** Whether request logs are collected. */
  collect_logs?: boolean;
  /** Rate limiting config — null/undefined when off. */
  rate_limiting_interval?: number;
  rate_limiting_limit?: number;
  rate_limiting_technique?: 'fixed' | 'sliding';
  /** Whether authenticated-gateway tokens are required. */
  authentication?: boolean;
  /** Max number of logs to store for this gateway (min 10000), not a day count. */
  log_management?: number;
  log_management_strategy?: 'STOP_INSERTING' | 'DELETE_OLDEST';
  /** Whether logpush is enabled for this gateway. */
  logpush?: boolean;
  logpush_public_key?: string;
  created_at?: string;
  modified_at?: string;
}

/** AI Gateway custom provider — used to integrate with non-supported
 * AI services. Has a unique slug per-account. */
export interface CFAiGatewayCustomProvider {
  id?: string;
  name: string;
  /** URL-safe identifier (alphanumeric + hyphens). */
  slug: string;
  base_url: string;
  description?: string;
  enable?: boolean;
  beta?: boolean;
  /** Auto-generated SVG logo (base64). Read-only on POST. */
  logo?: string;
  link?: string | null;
  curl_example?: string | null;
  js_example?: string | null;
}

// ── Origin CA certificates ──────────────────────────────────────────────
//
// Origin CA certificates are Cloudflare-issued certs for origin servers.
// The certificate body IS exportable from the source account via the
// `/certificates` endpoint, but the private key is generated client-side
// and never stored by Cloudflare — so migration requires the user to
// either re-upload existing cert+key pairs OR regenerate. We export the
// list of certs from source so the UI can prompt for the corresponding
// private keys (or for the user to regenerate).

export interface CFOriginCaCertificate {
  id: string;
  certificate: string;
  hostnames: string[];
  /** `origin-rsa` or `origin-ecc`. */
  request_type: 'origin-rsa' | 'origin-ecc';
  requested_validity: number;
  expires_on: string;
  csr?: string;
  /** Read-only — set by Cloudflare on issuance. */
  zone_id?: string;
}

/** Input shape for re-uploading an Origin CA certificate with its
 * matching private key on the destination account. */
export interface OriginCaCertificateInput {
  hostnames: string[];
  csr: string;
  request_type: 'origin-rsa' | 'origin-ecc';
  requested_validity: number;
}

// ─────────────────────────────────────────────────────────────────────
// IMPOSSIBLE_TO_MIGRATE: Single source of truth for resources that
// CANNOT be migrated automatically between Cloudflare accounts.
//
// Every resource here MUST appear in the pre-migration acknowledgment
// flow before the migration starts. The Results page MUST NOT show
// any of these as "failed" — they should appear as "acknowledged".
//
// Categories:
//   - cryptographic   : secret material that cannot be exported
//   - account_tied    : resource is tied to an account/IP/contract
//   - auto_managed    : Cloudflare auto-provisions / auto-updates
//   - data_ephemeral  : data is buffered/cached and not exportable
//   - manual_external : requires action outside Cloudflare (e.g. registrar)
//   - data_offline    : data exists but requires CLI/external tool to move
//   - read_only       : exposed by API but server-side immutable
// ─────────────────────────────────────────────────────────────────────

export type ImpossibleCategory =
  | 'cryptographic'
  | 'account_tied'
  | 'auto_managed'
  | 'data_ephemeral'
  | 'manual_external'
  | 'data_offline'
  | 'read_only';

export interface ImpossibleResource {
  /** Stable identifier matching the resource in the UI/report */
  key: string;
  /** Human-readable name shown in acknowledgment UI */
  name: string;
  category: ImpossibleCategory;
  /** Why it can't migrate — shown to the user verbatim */
  reason: string;
  /** What the user needs to do post-migration (if anything) */
  manualAction?: string;
  /** Optional Cloudflare docs URL */
  docsUrl?: string;
}

export const IMPOSSIBLE_TO_MIGRATE: readonly ImpossibleResource[] = Object.freeze([
  // ── Cryptographic (write-only material) ─────────────────────────
  {
    key: 'worker_secrets',
    name: 'Worker Secrets',
    category: 'cryptographic',
    reason: 'Cloudflare exposes worker secrets via write-only API; values cannot be read from source.',
    manualAction: 'Provide secret values in Step 3 of the migration wizard, or run `wrangler secret put` on each worker.',
    docsUrl: 'https://developers.cloudflare.com/workers/configuration/secrets/',
  },
  {
    key: 'access_service_tokens',
    name: 'Access Service Tokens',
    category: 'cryptographic',
    reason: 'Client secret is shown only once at creation and is not readable afterwards.',
    manualAction: 'Recreate service tokens on the destination account and update API consumers.',
  },
  {
    key: 'turnstile_widget_secrets',
    name: 'Turnstile Widget Secret Keys',
    category: 'cryptographic',
    reason: 'Secret keys are bound to the sitekey; new sitekeys are generated on destination.',
    manualAction: 'Update site code with the new sitekey + secret key after migration.',
  },
  {
    key: 'custom_certificate_keys',
    name: 'Custom Certificate Private Keys',
    category: 'cryptographic',
    reason: 'Private keys for uploaded custom certificates are not exportable via the Cloudflare API.',
    manualAction: 'Re-upload certificates with their private keys at the destination using the same Step 3 flow.',
  },
  {
    key: 'origin_ca_keys',
    name: 'Origin CA Certificate Private Keys',
    category: 'cryptographic',
    reason: 'Origin CA private keys are generated by the requesting party and not stored by Cloudflare.',
    manualAction: 'Regenerate Origin CA certificates on the destination if needed.',
  },
  {
    key: 'keyless_ssl_keys',
    name: 'Keyless SSL Private Keys',
    category: 'cryptographic',
    reason: 'Keyless SSL keys live on customer-controlled key servers and are not migrated.',
    manualAction: 'Reconfigure key servers and re-register them with the destination account.',
  },
  {
    key: 'api_shield_token_validation_credentials',
    name: 'API Shield — Token Validation JWT Key Credentials',
    category: 'cryptographic',
    reason: 'JWT validation credentials (JWKS keys) are write-only verification/signing material. The token-validation CONFIG migrates (via POST /token_validation/config), but the API never returns the key bytes, so they cannot be migrated automatically.',
    manualAction: 'After migration, re-add each JWT key to the dest token-validation config via Account → API Shield → Token Validation, or PUT /zones/{}/token_validation/config/{}/credentials with the JWKS keys.',
    docsUrl: 'https://developers.cloudflare.com/api-shield/security/jwt-validation/',
  },

  // ── Account-tied resources ──────────────────────────────────────
  {
    key: 'domain_registrar',
    name: 'Cloudflare Registrar',
    category: 'account_tied',
    reason: 'Domain registration is tied to the source account.',
    manualAction: 'Transfer the domain registration through Cloudflare Registrar support if needed.',
  },
  {
    key: 'byoip_prefixes',
    name: 'Bring Your Own IP (BYOIP)',
    category: 'account_tied',
    reason: 'IP prefixes are bound to the source account via LoA and BGP attestation.',
    manualAction: 'Submit a new LoA for the destination account.',
  },
  {
    key: 'aegis_ips',
    name: 'Aegis Dedicated Ingress IPs',
    category: 'account_tied',
    reason: 'Aegis IPs are assigned per-account by Cloudflare.',
    manualAction: 'Contact your Cloudflare account team to provision Aegis IPs on the destination.',
  },
  {
    key: 'magic_transit',
    name: 'Magic Transit / Magic WAN / Magic Firewall',
    category: 'account_tied',
    reason: 'Magic products require dedicated network onboarding per account.',
    manualAction: 'Re-onboard with Cloudflare network engineering team on the destination.',
  },
  {
    key: 'china_network',
    name: 'China Network',
    category: 'account_tied',
    reason: 'China Network requires a separate agreement and onboarding per account.',
    manualAction: 'Apply for China Network access on the destination account.',
  },
  {
    key: 'fedramp_environment',
    name: 'Cloudflare for Government (FedRAMP)',
    category: 'account_tied',
    reason: 'FedRAMP environments are physically isolated and account-bound.',
    manualAction: 'Coordinate FedRAMP onboarding on the destination account separately.',
  },
  {
    key: 'cni_interconnect',
    name: 'Cloudflare Network Interconnect',
    category: 'account_tied',
    reason: 'CNI peering arrangements are tied to the source account.',
    manualAction: 'Establish a new interconnect on the destination account.',
  },

  // ── Auto-managed (no API to set) ────────────────────────────────
  {
    key: 'universal_ssl_pack',
    name: 'Universal SSL Certificate Pack',
    category: 'auto_managed',
    reason: 'Cloudflare provisions Universal SSL automatically when a zone is activated.',
  },
  {
    key: 'managed_rulesets_cloudflare',
    name: 'Cloudflare Managed Rulesets',
    category: 'auto_managed',
    reason: 'Managed Rulesets are configured by Cloudflare; only the override rules are migrated.',
  },
  {
    key: 'ddos_managed_rules',
    name: 'DDoS L3/L4/L7 Managed Rules',
    category: 'auto_managed',
    reason: 'DDoS managed rules are enabled by default on every zone; only customer overrides are migrated.',
  },
  {
    key: 'smart_tiered_caching',
    name: 'Smart Tiered Caching',
    category: 'auto_managed',
    reason: 'No dedicated API; auto-enabled when Tiered Caching is on.',
  },
  {
    key: 'ssl_recommender',
    name: 'SSL/TLS Recommender',
    category: 'auto_managed',
    reason: 'Advisory feature that runs automatically.',
  },
  {
    key: 'waf_attack_score',
    name: 'WAF Attack Score / ML Detection',
    category: 'auto_managed',
    reason: 'ML scoring is auto-enabled per plan tier; no migratable configuration.',
  },
  {
    key: 'backup_certificates',
    name: 'Backup Certificates',
    category: 'auto_managed',
    reason: 'Auto-provisioned by Cloudflare and not exportable.',
  },

  // ── Read-only (settings exposed but immutable) ──────────────────
  {
    key: 'cname_flattening_setting',
    name: 'CNAME Flattening Setting',
    category: 'read_only',
    reason: 'Setting is read-only; automatic at apex on all plans, configurable only via Foundation DNS.',
  },
  {
    key: 'plan_level_setting',
    name: 'Plan Level Setting',
    category: 'read_only',
    reason: 'Read-only; plan is changed via subscription API, not the settings endpoint.',
  },
  {
    key: 'orange_to_orange',
    name: 'Orange-to-Orange Mode',
    category: 'read_only',
    reason: 'Read-only setting controlled by Cloudflare for partner zones.',
  },
  {
    key: 'advanced_ddos_setting',
    name: 'Advanced DDoS Setting',
    category: 'read_only',
    reason: 'Read-only on the settings endpoint; managed by entitlement.',
  },

  // ── Data ephemeral (data exists but is volatile/buffered) ────────
  {
    key: 'cached_content',
    name: 'Cached Content',
    category: 'data_ephemeral',
    reason: 'Cache is ephemeral and rebuilds on first hit after migration.',
  },
  {
    key: 'web_analytics_data',
    name: 'Web Analytics Historical Data',
    category: 'data_ephemeral',
    reason: 'Analytics data is account-scoped and not transferable.',
  },
  {
    key: 'security_events_history',
    name: 'Security Events History',
    category: 'data_ephemeral',
    reason: 'Security event log is retention-bound to the source account.',
  },
  {
    key: 'audit_logs',
    name: 'Audit Logs',
    category: 'data_ephemeral',
    reason: 'Audit logs are account-bound and not transferable.',
  },
  {
    key: 'queue_messages_in_flight',
    name: 'Queue Messages In-flight',
    category: 'data_ephemeral',
    reason: 'Messages awaiting delivery cannot be replayed on the destination.',
  },
  {
    key: 'kv_expiration_ttls',
    name: 'KV Key Expiration TTLs',
    category: 'data_ephemeral',
    reason: 'Per-key TTLs are preserved during data copy but absolute expiry timestamps reset.',
    manualAction: 'Repopulate any time-sensitive keys via your application code after migration.',
  },

  // ── Data offline (data exists but needs CLI/external tool) ───────
  {
    key: 'd1_schema_and_data',
    name: 'D1 Database Schema and Data',
    category: 'data_offline',
    reason: 'D1 schema and data must be exported via wrangler CLI and applied to the destination database.',
    manualAction: 'Run `wrangler d1 export <db>` on source and `wrangler d1 execute <db> --file=<sql>` on dest.',
    docsUrl: 'https://developers.cloudflare.com/d1/best-practices/import-export-data/',
  },
  {
    key: 'r2_object_data',
    name: 'R2 Object Data',
    category: 'data_offline',
    reason: 'Bulk R2 object data is best moved with rclone or the S3-compatible API; the tool only creates the bucket.',
    manualAction: 'Use rclone or `wrangler r2 object` commands to copy objects to the destination bucket.',
    docsUrl: 'https://developers.cloudflare.com/r2/data-migration/',
  },
  {
    key: 'logpush_buffer',
    name: 'Logpush Buffered Data',
    category: 'data_offline',
    reason: 'Buffered log batches in Logpush jobs are not transferable.',
  },
  {
    key: 'durable_object_state',
    name: 'Durable Object Stored State',
    category: 'data_offline',
    reason: 'The DO namespace (binding) is created on the destination when the worker deploys, but stored object state is NOT copied automatically. The tool can copy it when you configure object names + source/destination worker URLs in the Durable Objects scope group; otherwise the destination namespace starts empty.',
    manualAction: 'Configure DO migration in the Durable Objects scope group (object names + source/dest worker URLs), or copy state manually by exposing it via a fetch endpoint on each worker and replaying into the destination DO.',
    docsUrl: 'https://developers.cloudflare.com/durable-objects/api/storage-api/',
  },

  // ── Manual external (registrar / external service action) ────────
  {
    key: 'dnssec_ds_record',
    name: 'DNSSEC DS Record',
    category: 'manual_external',
    reason: 'The DS record must be updated at the domain registrar after the new DNSKEY is generated.',
    manualAction: 'Disable DNSSEC pre-migration. Post-migration, enable DNSSEC on dest and update the DS record at the registrar.',
  },
  {
    key: 'email_routing_destinations',
    name: 'Email Routing Destination Verifications',
    category: 'manual_external',
    reason: 'Each destination address must be verified by clicking a link in an email.',
    manualAction: 'Verify each destination address via the email link sent during migration.',
  },
  {
    key: 'nameserver_change',
    name: 'Nameserver Change at Registrar',
    category: 'manual_external',
    reason: 'Authoritative nameservers must be updated at the domain registrar after migration.',
    manualAction: 'Update nameservers at your registrar to the new Cloudflare nameservers shown in the report.',
  },
  {
    key: 'custom_hostname_validation',
    name: 'Custom Hostname SSL Validation',
    category: 'manual_external',
    reason: 'Each custom hostname requires DCV proof (HTTP token or TXT record).',
    manualAction: 'Re-validate custom hostnames on the destination zone (DCV tokens differ).',
  },
  {
    key: 'ssl_for_saas_validation',
    name: 'SSL for SaaS Verification',
    category: 'manual_external',
    reason: 'TLS-DNS / HTTP-01 challenges must be re-completed for each hostname.',
    manualAction: 'Re-issue and re-validate certificates for each SaaS hostname.',
  },

  // ── Additional cryptographic entries ─────────────────────────────
  {
    key: 'identity_provider_secrets',
    name: 'Access Identity Provider Secrets',
    category: 'cryptographic',
    reason: 'OAuth/SAML client_secret and certificates for IdPs are not exportable.',
    manualAction: 'Re-create each IdP on the destination account and re-paste the secret from your IdP\'s dashboard.',
  },
  {
    key: 'token_validation_private_keys',
    name: 'Token Validation Private Keys',
    category: 'cryptographic',
    reason: 'JWT validation keys returned via API are public; rotation requires re-uploading the source-of-truth.',
    manualAction: 'Re-upload signing keys to the destination if they\'ve been rotated since the export.',
  },
  {
    key: 'logpush_destination_credentials',
    name: 'Logpush Destination Credentials',
    category: 'cryptographic',
    reason: 'Destination configuration strings (S3 access keys, Splunk tokens, Datadog API keys, etc.) embedded in destination_conf must be rotated.',
    manualAction: 'After migration, edit each Logpush job\'s destination_conf to use destination-account credentials.',
  },
  {
    key: 'worker_observability_destination_tokens',
    name: 'Workers Observability Destination Tokens',
    category: 'cryptographic',
    reason: 'Destination tokens/secrets (Datadog API key, Splunk HEC token, R2/S3 access key, etc.) embedded in the destination\'s `config` are write-only — the API does not return them on GET. The destination is migrated; the auth credential must be re-supplied.',
    manualAction: 'After migration, edit each Workers Observability destination to re-supply its auth token. The destination name, type, and config shape are preserved.',
    docsUrl: 'https://developers.cloudflare.com/workers/observability/',
  },

  // ── Additional auto-managed entries ──────────────────────────────
  {
    key: 'dns_analytics_history',
    name: 'DNS Analytics Historical Data',
    category: 'data_ephemeral',
    reason: 'DNS query log retention is account-bound (6h Free, 24h Pro, 3d Biz, 7d Ent).',
  },
  {
    key: 'speed_test_results',
    name: 'Speed Test / Observatory Results',
    category: 'data_ephemeral',
    reason: 'Speed test runs are tied to the source zone and start fresh on destination.',
  },
  {
    key: 'rayid_logs',
    name: 'RayID Lookup Data',
    category: 'data_ephemeral',
    reason: 'Per-request log data is retention-bound to the source zone.',
  },

  // ── Additional read-only entries ─────────────────────────────────
  {
    key: 'available_plans_list',
    name: 'Available Plans / Rate Plans',
    category: 'read_only',
    reason: 'Available plans are an account-level catalog; the new zone gets the destination account\'s catalog.',
  },
  {
    key: 'zone_subscription_id',
    name: 'Zone Subscription ID',
    category: 'read_only',
    reason: 'Subscription IDs are billing-tied and regenerated when the destination zone subscribes.',
  },
  {
    key: 'zone_hold_status',
    name: 'Zone Hold',
    category: 'read_only',
    reason: 'Zone holds are account-level protections that don\'t copy to the destination.',
  },

  // ── Additional manual_external entries ───────────────────────────
  {
    key: 'custom_ns_registrar_glue',
    name: 'Custom Nameservers Registrar Glue',
    category: 'manual_external',
    reason: 'Custom nameservers require glue records at the registrar that must be updated separately.',
    manualAction: 'Update glue records at your registrar after Custom NS migration completes.',
  },
  {
    key: 'logpush_ownership_challenge',
    name: 'Logpush Ownership Challenge',
    category: 'manual_external',
    reason: 'Logpush requires writing a challenge token to the destination endpoint (S3 bucket, etc.) to prove ownership.',
    manualAction: 'Complete the ownership_challenge step for each Logpush job on the destination.',
  },
  {
    key: 'cert_pack_dcv',
    name: 'Advanced Certificate Pack DCV',
    category: 'manual_external',
    reason: 'Each advanced cert pack requires Domain Control Validation (DNS TXT or HTTP token).',
    manualAction: 'Complete DCV for each advanced certificate pack on the destination.',
  },

  // ── Additional account-tied entries ──────────────────────────────
  {
    key: 'logpush_jobs_dataset',
    name: 'Logpush Dataset Selection',
    category: 'account_tied',
    reason: 'Available datasets depend on the destination account\'s entitlements (Enterprise required).',
    manualAction: 'Verify dataset availability on the destination account before re-creating jobs.',
  },
  {
    key: 'access_certificates',
    name: 'Access mTLS Root Certificates',
    category: 'account_tied',
    reason: 'Trust roots are tied to the source account\'s Access tenant.',
    manualAction: 'Re-upload root certificates to the destination Access account.',
  },
  {
    key: 'workers_kv_metadata_index',
    name: 'KV Internal Index (per-key analytics)',
    category: 'account_tied',
    reason: 'KV internal per-key access counters are account-scoped and reset on the destination.',
  },

  // ── Zone-level out-of-scope (covered transitively by other resources) ─
  {
    key: 'custom_pages_branding',
    name: 'Custom Error Pages (1xxx) HTML',
    category: 'data_offline',
    reason: 'Cloudflare error page HTML is uploaded out-of-band via dashboard or API form-data and not in the standard export bundle.',
    manualAction: 'Upload custom 5xx/1xxx HTML pages via Cloudflare dashboard or `cf_branding` API after migration.',
  },
  {
    key: 'firewall_filters_legacy',
    name: 'Firewall Filters (legacy sub-resource)',
    category: 'auto_managed',
    reason: 'Filters are sub-resources of legacy firewall rules; created/destroyed transitively with the rules they belong to.',
  },
  {
    key: 'custom_hostname_aliases',
    name: 'Custom Hostname Aliases',
    category: 'auto_managed',
    reason: 'Per-hostname aliases are derived from custom_hostnames and migrate transitively with the parent resource.',
  },
  {
    key: 'leaked_credential_detection',
    name: 'Leaked Credential Detection — Auto Detections',
    category: 'auto_managed',
    reason: 'The default detection patterns shipped with the WAF managed ruleset are auto-managed by Cloudflare; nothing user-configurable in this part. User-supplied custom detections (additional username/password matchers for non-standard request bodies) are NOT auto-managed and DO migrate — see leakedCredentialCustomDetections on ZoneExport.',
  },
  // (Web3 Gateways used to live here as `manual_external`. Removed in the
  //  2026-05-26 Principle 7 audit: the hostname config — `{name, target,
  //  description?, dnslink?}` — is plain-data and migrates cleanly via
  //  `POST /zones/{}/web3/hostnames`; the IPFS Universal Path content
  //  block-list also migrates via `PUT .../content_list`. See
  //  `web3Hostnames` on ZoneExport.)
  {
    key: 'security_center_findings',
    name: 'Security Center Findings',
    category: 'data_ephemeral',
    reason: 'Security Center scan findings are derived continuously from destination traffic; nothing to migrate.',
  },
  {
    key: 'smart_shield_cache_reserve',
    name: 'Smart Shield Cache Reserve',
    category: 'account_tied',
    reason: 'Smart Shield is a paid add-on bundle; reconfiguration on destination requires the same entitlement.',
    manualAction: 'Subscribe to Smart Shield on the destination account if needed.',
  },
  // (Secondary DNS Incoming/Outgoing used to live here as
  //  `manual_external`. Removed in the 2026-05-26 Principle 7 audit:
  //  the "coordination with primary DNS provider" is a customer-side
  //  action, not a CF-side blocker — the CF-side config (peers, ACLs,
  //  per-zone incoming/outgoing settings) IS programmable and migrates
  //  cleanly with peer-ID remapping. TSIG SECRET MATERIAL remains
  //  cryptographic — see secondary_dns_tsig_secrets below.)
  {
    key: 'secondary_dns_tsig_secrets',
    name: 'Secondary DNS — TSIG Key Secrets',
    category: 'cryptographic',
    reason: 'TSIG key secret bytes are write-only at create time and never returned by the API on subsequent GETs. The KEY (name + algo) migrates structurally, but the SECRET must be re-supplied by the user.',
    manualAction: 'Provide TSIG secrets in Step 3 of the migration wizard (mirror of worker_secrets — UI integration pending), or re-paste them in the destination dashboard at Account → DNS → Secondary DNS → TSIG keys after migration completes. The TSIG key name is preserved so peer references re-link automatically once the secret is supplied.',
    docsUrl: 'https://developers.cloudflare.com/dns/zone-setups/zone-transfers/cloudflare-as-secondary/setup/',
  },

  // ── Worker binding types that reference source-account-specific resources ─
  // These bindings live inside migrated workers but the resource they point
  // to is account-scoped and cannot be auto-recreated. They surface as
  // acknowledgments in Step 2 instead of silent runtime failures on dest.
  {
    key: 'worker_binding_hyperdrive',
    name: 'Worker Hyperdrive Binding',
    category: 'account_tied',
    // Re-scoped in the 2026-05-26 audit: TZ now migrates Hyperdrive
    // configs themselves AND remaps Worker bindings via
    // hyperdriveIdMap when the user supplies origin credentials. This
    // entry now covers ONLY the fallback case — bindings whose source
    // Hyperdrive config did NOT migrate (no credentials supplied).
    // Those bindings fall through to a manual-reconfig warning.
    reason: 'Hyperdrive config IDs are bound to the source account. When the source config migrates (user supplied origin credentials), the binding is auto-remapped. When credentials are missing, the Worker binding still points at the source id — fix by creating the Hyperdrive config on the destination and updating the binding.',
    manualAction: 'Supply Hyperdrive origin credentials in Step 3 (see hyperdrive_origin_credentials) so the config migrates and the binding auto-remaps. Otherwise re-create the Hyperdrive config on the destination account and update the worker binding with the new ID.',
    docsUrl: 'https://developers.cloudflare.com/hyperdrive/',
  },
  {
    key: 'hyperdrive_origin_credentials',
    name: 'Hyperdrive — Origin Database Credentials',
    category: 'cryptographic',
    reason: 'The Hyperdrive origin password (and access_client_secret for Access-protected databases) is write-only at create time. The source API never returns these values; the user must re-supply them.',
    manualAction: 'Provide Hyperdrive origin credentials in Step 3 of the migration wizard (mirror of worker_secrets — UI integration pending), or after migration re-create each Hyperdrive config on the destination account with the correct password / access_client_secret. The config NAME is preserved, so once credentials are supplied, Worker bindings re-link automatically via the hyperdriveIdMap.',
    docsUrl: 'https://developers.cloudflare.com/hyperdrive/',
  },
  {
    key: 'worker_binding_secrets_store',
    name: 'Worker Secrets Store Binding',
    category: 'cryptographic',
    // Re-scoped in the 2026-05-26 audit: TZ now migrates Secrets Store
    // STORES themselves (just the {name}) and remaps Worker
    // secrets_store_secrets binding store_id via secretsStoreIdMap.
    // The secret VALUES inside each store remain write-only and don't
    // migrate — the user must re-add each secret on the dest dashboard.
    // This entry now covers the secret-value side specifically.
    reason: 'Secrets Store STORE metadata (the {name}) migrates and Worker binding store_id auto-remaps to the dest store. But the SECRET VALUES inside each store are write-only at create time — the source API never returns them, so they cannot be migrated automatically.',
    manualAction: 'After migration, open each Secrets Store on the destination account and re-add the secret values. The Worker binding\'s `secret_name` is preserved, so once you create a secret with that name in the remapped store, the binding works without further changes.',
    docsUrl: 'https://developers.cloudflare.com/secrets-store/',
  },
  {
    key: 'worker_binding_vpc_service',
    name: 'Worker VPC Service Binding',
    category: 'account_tied',
    reason: 'VPC peering is established per account; the dest account needs its own VPC service with the same peering relationship.',
    manualAction: 'Establish VPC peering on the destination account and update the worker binding with the new service ID.',
  },
  {
    key: 'worker_binding_dispatch_namespace',
    name: 'Worker for Platforms Dispatch Namespace',
    category: 'account_tied',
    reason: 'Workers for Platforms dispatch namespaces are per-account. Customer workers inside the namespace must be redeployed on the dest account.',
    manualAction: 'Recreate the dispatch namespace and re-upload customer workers on the destination account.',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/',
  },
  {
    key: 'worker_binding_workflow',
    name: 'Worker Workflow Binding',
    category: 'account_tied',
    reason: 'Workflow definitions live at /accounts/{id}/workflows and are not migrated by this tool.',
    manualAction: 'Re-create the Workflow on the destination account before the binding will resolve.',
    docsUrl: 'https://developers.cloudflare.com/workflows/',
  },
  {
    key: 'worker_binding_pipeline',
    name: 'Worker Pipeline Binding',
    category: 'account_tied',
    reason: 'Cloudflare Pipelines (R2 streaming ingestion) are per-account and not migrated by this tool.',
    manualAction: 'Create a Pipeline on the destination account and update the worker binding with the new ID.',
  },
  {
    key: 'worker_binding_browser',
    name: 'Worker Browser Rendering Binding',
    category: 'account_tied',
    reason: 'Browser Rendering requires a per-account entitlement. Workers with a `browser` binding will not run on accounts that lack the entitlement.',
    manualAction: 'Enable Browser Rendering on the destination account.',
    docsUrl: 'https://developers.cloudflare.com/browser-rendering/',
  },
  {
    key: 'worker_binding_ai',
    name: 'Worker Workers AI Binding',
    category: 'account_tied',
    reason: 'Workers AI requires a per-account entitlement. The binding resolves automatically once AI is enabled on the dest account.',
    manualAction: 'Verify Workers AI is enabled on the destination account; no per-binding configuration is required.',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/',
  },
  {
    key: 'worker_binding_mtls_certificate',
    name: 'Worker mTLS Certificate Binding',
    category: 'cryptographic',
    reason: 'Worker mTLS certificate bindings reference an account-uploaded cert + private key. Private keys are not exportable from the source account.',
    manualAction: 'Re-upload the mTLS certificate and private key on the destination account, then update the worker binding with the new certificate ID.',
  },
  {
    key: 'worker_binding_vectorize',
    name: 'Worker Vectorize Binding (Vector Data)',
    category: 'data_offline',
    reason: 'The Vectorize INDEX itself IS migrated (name, dimensions, metric — see Vectorize Indexes section). The vector DATA inside is not transferable via the standard migration flow — bulk-export and bulk-insert is a separate offline operation per index.',
    manualAction: 'After migration, dump source vectors via the Vectorize API and re-insert on the dest. See docs for `wrangler vectorize get-by-ids` and `insert`.',
    docsUrl: 'https://developers.cloudflare.com/vectorize/',
  },
  {
    key: 'worker_binding_analytics_engine',
    name: 'Worker Analytics Engine Binding',
    category: 'account_tied',
    reason: 'Analytics Engine datasets are per-account. The binding resolves automatically once Analytics Engine is enabled on the dest account; historical data does not transfer.',
    manualAction: 'Verify Analytics Engine is enabled on the destination account. Historical AE data stays in the source account.',
    docsUrl: 'https://developers.cloudflare.com/analytics/analytics-engine/',
  },
  {
    key: 'worker_binding_send_email',
    name: 'Worker Send Email Binding',
    category: 'manual_external',
    reason: 'Send Email bindings reference a `destination_address` that must be verified on the dest account before mail will be delivered.',
    manualAction: 'Verify the destination address on the destination account via the Email Routing verification flow.',
    docsUrl: 'https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/',
  },
  {
    key: 'worker_binding_assets',
    name: 'Worker Static Assets Binding',
    category: 'auto_managed',
    reason: 'Static Assets bundles are uploaded as part of the worker script multipart payload and are not separately migratable. The binding is re-created when the worker is uploaded on dest.',
  },

  // ── Authenticated Origin Pulls (AOP) mTLS bundles ───────────────
  {
    key: 'aop_mtls_certificate_bundle',
    name: 'Authenticated Origin Pulls mTLS Certificate Bundle',
    category: 'cryptographic',
    reason: 'AOP mTLS certificate bundles include private keys that are not exportable via the Cloudflare API. Only the zone-side hostname_associations are migrated; the underlying account-level certificate must be re-uploaded.',
    manualAction: 'Re-upload the AOP certificate + private key on the destination account at Dashboard → SSL/TLS → Origin Server → Authenticated Origin Pulls, then recreate the hostname associations on the zone.',
    docsUrl: 'https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/',
  },

  // ── Cloudflare Tunnel origins ───────────────────────────────────
  {
    key: 'tunnel_origin',
    name: 'Cloudflare Tunnel Origin',
    category: 'account_tied',
    reason: 'DNS records pointing at *.cfargotunnel.com depend on a Cloudflare Tunnel (cloudflared/cfd_tunnel) that lives on the source account. Tunnels cannot be moved between accounts and their tokens are write-only.',
    manualAction: 'Create a new tunnel on the destination account, install/run cloudflared with the new tunnel token, and update the affected DNS records to point at the new <tunnel-uuid>.cfargotunnel.com.',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
  },

  // ── Zero Trust Gateway dependencies (referenced by Access policies) ─
  {
    key: 'gateway_dependency',
    name: 'Zero Trust Gateway Dependency',
    category: 'account_tied',
    reason: 'Access policies may reference Gateway lists or rules in their require/include/exclude blocks. Gateway state (lists, rules, locations, proxy endpoints, certificates) is account-scoped and is not migrated by this tool.',
    manualAction: 'Recreate the referenced Gateway lists/rules on the destination account before the corresponding Access policies will evaluate correctly.',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-one/policies/gateway/',
  },

  // ── Account-level custom rulesets execution dependency ──────────
  // Note: when the source ruleset is exportable, T1.1 handles full
  // migration; this entry covers the residual case where the ruleset is
  // referenced by execute but cannot be fetched (read perms missing, etc.).
  {
    key: 'account_custom_ruleset_unmapped',
    name: 'Account Custom Ruleset (unmapped reference)',
    category: 'account_tied',
    reason: 'A zone rule references an account-level custom ruleset that could not be exported from the source account (read permission missing, deleted, or fetch failed). The migrated rule will reference the original ID and no-op on the destination.',
    manualAction: 'Recreate the referenced account ruleset on the destination account and update the migrated rule\'s execute target ID to match.',
  },

  // ── Notification webhook secrets ────────────────────────────────
  // Notification *policies* are now migrated programmatically (zone IDs
  // remapped, webhook destinations recreated), but the per-webhook
  // signing secret is write-only and cannot be exported. The migrated
  // webhooks deliver without authentication until the user re-pastes
  // the secret on dest.
  {
    key: 'notification_webhook_secret',
    name: 'Notification Webhook Secret',
    category: 'cryptographic',
    reason: 'Webhook signing secrets at /accounts/{id}/alerting/v3/destinations/webhooks are write-only. The webhook destination is recreated on dest with the same name/URL/type but without the secret.',
    manualAction: 'Re-paste each webhook secret on the destination account at Dashboard → Notifications → Destinations → Webhooks.',
    docsUrl: 'https://developers.cloudflare.com/notifications/get-started/configure-webhooks/',
  },
  {
    key: 'notification_pagerduty_oauth',
    name: 'Notification PagerDuty OAuth Token',
    category: 'account_tied',
    reason: 'PagerDuty integration tokens are bound to the source account via OAuth. The destination must reconnect PagerDuty separately before policies that route to PagerDuty will deliver.',
    manualAction: 'Reconnect PagerDuty on the destination account at Dashboard → Notifications → Destinations → PagerDuty.',
  },

  // ── Account-scoped Logpush destination credentials ──────────────
  // Account-scoped Logpush jobs are now migrated programmatically (filter
  // zone IDs are remapped, jobs recreated on dest). What can't be migrated
  // is the embedded destination credentials (S3 access keys, Splunk
  // tokens, Datadog API keys, etc.) baked into destination_conf — those
  // are typically source-account-bound and must be rotated.
  {
    key: 'account_logpush_destination_creds',
    name: 'Account Logpush Destination Credentials',
    category: 'cryptographic',
    reason: 'Account-scoped Logpush job destination_conf strings contain destination-specific credentials (S3 access keys, Splunk HEC tokens, Datadog API keys, etc.) that are typically tied to the source account or to a customer-managed external system that may need to be re-provisioned for the dest account.',
    manualAction: 'After migration, rotate or re-issue destination credentials for each migrated account-scoped Logpush job and update destination_conf accordingly. Complete ownership_challenge on dest if required.',
    docsUrl: 'https://developers.cloudflare.com/logs/logpush/',
  },

  // ── Account-level Custom Nameservers pool ───────────────────────
  {
    key: 'account_custom_ns_pool',
    name: 'Account Custom Nameservers Pool',
    category: 'account_tied',
    reason: 'Zone-level Custom Nameservers (CNS) assignments reference an `ns_set` defined at the account level (/accounts/{id}/custom_ns). The pool itself is per-account and must exist on the destination before the zone can be assigned to it.',
    manualAction: 'On the destination account, recreate the Custom Nameservers ns_set with the same set ID (or update the migrated zone to use the dest set ID), then update registrar glue records.',
    docsUrl: 'https://developers.cloudflare.com/dns/additional-options/custom-nameservers/',
  },

  // ── Access account-level sub-resources ──────────────────────────
  // tags, bookmarks, and custom_pages are now migrated programmatically
  // (HTML + metadata for custom_pages, names for tags/bookmarks). What
  // remains acknowledged: Gateway CA (auto-generated per account) and
  // binary assets referenced by Access Custom Pages.
  {
    key: 'access_custom_page_binary_assets',
    name: 'Access Custom Page Binary Assets',
    category: 'data_offline',
    reason: 'Access Custom Pages may embed binary assets (logos, images) uploaded out-of-band. Only HTML is migrated via API; the binary uploads themselves must be re-uploaded on dest.',
    manualAction: 'Re-upload any binary assets referenced by Access Custom Pages on the destination account.',
  },
  {
    key: 'access_gateway_ca',
    name: 'Access Gateway Certificate Authority',
    category: 'cryptographic',
    reason: 'The Gateway CA cert used to sign Access JWTs is generated per-account and is not exportable. Apps that pin the CA must re-fetch it from the destination tenant.',
    manualAction: 'Fetch the new Gateway CA from the destination account and update any consumers that pin the CA fingerprint.',
  },

  // ── Tier 4: bulk acknowledgments for zone-affecting account features ─
  // These are deliberately not migrated (out of scope, requires manual
  // coordination, or covered by separate Cloudflare admin workflows) but
  // still affect the zone's runtime behavior. Listing them here converts
  // potential silent failures into expected acknowledged outcomes.
  {
    key: 'dlp_dependency',
    name: 'DLP Profile Dependency',
    category: 'account_tied',
    reason: 'Data Loss Prevention profiles at /accounts/{id}/dlp/profiles are referenced by Gateway rules and (when API Shield content scanning is enabled) by zone-scoped policies. DLP profiles are not migrated by this tool.',
    manualAction: 'Recreate DLP profiles on the destination account before referencing rules will evaluate correctly.',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-one/policies/data-loss-prevention/',
  },
  {
    key: 'dns_firewall_origin',
    name: 'DNS Firewall Cluster Origin',
    category: 'account_tied',
    reason: 'DNS records that point at a DNS Firewall cluster origin (/accounts/{id}/dns_firewall) depend on a cluster on the source account that is not migrated.',
    manualAction: 'Create a new DNS Firewall cluster on the destination account and update the DNS records.',
    docsUrl: 'https://developers.cloudflare.com/dns/dns-firewall/',
  },
  {
    key: 'email_security_mx',
    name: 'Email Security (Area 1) MX Ingress',
    category: 'account_tied',
    reason: 'MX records pointing at Email Security (Area 1) ingress hostnames depend on a tenant configuration at /accounts/{id}/email-security that is not migrated by this tool.',
    manualAction: 'Configure Email Security on the destination account (or contact your Cloudflare account team) before MX records will deliver mail correctly.',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-one/email-security/',
  },
  {
    key: 'r2_catalog_dependency',
    name: 'R2 Catalog (Iceberg) Dependency',
    category: 'account_tied',
    reason: 'Workers that read from an R2 Catalog (Iceberg tables on R2) depend on catalog state at /accounts/{id}/r2-catalog that is not migrated by this tool.',
    manualAction: 'Recreate R2 Catalog state on the destination account and update worker references.',
    docsUrl: 'https://developers.cloudflare.com/r2/data-catalog/',
  },
  {
    key: 'ai_gateway_dependency',
    name: 'AI Gateway URL References in Worker Code',
    category: 'account_tied',
    reason: 'AI Gateway gateways and custom providers ARE migrated by this tool (config + rate limits + caching + log management settings). What is NOT migrated: gateway URLs hardcoded inside worker script source (e.g. `gateway.ai.cloudflare.com/v1/<SOURCE_ACCOUNT_ID>/<gateway_id>/...`) — these will continue pointing at the source account.',
    manualAction: 'Search worker code for `<SOURCE_ACCOUNT_ID>` URL fragments and replace with the dest account ID. Authentication tokens (cf-aig-authorization) must also be re-issued on the dest account.',
    docsUrl: 'https://developers.cloudflare.com/ai-gateway/',
  },
  {
    key: 'ai_search_dependency',
    name: 'AI Search Dependency',
    category: 'account_tied',
    reason: 'Workers that query AI Search instances depend on /accounts/{id}/ai-search state that is not migrated by this tool.',
    manualAction: 'Recreate AI Search instances on the destination account and update worker references.',
  },
  {
    key: 'pages_deployment_data',
    name: 'Pages Project Deployment Bundles',
    category: 'data_offline',
    reason: 'Cloudflare Pages project metadata + build config + env vars + deployment_configs ARE migrated by this tool. What is NOT migrated: the static asset bundles themselves (each deployment is a separate immutable upload). The dest project is created with the same name and settings but no live deployment.',
    manualAction: 'After migration, redeploy each Pages project. Git-backed projects: reconnect the source repo on the destination account (Dashboard → Workers & Pages → Create → Pages → Connect to Git) and trigger a deployment — Cloudflare rebuilds from source, reproducing assets AND Pages Functions. Direct-upload projects: run `wrangler pages deploy <dir> --project-name=<project>`. Per-project instructions (with repo/branch when git-backed) appear in the migration report.',
    docsUrl: 'https://developers.cloudflare.com/pages/configuration/api/',
  },
  {
    key: 'account_api_tokens',
    name: 'Account API Tokens (automation)',
    category: 'cryptographic',
    reason: 'API tokens at /accounts/{id}/tokens that automate this zone\'s configuration are bound to the source account and cannot be exported (tokens shown once at creation).',
    manualAction: 'Re-issue API tokens on the destination account with equivalent permissions and update any automation consumers.',
    docsUrl: 'https://developers.cloudflare.com/api/tokens/',
  },
  {
    key: 'account_members_iam',
    name: 'Account Members / IAM',
    category: 'account_tied',
    reason: 'Account members, roles, and IAM policies at /accounts/{id}/{members,roles,iam} are per-account and govern who can administer the zone. They are not migrated by this tool.',
    manualAction: 'Re-invite the relevant members to the destination account with appropriate roles before they can administer the migrated zone.',
  },
  {
    key: 'device_posture_dependency',
    name: 'Device Posture Dependency',
    category: 'account_tied',
    reason: 'Access policies that reference device posture checks (warp posture, gateway posture) depend on /accounts/{id}/devices/posture state that is not migrated.',
    manualAction: 'Recreate device posture rules on the destination account before posture-gated Access policies will evaluate correctly.',
  },
  {
    key: 'account_dns_views',
    name: 'Account DNS Views (Enterprise)',
    category: 'account_tied',
    reason: 'DNS Views (/accounts/{id}/dns_settings/views) scope zone DNS visibility by view. They are Enterprise-only and not migrated by this tool.',
    manualAction: 'Reconfigure DNS Views on the destination account if your zone\'s DNS visibility depends on them.',
  },
  {
    key: 'pages_event_subscriptions',
    name: 'Event Subscriptions / Event Notifications',
    category: 'account_tied',
    reason: 'Event subscriptions and R2 event notifications at /accounts/{id}/event_subscriptions deliver events to workers/queues based on per-account state and are not migrated.',
    manualAction: 'Recreate event subscriptions on the destination account.',
  },

  // ── AI Gateway custom provider authentication ───────────────────
  // Custom providers are migrated (name, slug, base_url) but the API
  // keys / authentication headers that each provider uses to talk to
  // its upstream service are write-only and not exportable.
  {
    key: 'ai_gateway_custom_provider_api_keys',
    name: 'AI Gateway Custom Provider API Keys',
    category: 'cryptographic',
    reason: 'API keys / authentication headers for AI Gateway custom providers are write-only at /accounts/{id}/ai-gateway/custom-providers/{slug}/auth. The provider config (name, slug, base_url) migrates but the auth must be re-supplied on the destination.',
    manualAction: 'After migration, re-add each custom provider\'s API key on the destination account at Dashboard → AI → AI Gateway → Custom Providers → Authentication.',
    docsUrl: 'https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/',
  },

  // ── R2 bucket sub-configurations ────────────────────────────────
  // R2 CORS rules + lifecycle rules + managed-domain settings ARE
  // migrated by this tool. The bucket's data is NOT (covered by
  // `r2_object_data` above).
  {
    key: 'r2_bucket_event_notifications',
    name: 'R2 Bucket Event Notifications',
    category: 'account_tied',
    reason: 'R2 event notification subscriptions (delivery to workers / queues / R2 catalog) are part of /accounts/{id}/event_subscriptions which is account-scoped and not migrated by this tool.',
    manualAction: 'After migration, re-create R2 event notification subscriptions on the destination account.',
    docsUrl: 'https://developers.cloudflare.com/r2/buckets/event-notifications/',
  },

  // ── Origin CA private keys (already covered by `origin_ca_keys` ─
  // — see top of catalog). The reupload UI in Step 3 lets the user
  // provide cert + private key pairs to re-issue on the destination.

  // ── New zone-level features (post-2026-02-14 OpenAPI snapshot) ──
  {
    key: 'ai_security_zone',
    name: 'AI Security (zone-scoped)',
    category: 'auto_managed',
    reason: 'AI Security at /zones/{id}/ai-security is a new Cloudflare product whose configuration shape is still evolving. The dest zone receives default AI Security settings; per-zone overrides are not migrated.',
    manualAction: 'Configure AI Security on the destination zone after migration if you had non-default settings.',
  },
  {
    key: 'workers_environments_zone',
    name: 'Worker Environments (zone-scoped)',
    category: 'account_tied',
    reason: 'Worker environment management at /zones/{id}/environments overlaps with the workers + worker_routes resources already migrated. The standalone environments endpoint exposes administrative state that is not part of the zone migration scope.',
  },
] as const);

/**
 * Look up an IMPOSSIBLE_TO_MIGRATE entry by key.
 * Returns null if the key is not in the catalog.
 */
export function getImpossibleResource(key: string): ImpossibleResource | null {
  return IMPOSSIBLE_TO_MIGRATE.find(r => r.key === key) ?? null;
}

// ── Source-zone analytics export (spike/analytics-export) ──────────────
//
// Shapes for the read-only analytics snapshot pulled from the SOURCE zone
// before decommissioning. Analytics history is data_ephemeral and cannot be
// migrated; this lets the user download an archive. Produced by
// src/analytics-export.ts, consumed by the Step 4 download button.

/** One GraphQL analytics dataset result (best-effort — error XOR rows). */
export interface AnalyticsDatasetResult {
  dataset: string;
  scope: 'zone';
  /** Number of groups returned (0 on error). */
  rowCount: number;
  /** Raw dataset payload (array of groups) when the query succeeded. */
  rows?: unknown;
  /** Present when the dataset could not be queried (entitlement/plan/permission). */
  error?: string;
  /** Present when the query returned data but with a soft GraphQL error. */
  warning?: string;
}

/** One REST analytics report result. */
export interface AnalyticsRestResult {
  endpoint: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Full analytics export bundle. Downloaded as JSON on Step 4. */
export interface AnalyticsExport {
  meta: {
    zoneId: string;
    zoneName?: string;
    accountId: string;
    generatedAt: string;
    window: { since: string; until: string; lookbackDays: number };
    toolVersion: string;
    note: string;
  };
  manifest: {
    /** Every analytics dataset the GraphQL Zone type exposes (introspected). */
    availableZoneDatasets: string[];
    /** Datasets this export actually queried. */
    pulledDatasets: string[];
    /** Available datasets NOT pulled by this exporter (transparency about gaps). */
    skippedDatasets: string[];
  };
  graphql: AnalyticsDatasetResult[];
  rest: AnalyticsRestResult[];
}

/** One dataset's accessibility from the Step 2 per-dataset access probe. */
export interface AnalyticsDatasetAvailability {
  name: string;
  accessible: boolean;
  /** The entitlement/plan/permission error when not accessible. */
  error?: string;
}

/** Output of probeZoneAnalytics (src/analytics-export.ts) — drives the Step 2
 *  "Archive source analytics" dataset list (only accessible datasets shown). */
export interface AnalyticsProbeResult {
  meta: { zoneId: string; accountId: string; generatedAt: string };
  /** Every zone analytics dataset the schema exposes, with accessibility. */
  datasets: AnalyticsDatasetAvailability[];
}

// ── Enterprise-gated zone settings ─────────────────────────────────────
//
// Zone settings that require an Enterprise plan to apply. When the source
// zone has one of these ENABLED but the destination zone lands on a
// non-Enterprise plan, the setting cannot be applied on the destination.
// The migrate engine already auto-acknowledges these at write time (the
// API returns "Not allowed to edit zone setting <id>", classified by
// isAcknowledgeableSingletonError — see src/migrate/errors.ts +
// test/errors.test.ts), so they surface as 🟡 acknowledged, never failed
// (Principle 1). Step 2 also surfaces them PROACTIVELY as an
// acknowledgment gate (Principle 2/3) so the user knows before migrating.
//
// SSOT note: this list MUST stay in sync with the `planRequired:
// 'enterprise'` entries in ZONE_SETTINGS (src/fuzz.ts). It is duplicated
// here (rather than imported from fuzz.ts) so the client bundle doesn't
// pull in the multi-thousand-line fuzz catalogue just to read 9 ids. A
// drift-guard test (test/fuzz.test.ts) fails if the two ever diverge.
export const ENTERPRISE_GATED_ZONE_SETTINGS: readonly string[] = [
  'ciphers',
  'origin_dns_name',
  'origin_error_page_pass_thru',
  'prefetch_preload',
  'proxy_read_timeout',
  'response_buffering',
  'sort_query_string_for_cache',
  'tls_client_auth',
  'true_client_ip_header',
] as const;
