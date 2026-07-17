/**
 * Out-of-scope acknowledgment detection.
 *
 * Reads the IMPOSSIBLE_TO_MIGRATE catalog from src/types.ts and detects
 * which entries actually apply to the user's source export. Returns the
 * subset that the user MUST acknowledge in Step 2 before migrating.
 *
 * Per AGENTS.md Principle 1 (No Surprise Failures): any resource that
 * can't migrate automatically MUST be surfaced to the user and explicitly
 * acknowledged. This module is the single place that decides "which
 * impossible-to-migrate items apply to THIS migration."
 *
 * Detection rules:
 *   - If a resource type exists in the export with content, surface the
 *     associated IMPOSSIBLE_TO_MIGRATE keys.
 *   - If a resource type doesn't exist on the source, skip the entry (no
 *     noise - the user isn't using that feature).
 *   - Always surface entries for global/manual_external actions like
 *     `nameserver_change` regardless of source content (every migration
 *     requires the NS change at registrar).
 */

import { IMPOSSIBLE_TO_MIGRATE, type ImpossibleCategory, type ImpossibleResource, type ZoneExport } from '../../src/types';

export interface ApplicableImpossibleResource extends ImpossibleResource {
  /** Optional count of affected items from the source export (e.g. "3 workers reference Hyperdrive"). */
  count?: number;
  /** Short label for the user - e.g. "your zone uses DNSSEC". */
  triggerReason?: string;
  /**
   * True when the user has agency over this resource (must re-supply
   * secrets, run wrangler/rclone, contact registrar, etc.) and therefore
   * MUST acknowledge it before "Continue to Migration".
   *
   * False when the resource is purely informational - Cloudflare
   * auto-provisions it, the setting is server-side immutable, or the
   * data is ephemeral by design. Informational items are disclosed in
   * the UI but never block the Continue button.
   *
   * Per AGENTS.md Principle 4: never ask the user to acknowledge
   * something they cannot change. The category-to-actionable mapping
   * lives in {@link ACTIONABLE_CATEGORIES} as the single source of
   * truth - adding a new ImpossibleCategory MUST update that set.
   */
  actionable: boolean;
  /**
   * Optional copy-to-clipboard CLI command snippets for items whose
   * "fix" is a known external command (wrangler / rclone / etc.).
   * When present, the panel
   * renders these snippets next to the acknowledge checkbox so the
   * user gets the exact command with source identifiers
   * interpolated, reducing user error. The ack checkbox still
   * gates Continue - these snippets are informational, NOT a fix.
   */
  cliCommands?: CliCommand[];
}

/**
 * One CLI command snippet for the copy-to-clipboard affordance.
 * `command` is the exact verbatim string the user should copy and
 * paste into a shell. `label` is a short title for the snippet
 * (e.g. "Export schema from source"). `note` is optional inline
 * guidance shown beneath the command.
 */
export interface CliCommand {
  label: string;
  command: string;
  note?: string;
}

/**
 * The set of IMPOSSIBLE_TO_MIGRATE categories where the user has real
 * agency - i.e. an explicit action they can take before, during, or
 * after migration to keep the destination zone working. Anything NOT
 * in this set is treated as informational (disclosure only, no
 * acknowledgment gate).
 *
 * Per AGENTS.md Principle 4.
 */
export const ACTIONABLE_CATEGORIES: ReadonlySet<ImpossibleCategory> = new Set<ImpossibleCategory>([
  'cryptographic',   // re-supply secrets / private keys
  'account_tied',    // re-provision on dest account / contact account team
  'data_offline',    // run wrangler / rclone / S3 export+import
  'manual_external', // registrar / email verification / external action
]);

/** Returns true when the user must acknowledge resources of this category. */
export function isActionableCategory(category: ImpossibleCategory): boolean {
  return ACTIONABLE_CATEGORIES.has(category);
}

/* ────────────────────────────────────────────────────────────────── */
/* Three-state resolution model                                       */
/*                                                                    */
/* For actionable items the user previously had a single binary       */
/* "acknowledged?" gate. With inline fix-it support, an item is now   */
/* in one of three states:                                            */
/*                                                                    */
/*   - 'fixed'        → user supplied all required values; the tool   */
/*                      will perform the action automatically.        */
/*   - 'acknowledged' → user explicitly chose to skip the fix and     */
/*                      accept the broken outcome.                    */
/*   - 'unresolved'   → default; blocks "Continue to Migration".      */
/*                                                                    */
/* Only three IMPOSSIBLE_TO_MIGRATE keys have an inline fix-it form   */
/* in bucket 1 (worker_secrets, custom_certificate_keys,              */
/* origin_ca_keys). For every other actionable item the function      */
/* degrades to the previous binary gate (acknowledged vs unresolved). */
/* This keeps the rule "ack-only items still need an explicit click"  */
/* without inventing a fix-it form that doesn't exist.                */
/* ────────────────────────────────────────────────────────────────── */

/** Shape of an Origin CA re-issuance input - kept structurally compatible
 * with `OriginCaCsrInput` in app/lib/types.ts. */
export interface OriginCaCsrLike {
  sourceId: string;
  hostnames: string[];
  csr: string;
  request_type: 'origin-rsa' | 'origin-ecc';
  requested_validity: number;
}

/** Source-cert shape needed for custom_certificate_keys derivation. */
export interface SourceCustomCertLike {
  hosts?: string[];
}

/** Source Origin CA cert shape needed for origin_ca_keys derivation. */
export interface SourceOriginCaCertLike {
  id: string;
  hostnames?: string[];
}

/** Source worker shape needed for worker_secrets derivation. */
export interface SourceWorkerLike {
  id?: string;
  name?: string;
  bindings?: Array<{ type?: string; name?: string }>;
}

/** Source notification webhook shape needed for notification_webhook_secret derivation. */
export interface SourceNotificationWebhookLike {
  id?: string;
  name: string;
  type?: string;
  url?: string;
}

/** Source IdP shape needed for identity_provider_secrets derivation
 * (bucket 2.2). Only `name` is required; type/config are passed
 * through for display. `onetimepin` IdPs are filtered out at fix-it
 * time because they don't accept user-supplied secrets. */
export interface SourceIdentityProviderLike {
  id?: string;
  name: string;
  type?: string;
}

/** Source AI Gateway custom provider shape (bucket 2.4). */
export interface SourceAiGatewayCustomProviderLike {
  slug: string;
  name?: string;
  base_url?: string;
}

/** Source AOP hostname-associations shape (bucket 2.3). Used to
 * tell the user which hostnames need an mTLS cert; the cert itself
 * is supplied by name in the user input. */
export interface SourceAopHostnameAssociationsLike {
  mtls_certificate_id?: string;
  hostnames?: string[];
}

/**
 * Bundle of inline-fix state needed to derive resolution status for
 * bucket-1 items. The shape mirrors what `App.tsx` already owns at the
 * wizard root (workerSecrets / certificates / originCaCsrs /
 * notificationWebhookSecrets).
 */
export interface FixItState {
  /** workerSecrets[workerName][secretName] = userSuppliedValue */
  workerSecrets: Record<string, Record<string, string>>;
  /** Parallel-indexed to source customCertificates; each slot needs both cert + key non-empty. */
  certificates: Array<{ cert: string; key: string }>;
  /** Origin CA CSR re-issuance inputs, keyed by sourceId to the source cert they replace. */
  originCaCsrs: OriginCaCsrLike[];
  /** Notification webhook signing secrets, keyed by source webhook name. */
  notificationWebhookSecrets?: Record<string, string>;
  /** Access IdP client_secret values, keyed by source IdP name.
   * Bucket 2.2. */
  identityProviderSecrets?: Record<string, string>;
  /** AOP mTLS cert+key bundles. Bucket 2.3. The user provides one
   * or more bundles; each is uploaded to the dest account at
   * migrate time. */
  aopMtlsBundles?: Array<{
    name: string;
    certificates: string;
    private_key: string;
    ca?: boolean;
  }>;
  /** AI Gateway custom-provider API keys, keyed by source provider
   * slug. Bucket 2.4. */
  aiGatewayProviderApiKeys?: Record<string, string>;
  /** Source rows from the export, used to count "how many fixes does this item need?" */
  sourceWorkers?: SourceWorkerLike[];
  sourceCustomCertificates?: SourceCustomCertLike[];
  sourceOriginCaCertificates?: SourceOriginCaCertLike[];
  sourceNotificationWebhooks?: SourceNotificationWebhookLike[];
  sourceIdentityProviders?: SourceIdentityProviderLike[];
  sourceAiGatewayCustomProviders?: SourceAiGatewayCustomProviderLike[];
  sourceAopHostnameAssociations?: SourceAopHostnameAssociationsLike | null;
}

/** The three-state resolution for an actionable IMPOSSIBLE_TO_MIGRATE item. */
export type ItemResolutionState = 'fixed' | 'acknowledged' | 'unresolved';

/** Set of IMPOSSIBLE_TO_MIGRATE keys that have an inline fix-it form.
 * Any key NOT in this set falls back to the binary ack-vs-unresolved
 * gate. Source of truth for the panel UI.
 *
 * Despite the name (kept stable for back-compat), this set now spans
 * bucket 1 + bucket 2.1 + bucket 2.2 + bucket 2.3 + bucket 2.4:
 *   - bucket 1: worker_secrets, custom_certificate_keys, origin_ca_keys
 *   - bucket 2.1: notification_webhook_secret
 *   - bucket 2.2: identity_provider_secrets
 *   - bucket 2.3: aop_mtls_certificate_bundle
 *   - bucket 2.4: ai_gateway_custom_provider_api_keys
 *
 * Future bucket-2 resource types should be added here as they ship. */
export const BUCKET_1_FIX_IT_KEYS: ReadonlySet<string> = new Set<string>([
  'worker_secrets',
  'custom_certificate_keys',
  'origin_ca_keys',
  'notification_webhook_secret',
  'identity_provider_secrets',
  'aop_mtls_certificate_bundle',
  'ai_gateway_custom_provider_api_keys',
]);

/** Returns true when there is an inline fix-it affordance for this key. */
export function hasInlineFixIt(key: string): boolean {
  return BUCKET_1_FIX_IT_KEYS.has(key);
}

/**
 * #19 two-phase split: which wizard phase an impossible-to-migrate resource
 * belongs to. The Account step (pre-zone `migrateAccountResources`) reviews and
 * gates ONLY account-phase items; the Zone step (`migrateZone`) reviews and
 * gates ONLY zone-phase items. This keeps each step's acknowledgments and
 * secret fix-it forms scoped to the resources that phase actually deploys, so
 * the user isn't blocked on (or shown) a zone-scoped secret while deploying
 * account resources (and vice-versa).
 *
 * Mapping rule (mirrors `groupPhase` in step2/groups.ts, incl. the Origin CA →
 * account override):
 *   - The explicit account set below → account (cryptographic secrets for
 *     account-scoped resources: workers, Access apps/IdPs/service tokens,
 *     AI Gateway, notifications, Turnstile, Origin CA).
 *   - Any `account_tied` entry (Registrar, BYOIP, Magic Transit, …) → account.
 *   - Everything else (zone-scoped certs/AOP, nameserver/DNSSEC/email manual
 *     actions, and all informational disclosures) → zone.
 */
const ACCOUNT_PHASE_IMPOSSIBLE_KEYS: ReadonlySet<string> = new Set<string>([
  'worker_secrets',
  'origin_ca_keys',
  'notification_webhook_secret',
  'identity_provider_secrets',
  'ai_gateway_custom_provider_api_keys',
  'ai_gateway_dependency',
  'access_service_tokens',
  'turnstile_widget_secrets',
]);

/** Wizard phase an impossible-to-migrate resource is reviewed/gated in. */
export function impossibleResourcePhase(
  r: { key: string; category: ImpossibleCategory },
): 'account' | 'zone' {
  if (ACCOUNT_PHASE_IMPOSSIBLE_KEYS.has(r.key)) return 'account';
  if (r.category === 'account_tied') return 'account';
  return 'zone';
}

/**
 * Actionable-but-no-fix-it keys that are already owned by a dedicated
 * in-wizard control, so they must NOT be duplicated in the
 * PostMigrationWorkPanel:
 *   - email_routing_destinations → the Step 2 EmailAddressVerificationCard
 *     handles verify/skip and gates Continue on its own. Listing it again as
 *     "post-migration work" would be both duplicative and contradictory
 *     (the card resolves it during Step 2, not after zone creation).
 */
const POST_MIGRATION_PANEL_EXCLUDED_KEYS: ReadonlySet<string> = new Set<string>([
  'email_routing_destinations',
]);

/**
 * True for actionable items the user performs THEMSELVES after the
 * destination zone/resources exist (no inline fix-it form), excluding any
 * item already owned by a dedicated in-wizard control. These populate the
 * PostMigrationWorkPanel — disclosure only; they never gate Continue.
 *
 * Single source of truth so Step 2 and Step 3 can't drift.
 */
export function isPostMigrationManualItem(r: ApplicableImpossibleResource): boolean {
  return r.actionable && !hasInlineFixIt(r.key) && !POST_MIGRATION_PANEL_EXCLUDED_KEYS.has(r.key);
}

/**
 * Per-item "is this resource fully supplied?" check. Returns true when
 * EVERY individual fix the item needs has been provided. Returning false
 * means the user has either provided nothing or provided only some.
 *
 * Always returns false for non-bucket-1 keys (there is no fix-it form
 * to derive "fixed" from). Acknowledgment is the only way for those.
 */
export function isItemFixed(key: string, fixState: FixItState): boolean {
  if (key === 'worker_secrets') {
    const workers = fixState.sourceWorkers ?? [];
    const secretsByWorker = workers
      .map(w => ({
        worker: w.id || w.name || '',
        secretNames: (w.bindings ?? [])
          .filter(b => b.type === 'secret_text' && typeof b.name === 'string')
          .map(b => b.name as string),
      }))
      .filter(w => w.secretNames.length > 0);
    if (secretsByWorker.length === 0) {
      // Item shouldn't have been surfaced if there are no secret_text bindings.
      // Treat as fixed (nothing to fix) rather than blocking forever.
      return true;
    }
    return secretsByWorker.every(w =>
      w.secretNames.every(name => {
        const value = fixState.workerSecrets[w.worker]?.[name];
        return typeof value === 'string' && value.length > 0;
      }),
    );
  }
  if (key === 'custom_certificate_keys') {
    const sources = fixState.sourceCustomCertificates ?? [];
    if (sources.length === 0) return true;
    return sources.every((_, i) => {
      const slot = fixState.certificates[i];
      return !!slot && slot.cert.length > 0 && slot.key.length > 0;
    });
  }
  if (key === 'origin_ca_keys') {
    const sources = fixState.sourceOriginCaCertificates ?? [];
    if (sources.length === 0) return true;
    return sources.every(src => {
      const match = fixState.originCaCsrs.find(c => c.sourceId === src.id);
      return (
        !!match &&
        match.csr.length > 0 &&
        match.hostnames.length > 0 &&
        match.requested_validity > 0
      );
    });
  }
  if (key === 'notification_webhook_secret') {
    // Bucket 2.1: each source webhook needs a non-empty user-supplied
    // signing secret. Keyed by webhook NAME (source and dest IDs
    // differ; name is preserved on recreate). Vacuously fixed when
    // there are no source webhooks (item shouldn't have surfaced).
    const sources = fixState.sourceNotificationWebhooks ?? [];
    if (sources.length === 0) return true;
    const secrets = fixState.notificationWebhookSecrets ?? {};
    return sources.every(hook => {
      const value = secrets[hook.name];
      return typeof value === 'string' && value.length > 0;
    });
  }
  if (key === 'identity_provider_secrets') {
    // Bucket 2.2: each migratable source IdP needs a user-supplied
    // client_secret. Filtered OUT:
    //   - `onetimepin` - Cloudflare auto-provisions per-account.
    //   - `saml` - SAML's trust model is cert-based (idp_public_certs
    //     + signed assertions), not shared-secret-based. The
    //     `config.client_secret` field is not used by Cloudflare for
    //     SAML, so prompting the user for one would either record
    //     garbage that does nothing or confuse the user. SAML IdPs
    //     still migrate (via the captured `config`); they just don't
    //     need a value here.
    // Vacuously fixed when no migratable IdPs remain after filtering.
    const sources = (fixState.sourceIdentityProviders ?? []).filter(
      idp => idp.type !== 'onetimepin' && idp.type !== 'saml',
    );
    if (sources.length === 0) return true;
    const secrets = fixState.identityProviderSecrets ?? {};
    return sources.every(idp => {
      const value = secrets[idp.name];
      // Trim before checking - the IdPSecretFix component trims on
      // input, but defensive trim here covers programmatic callers.
      return typeof value === 'string' && value.trim().length > 0;
    });
  }
  if (key === 'aop_mtls_certificate_bundle') {
    // Bucket 2.3: this item surfaces ONLY when the source zone has
    // AOP hostname associations (i.e. there's a cert to replace).
    // "Fixed" means the user has supplied at least one cert+key
    // bundle. Multiple bundles are fine - the migrator picks the
    // first successful upload for the hostname association.
    const assoc = fixState.sourceAopHostnameAssociations;
    if (!assoc || !assoc.hostnames || assoc.hostnames.length === 0) return true;
    const bundles = fixState.aopMtlsBundles ?? [];
    if (bundles.length === 0) return false;
    // Each bundle needs all three fields non-empty.
    return bundles.every(b =>
      typeof b.name === 'string' && b.name.length > 0 &&
      typeof b.certificates === 'string' && b.certificates.length > 0 &&
      typeof b.private_key === 'string' && b.private_key.length > 0,
    );
  }
  if (key === 'ai_gateway_custom_provider_api_keys') {
    // Bucket 2.4: each source custom provider needs a user-supplied
    // API key. Keyed by slug (source-stable). Vacuously fixed when
    // no custom providers exist.
    const sources = fixState.sourceAiGatewayCustomProviders ?? [];
    if (sources.length === 0) return true;
    const keys = fixState.aiGatewayProviderApiKeys ?? {};
    return sources.every(p => {
      const value = keys[p.slug];
      return typeof value === 'string' && value.length > 0;
    });
  }
  return false;
}

/**
 * Derive the three-state resolution for one actionable item.
 *
 * Rules (in order - first match wins):
 *   1. Item has an inline fix-it form AND every required value is
 *      supplied → 'fixed'.
 *   2. Item key is in the acknowledgments set → 'acknowledged'.
 *      (Acknowledgment is an explicit user choice to skip the fix,
 *      so it takes precedence over a partially-filled fix-it form.
 *      It does NOT take precedence over a complete fix - once
 *      everything is filled in, the migration will use the values
 *      regardless of whether the ack box was previously checked.)
 *   3. Otherwise → 'unresolved'.
 *
 * Informational items (non-actionable per category) never go through
 * this gate - they are surfaced in the InformationalBlock which has
 * no checkboxes or fix-it forms. Callers should filter by
 * `actionable: true` before invoking this function.
 */
export function deriveItemState(
  item: { key: string },
  fixState: FixItState,
  acknowledgments: ReadonlySet<string>,
): ItemResolutionState {
  if (hasInlineFixIt(item.key) && isItemFixed(item.key, fixState)) {
    return 'fixed';
  }
  if (acknowledgments.has(item.key)) {
    return 'acknowledged';
  }
  return 'unresolved';
}

/* ────────────────────────────────────────────────────────────────── */
/* Bucket 3: copy-command snippets for CLI-fixable items              */
/*                                                                    */
/* Some actionable items don't have a textbox-shaped fix (so they     */
/* can't land in bucket 1) but DO have a well-known CLI command that  */
/* the user can copy and run. The panel surfaces these as a           */
/* copy-to-clipboard snippet beneath the item row. This is purely     */
/* informational - the ack checkbox still gates Continue. We can't    */
/* run wrangler for the user; we can at least put the exact command   */
/* on their clipboard.                                                */
/*                                                                    */
/* Adding a new key here is a UI-only change. The catalog's           */
/* `manualAction` text remains the canonical natural-language         */
/* explanation; the snippet is the machine-readable distillation.    */
/* ────────────────────────────────────────────────────────────────── */

/** Set of IMPOSSIBLE_TO_MIGRATE keys with a CLI snippet helper. */
export const BUCKET_3_CLI_KEYS: ReadonlySet<string> = new Set<string>([
  'd1_schema_and_data',
  'r2_object_data',
  'pages_deployment_data',
]);

/** Returns true when there is a copy-command helper for this key. */
export function hasCliCommands(key: string): boolean {
  return BUCKET_3_CLI_KEYS.has(key);
}

/**
 * Build the CLI command snippets for one IMPOSSIBLE_TO_MIGRATE item,
 * interpolating source identifiers from the export where applicable.
 * Returns `undefined` for items that don't have a CLI helper (the
 * common case).
 *
 * Pure function. Called at detection time so the result is stamped
 * onto `ApplicableImpossibleResource.cliCommands` and the panel
 * doesn't need to re-walk the export.
 */
export function buildCliCommands(
  item: ImpossibleResource,
  exportData: ZoneExport,
  destAccountId?: string,
): CliCommand[] | undefined {
  if (!hasCliCommands(item.key)) return undefined;

  if (item.key === 'd1_schema_and_data') {
    const dbs = (exportData?.d1Databases ?? []) as Array<{ name?: string }>;
    if (dbs.length === 0) return undefined;
    // Pin each command to the right account so a user with multiple accounts
    // in their wrangler config doesn't export/import against the wrong one.
    const srcId = exportData?.sourceAccountId || exportData?.zone?.account?.id;
    const srcFlag = srcId ? ` --account-id ${srcId}` : '';
    const dstFlag = destAccountId ? ` --account-id ${destAccountId}` : '';
    const commands: CliCommand[] = [];
    for (const db of dbs) {
      const name = typeof db.name === 'string' && db.name.length > 0 ? db.name : '<db-name>';
      commands.push({
        label: `Export schema + data from source: ${name}`,
        command: `wrangler d1 export ${name} --remote --output=${name}.sql${srcFlag}`,
        note: 'Run this against your source-account wrangler config (authenticated to the source CF account).',
      });
      commands.push({
        label: `Apply to destination: ${name}`,
        command: `wrangler d1 execute ${name} --remote --file=${name}.sql${dstFlag}`,
        note: 'Run this against your destination-account wrangler config. The destination D1 database with the same name was created by the migration tool.',
      });
    }
    return commands;
  }

  if (item.key === 'r2_object_data') {
    const buckets = (exportData?.r2Buckets ?? []) as Array<{ name?: string }>;
    if (buckets.length === 0) return undefined;
    // Single setup-once command + per-bucket sync commands. The setup
    // step is shared across buckets so we emit it once at the top.
    const commands: CliCommand[] = [{
      label: 'One-time setup: configure rclone with both accounts',
      command: 'rclone config',
      note: 'Create two remotes - one for the source R2 account ("src") and one for the destination R2 account ("dst"). Each remote uses S3-compatible API credentials from Dashboard → R2 → Manage R2 API Tokens. Pick "s3" as the storage type and "Other" as the provider, with endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com.',
    }];
    for (const bucket of buckets) {
      const name = typeof bucket.name === 'string' && bucket.name.length > 0 ? bucket.name : '<bucket-name>';
      commands.push({
        label: `Copy objects: ${name}`,
        command: `rclone sync --progress src:${name} dst:${name}`,
        note: 'Use --dry-run first to preview. Add --transfers=16 (or similar) to parallelise large copies.',
      });
    }
    return commands;
  }

  if (item.key === 'pages_deployment_data') {
    const projects = (exportData?.pagesProjects ?? []) as Array<{
      name?: string;
      production_branch?: string;
      source?: { type?: string; config?: { owner?: string; repo_name?: string; production_branch?: string } };
    }>;
    if (projects.length === 0) return undefined;
    const commands: CliCommand[] = [];
    for (const project of projects) {
      const name = typeof project.name === 'string' && project.name.length > 0 ? project.name : '<project-name>';
      const cfg = project.source?.config;
      const repo = cfg?.owner && cfg?.repo_name ? `${cfg.owner}/${cfg.repo_name}` : cfg?.repo_name;
      const branch = cfg?.production_branch || project.production_branch;
      if (project.source?.type && repo) {
        // Git-backed: reconnecting the repo lets Cloudflare rebuild from
        // source, reproducing static assets AND Pages Functions — strictly
        // better than re-uploading static output. The deploy trigger is the
        // only API-automatable step; the repo reconnect is a one-time
        // dashboard OAuth action that cannot be migrated.
        commands.push({
          label: `Trigger rebuild from source: ${name}`,
          command: `curl -X POST https://api.cloudflare.com/client/v4/accounts/<dest-account-id>/pages/projects/${name}/deployments -H "Authorization: Bearer <token>"`,
          note: `Git-backed project. First reconnect repo ${repo}${branch ? ` (branch ${branch})` : ''} on the destination account via Dashboard → Workers & Pages → Create → Pages → Connect to Git (one-time OAuth, not migratable). Then this triggers a production deployment; Cloudflare rebuilds from source, reproducing assets AND Pages Functions.`,
        });
      } else {
        commands.push({
          label: `Deploy to destination: ${name}`,
          command: `wrangler pages deploy <dir> --project-name=${name}`,
          note: 'Direct-upload project. Replace <dir> with your local build output directory. Run against your destination-account wrangler config. The migration tool created the empty Pages project; this uploads the actual assets.',
        });
      }
    }
    return commands;
  }

  return undefined;
}

/**
 * Walk the source export and return all IMPOSSIBLE_TO_MIGRATE entries
 * that apply to this migration. Pure function - no API calls, no side
 * effects.
 */
export function detectApplicableImpossibleResources(
  exportData: ZoneExport,
  destAccountId?: string,
): ApplicableImpossibleResource[] {
  if (!exportData) return [];

  const result: ApplicableImpossibleResource[] = [];
  const lookup = (key: string): ImpossibleResource | null =>
    IMPOSSIBLE_TO_MIGRATE.find(r => r.key === key) ?? null;
  const has = (entries?: unknown[] | null): boolean => Array.isArray(entries) && entries.length > 0;
  const countOf = (entries?: unknown[] | null): number => (Array.isArray(entries) ? entries.length : 0);

  const add = (key: string, count?: number, triggerReason?: string): void => {
    const item = lookup(key);
    if (!item) return;
    if (result.some(r => r.key === key)) return;  // dedupe
    result.push({
      ...item,
      count,
      triggerReason,
      actionable: isActionableCategory(item.category),
      cliCommands: buildCliCommands(item, exportData, destAccountId),
    });
  };

  // ── Always-applicable (every migration) ─────────────────────
  add('nameserver_change', undefined, 'Every migration requires updating nameservers at your domain registrar.');
  // Account members / IAM are per-account and never cross an account
  // boundary - every account-to-account migration leaves them behind, so
  // this always applies. Actionable (account_tied): the user must re-invite
  // members on the destination account.
  add('account_members_iam', undefined, 'Account members, roles, and IAM policies do not transfer between accounts.');

  // ── Cryptographic - based on export content ─────────────────
  // Worker secrets - surface if any workers have secret_text bindings
  if (has(exportData.workers)) {
    const secretCount = (exportData.workers as Array<{ bindings?: Array<{ type?: string }> }>)
      .reduce((sum, w) => sum + (w.bindings || []).filter(b => b.type === 'secret_text').length, 0);
    if (secretCount > 0) {
      add('worker_secrets', secretCount, `${secretCount} secret_text binding(s) across your workers.`);
    }
  }
  // Custom certs with private keys
  if (has(exportData.customCertificates)) {
    add('custom_certificate_keys', countOf(exportData.customCertificates), `${countOf(exportData.customCertificates)} custom certificate(s) - private keys must be re-uploaded.`);
  }
  // Access service tokens
  if (has(exportData.accessServiceTokens)) {
    add('access_service_tokens', countOf(exportData.accessServiceTokens), `${countOf(exportData.accessServiceTokens)} Access service token(s) - client_secret is write-only.`);
  }
  // Turnstile secret keys
  if (has(exportData.turnstileWidgets)) {
    add('turnstile_widget_secrets', countOf(exportData.turnstileWidgets), `${countOf(exportData.turnstileWidgets)} Turnstile widget(s) - secret keys regenerated on dest.`);
  }
  // Origin CA keys
  if (has(exportData.originCaCertificates)) {
    add('origin_ca_keys', countOf(exportData.originCaCertificates), `${countOf(exportData.originCaCertificates)} Origin CA cert(s) - private keys never stored by CF.`);
  }
  // Identity provider secrets - only OAuth-family IdPs need a
  // client_secret. SAML uses cert-based trust (idp_public_certs in
  // config, captured at export time); onetimepin is auto-
  // provisioned. Filter to match isItemFixed and IdPSecretFix.
  if (has(exportData.identityProviders)) {
    const oauthIdpCount = (exportData.identityProviders ?? []).filter(
      (idp: { type?: string }) => idp.type !== 'onetimepin' && idp.type !== 'saml',
    ).length;
    if (oauthIdpCount > 0) {
      add('identity_provider_secrets', oauthIdpCount, `${oauthIdpCount} OAuth Access IdP(s) - client_secret not exportable.`);
    }
  }
  // AOP mTLS certs (if any hostname associations exist)
  if (exportData.hostnameAssociations && Array.isArray(exportData.hostnameAssociations.hostnames) && exportData.hostnameAssociations.hostnames.length > 0) {
    add('aop_mtls_certificate_bundle', exportData.hostnameAssociations.hostnames.length, `${exportData.hostnameAssociations.hostnames.length} hostname(s) using Authenticated Origin Pulls.`);
  }
  // Notification webhook secrets
  if (has(exportData.notificationWebhooks)) {
    add('notification_webhook_secret', countOf(exportData.notificationWebhooks), `${countOf(exportData.notificationWebhooks)} notification webhook(s) - signing secrets are write-only.`);
  }
  // Account Logpush destination credentials
  if (has(exportData.accountLogpushJobs)) {
    add('account_logpush_destination_creds', countOf(exportData.accountLogpushJobs), `${countOf(exportData.accountLogpushJobs)} account-scoped Logpush job(s) - destination credentials may need rotation.`);
  }
  // AI Gateway custom provider API keys
  if (has(exportData.aiGatewayCustomProviders)) {
    add('ai_gateway_custom_provider_api_keys', countOf(exportData.aiGatewayCustomProviders), `${countOf(exportData.aiGatewayCustomProviders)} AI Gateway custom provider(s) - API keys are write-only.`);
  }

  // ── Account-tied resources ──────────────────────────────────
  // Worker binding types that reference per-account resources
  if (has(exportData.workers)) {
    const bindingTypeCounts = new Map<string, number>();
    for (const w of exportData.workers as Array<{ bindings?: Array<{ type?: string }> }>) {
      for (const b of w.bindings || []) {
        if (b.type) bindingTypeCounts.set(b.type, (bindingTypeCounts.get(b.type) || 0) + 1);
      }
    }
    const bindingToKey: Record<string, string> = {
      hyperdrive: 'worker_binding_hyperdrive',
      secrets_store_secret: 'worker_binding_secrets_store',
      vpc_service: 'worker_binding_vpc_service',
      dispatch_namespace: 'worker_binding_dispatch_namespace',
      workflow: 'worker_binding_workflow',
      pipelines: 'worker_binding_pipeline',
      browser: 'worker_binding_browser',
      ai: 'worker_binding_ai',
      mtls_certificate: 'worker_binding_mtls_certificate',
      vectorize: 'worker_binding_vectorize',
      analytics_engine: 'worker_binding_analytics_engine',
      send_email: 'worker_binding_send_email',
    };
    for (const [bindingType, count] of bindingTypeCounts) {
      const key = bindingToKey[bindingType];
      if (key) add(key, count, `${count} \`${bindingType}\` binding(s) across your workers.`);
    }
  }

  // Pages projects - deployment bundles are out-of-scope
  if (has(exportData.pagesProjects)) {
    add('pages_deployment_data', countOf(exportData.pagesProjects), `${countOf(exportData.pagesProjects)} Pages project(s) - must redeploy via \`wrangler pages deploy\` post-migration.`);
  }

  // Custom Nameservers pool
  if (exportData.customNameserversMetadata?.enabled) {
    add('account_custom_ns_pool', undefined, 'Zone uses Custom Nameservers (CNS) - account-level ns_set must be recreated.');
    add('custom_ns_registrar_glue', undefined, 'Custom Nameservers require glue records at the registrar.');
  }

  // Account-level custom rulesets that couldn't be exported
  if (has(exportData.referencedAccountRulesetIds)) {
    const refIds = exportData.referencedAccountRulesetIds as string[];
    const migrated = new Set((exportData.accountRulesets || []).map((r: { id?: string }) => r.id).filter(Boolean));
    const unmappable = refIds.filter(id => !migrated.has(id));
    if (unmappable.length > 0) {
      add('account_custom_ruleset_unmapped', unmappable.length, `${unmappable.length} account-level ruleset(s) referenced by execute rules but not exportable from source.`);
    }
  }

  // ── Auto-managed (always relevant if source has the resource) ─
  if (has(exportData.rulesets)) {
    add('managed_rulesets_cloudflare');
    add('ddos_managed_rules');
  }
  // Universal SSL pack is always created - but only mention it if the
  // user might be looking for it (i.e. they have a custom SSL setup).
  add('universal_ssl_pack', undefined, 'Cloudflare auto-provisions Universal SSL on the new zone.');

  // ── Data offline ────────────────────────────────────────────
  if (has(exportData.d1Databases)) {
    add('d1_schema_and_data', countOf(exportData.d1Databases), `${countOf(exportData.d1Databases)} D1 database(s) - schema/data needs wrangler CLI export+import.`);
  }
  if (has(exportData.r2Buckets)) {
    add('r2_object_data', countOf(exportData.r2Buckets), `${countOf(exportData.r2Buckets)} R2 bucket(s) - bulk object data needs S3 API or rclone (CORS/lifecycle/managed-domain ARE migrated).`);
  }
  if (has(exportData.logpushJobs) || has(exportData.accountLogpushJobs)) {
    const total = countOf(exportData.logpushJobs) + countOf(exportData.accountLogpushJobs);
    add('logpush_buffer', total, `${total} Logpush job(s) - buffered data is not exportable.`);
  }
  if (has(exportData.durableObjectNamespaces)) {
    add('durable_object_state', countOf(exportData.durableObjectNamespaces), `${countOf(exportData.durableObjectNamespaces)} Durable Object namespace(s) - stored state isn't copied automatically unless you configure DO migration on the scope step.`);
  }

  // ── Data ephemeral ──────────────────────────────────────────
  // Always-applicable. Surface as informational so the user knows.
  add('cached_content', undefined, 'Cache is ephemeral and rebuilds on first hit after migration.');
  if (has(exportData.queues)) {
    add('queue_messages_in_flight', countOf(exportData.queues), `${countOf(exportData.queues)} Queue(s) - in-flight messages cannot be replayed.`);
  }
  if (has(exportData.kvNamespaces)) {
    add('kv_expiration_ttls', countOf(exportData.kvNamespaces), `${countOf(exportData.kvNamespaces)} KV namespace(s) - per-key absolute expiry timestamps reset.`);
  }

  // ── Manual external ─────────────────────────────────────────
  if (exportData.dnssecStatus && exportData.dnssecStatus.status && exportData.dnssecStatus.status !== 'disabled') {
    add('dnssec_ds_record', undefined, `DNSSEC is ${exportData.dnssecStatus.status} on source - DS record must be updated at registrar post-migration.`);
  }
  if (has(exportData.emailRoutingRules)) {
    add('email_routing_destinations', countOf(exportData.emailRoutingRules), `${countOf(exportData.emailRoutingRules)} email routing rule(s) - forward destinations need re-verification.`);
  }
  if (has(exportData.customHostnames)) {
    add('custom_hostname_validation', countOf(exportData.customHostnames), `${countOf(exportData.customHostnames)} custom hostname(s) - SSL DCV tokens differ on dest.`);
  }
  if (has(exportData.certificatePacks)) {
    add('cert_pack_dcv', countOf(exportData.certificatePacks), `${countOf(exportData.certificatePacks)} cert pack(s) - DCV must be re-completed on dest.`);
  }

  // ── Account-tied product dependencies ───────────────────────
  // DNS records pointing at *.cfargotunnel.com → Tunnel dependency
  if (has(exportData.dnsRecords)) {
    const tunnelDns = (exportData.dnsRecords as Array<{ content?: string; type?: string }>).filter(r =>
      typeof r.content === 'string' && r.content.toLowerCase().includes('.cfargotunnel.com'),
    );
    if (tunnelDns.length > 0) {
      add('tunnel_origin', tunnelDns.length, `${tunnelDns.length} DNS record(s) point at a Cloudflare Tunnel origin (*.cfargotunnel.com).`);
    }
  }
  // Access policies → potential Gateway dependency
  if (has(exportData.accessPolicies)) {
    add('gateway_dependency', undefined, `Access policies may reference Zero Trust Gateway lists/rules that are not migrated.`);
  }
  if (has(exportData.aiGateways) || has(exportData.aiGatewayCustomProviders)) {
    add('ai_gateway_dependency', undefined, `AI Gateway URL references in worker source code must be updated to use the dest account ID.`);
  }
  // R2 event notifications - surface when R2 buckets exist
  if (has(exportData.r2Buckets)) {
    add('r2_bucket_event_notifications', undefined, `R2 event notification subscriptions are account-scoped and not migrated.`);
  }
  // Magic / Tunnels / Pages projects / etc. that the user may or may
  // not be using are surfaced only when triggered by source data.

  // Sort: cryptographic first (most security-sensitive), then
  // account_tied, then data_offline, then everything else. Stable
  // alphabetical within each category for predictable rendering.
  const categoryOrder: Record<string, number> = {
    cryptographic: 1,
    account_tied: 2,
    data_offline: 3,
    manual_external: 4,
    auto_managed: 5,
    data_ephemeral: 6,
    read_only: 7,
  };
  result.sort((a, b) => {
    const ca = categoryOrder[a.category] ?? 99;
    const cb = categoryOrder[b.category] ?? 99;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });

  return result;
}
