// Account-scoped sub-resources extracted from migrateZone().
//
// This phase covers resources that live at the *account* level rather than
// the zone level — Access (groups/tags/bookmarks/custom pages/identity
// providers/service tokens), Custom Lists + items, Queue Consumers,
// Notification policies + webhooks + PagerDuty acknowledgments, account-
// scoped Logpush jobs (filtered to this zone), Zaraz, Turnstile widgets,
// and the Argo / Tiered-Caching / Bot-Management triplet that's stored
// against the account but applied to the zone.
//
// The block is a literal move from migrate.ts lines 5098-5656 (pre-extract).
// One small behavior-preserving change: the three ad-hoc `completedItems++`
// / `completedItems += N` calls in the original block are replaced with
// `onItemDone()` calls (the same closure that `let completedItems = 0`
// is wrapped in upstream). This keeps progress reporting identical while
// avoiding the need to capture the mutable counter.
//
// Pure mutation of `report` via the standard helpers. No I/O patterns
// introduced beyond what the original block already did.

import type { MigrationReport, ZoneExport, ReportSection } from '../types';
import * as api from '../api';
import { migrateItems, type LogFn } from '../migrate';
import { isManualActionError } from './errors';

export interface AccountSubResourcesDeps {
  exportData: ZoneExport;
  report: MigrationReport;
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  destZoneId: string;
  logWithProgress: LogFn;
  /** Advance the upstream `completedItems` progress counter by one. */
  onItemDone: () => void;
  /** True when the user picked "overwrite" as the conflict strategy in Step 1. */
  shouldOverwrite: boolean;
  /**
   * Notification webhook signing secrets supplied by the user via the
   * Step 2 inline fix-it form. Keyed by source webhook name. When a value is present for a given
   * webhook, the POST body to /alerting/v3/destinations/webhooks
   * includes the secret; the dest webhook is fully functional without
   * any post-migration step. When omitted, the previous behavior is
   * preserved (webhook recreated without secret + manual-action
   * message).
   */
  notificationWebhookSecrets?: Record<string, string>;
  /** Bucket 2.2: Access IdP client_secret values keyed by source
   * IdP name. When present, the IdP is created on dest with the
   * full export-captured config + user-supplied secret. When
   * absent, the IdP falls back to the acknowledgment-only path. */
  identityProviderSecrets?: Record<string, string>;
}

/**
 * Run the account-scoped sub-resources phase. Mutates `deps.report` in place.
 * Returns when all sub-sections have been pushed to `report.sections`.
 */
export async function migrateAccountSubResources(deps: AccountSubResourcesDeps): Promise<void> {
  const {
    exportData,
    report,
    destAuth,
    destAccountId,
    destZoneId,
    logWithProgress,
    onItemDone,
    shouldOverwrite,
    notificationWebhookSecrets,
    identityProviderSecrets,
  } = deps;

  // Identity function — preserved from the original `trackSection` closure
  // in migrateZone() which is currently a no-op. Kept as a local in case we
  // later want per-phase section tracking without touching call sites.
  const trackSection = (section: ReportSection) => section;

  // ── Access Identity Providers
  //
  // IdPs migrate via the captured `config` from export-zone.ts. The
  // export preserves every field except truly-private secrets
  // (client_secret, private_key) — see SECRET_LIKE_CONFIG_FIELDS in
  // src/migrate/export-zone.ts.
  //
  // Per-IdP outcome:
  //   - `saml` → CREATE on dest from captured config alone. SAML's
  //     trust model is cert-based; `idp_public_certs` is in the
  //     captured config (PUBLIC X.509 material, not a secret) so no
  //     user input is required.
  //   - OAuth family (oidc, okta, azureAD, etc.) with user-supplied
  //     client_secret → CREATE on dest with merged config.
  //   - OAuth family without secret → acknowledged-only (manual
  //     recreation needed).
  //   - `onetimepin` IdPs are auto-provisioned by Cloudflare and
  //     never have a `name` or `client_secret` — always acknowledged.
  //   - Any IdP with config missing (older export file) →
  //     acknowledged-only with a different reason string so the
  //     user knows to re-export.
  if (Array.isArray(exportData.identityProviders) && exportData.identityProviders.length > 0) {
    type IdPSectionItem = { name: string; status: 'success' | 'acknowledged' | 'failed'; error?: string };
    const items: IdPSectionItem[] = [];
    let successCount = 0;
    let ackCount = 0;
    let failedCount = 0;
    const idpsMissingSecret: string[] = [];

    for (const p of exportData.identityProviders) {
      const label = `${p.name || 'Identity Provider'} (${p.type})`;
      const userSecret = identityProviderSecrets?.[p.name];
      const hasSecret = typeof userSecret === 'string' && userSecret.length > 0;
      const hasConfig = p.config && typeof p.config === 'object';
      const isOnetimepin = p.type === 'onetimepin';
      // SAML IdPs migrate from the captured `config` alone (which
      // includes `idp_public_certs` as of 2026-05-25 — see the
      // SECRET_LIKE_CONFIG_FIELDS comment in
      // src/migrate/export-zone.ts). They do NOT require a
      // user-supplied client_secret because SAML uses cert-based
      // trust, not OAuth shared secrets.
      const isSaml = p.type === 'saml';
      // An IdP needs a user-supplied client_secret iff it's an
      // OAuth-family IdP (everything except onetimepin and SAML).
      const requiresUserSecret = !isOnetimepin && !isSaml;

      // onetimepin IdPs cannot be migrated as-is; they're auto-
      // provisioned per-account. Don't ever try to re-create them.
      if (isOnetimepin) {
        items.push({
          name: label,
          status: 'acknowledged',
          error: 'Cloudflare auto-provisions the onetimepin (email OTP) IdP on every account. No migration needed.',
        });
        ackCount++;
        continue;
      }

      if (requiresUserSecret && !hasSecret) {
        items.push({
          name: label,
          status: 'acknowledged',
          error: `IdP type "${p.type}" requires a client_secret which cannot be exported. Supply it via the Step 2 fix-it form or recreate the IdP manually on dest.`,
        });
        idpsMissingSecret.push(p.name);
        ackCount++;
        continue;
      }

      if (!hasConfig) {
        items.push({
          name: label,
          status: 'acknowledged',
          error: 'Source export does not include IdP config (older export file). Re-export from this version of the tool to enable auto-migration, or recreate the IdP manually on dest.',
        });
        ackCount++;
        continue;
      }

      // Build the IdP payload from the captured config. For OAuth-
      // family IdPs we merge the user-supplied client_secret in;
      // for SAML the config already contains everything required
      // (sso_target_url, issuer_url, idp_public_certs, etc.). The
      // captured config is guaranteed not to contain client_secret
      // (stripped at export time per SECRET_LIKE_CONFIG_FIELDS). We
      // don't mutate the source object.
      const mergedConfig = isSaml
        ? { ...p.config }
        : { ...p.config, client_secret: userSecret };
      try {
        const created = await api.createIdentityProvider(destAuth, destAccountId, {
          name: p.name,
          type: p.type,
          config: mergedConfig,
        });
        items.push({ name: label, status: 'success' });
        successCount++;
        // Capture the dest IdP for the Step 4 Test Configuration
        // workflow. We need the destination ID to build the login
        // URL. Defensive:
        // skip if the create response was malformed.
        if (created && typeof created.id === 'string' && created.id.length > 0) {
          if (!report.migratedIdentityProviders) report.migratedIdentityProviders = [];
          report.migratedIdentityProviders.push({
            destId: created.id,
            name: p.name,
            type: p.type,
          });
        }
      } catch (err) {
        const msg = (err as Error).message || String(err);
        items.push({
          name: label,
          status: 'failed',
          error: `Create failed: ${msg}`,
        });
        report.errors.push({
          resource: 'identity_provider',
          name: label,
          error: msg,
          suggestion: `Verify the IdP config (auth_url / token_url / certs_url for OIDC, or SAML metadata) is correct on the source IdP and that the destination account has Access enabled.`,
        });
        failedCount++;
      }
      onItemDone();
    }

    report.sections.push({
      name: 'Identity Providers (Access)',
      total: exportData.identityProviders.length,
      success: successCount,
      failed: failedCount,
      skipped: 0,
      acknowledged: ackCount,
      items,
    });
    report.summary.acknowledged = (report.summary.acknowledged || 0) + ackCount;

    // Manual-action prompt only for IdPs the user did NOT supply a
    // secret for. Skip for IdPs we successfully migrated.
    if (idpsMissingSecret.length > 0) {
      const sample = idpsMissingSecret.slice(0, 3).join(', ');
      const more = idpsMissingSecret.length > 3 ? `, +${idpsMissingSecret.length - 3} more` : '';
      report.manualActions.push(
        `Re-create ${idpsMissingSecret.length} Access IdP(s) on the destination account with the same OAuth/SAML credentials: ${sample}${more}.`,
      );
    }

    // Fetch the dest Access organization ("team domain") so Step 4
    // can build per-IdP test-login URLs. Only fetched when at least
    // one IdP was actually created — there's no point looking up the
    // team domain if there's nothing to test. Non-fatal: a failed
    // fetch leaves `destAccessOrg` undefined and Step 4 renders a
    // fallback message ("destination has no Access team domain").
    if (successCount > 0) {
      try {
        const org = await api.getAccessOrganization(destAuth, destAccountId);
        if (org) {
          report.destAccessOrg = { auth_domain: org.auth_domain, name: org.name };
        }
      } catch (err) {
        // Logged as a warning, not pushed to errors — IdP migration
        // itself succeeded. The user will just see the fallback
        // message in the Step 4 test section.
        const msg = (err as Error).message || String(err);
        report.warnings.push(`Could not fetch destination Access team domain for IdP login testing: ${msg}`);
      }
    }
  }

  // Access Groups — names + include/exclude/require fully migratable
  if (Array.isArray(exportData.accessGroups) && exportData.accessGroups.length > 0) {
    const sec = await migrateItems('Access Groups', exportData.accessGroups,
      async (group) => { await api.createAccessGroup(destAuth, destAccountId, group); },
      (g) => g.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/access/groups`);
    trackSection(sec); report.sections.push(sec);
  }

  // D4: Access Tags — name-only, idempotent on dest.
  if (Array.isArray(exportData.accessTags) && exportData.accessTags.length > 0) {
    const sec = await migrateItems('Access Tags', exportData.accessTags,
      async (tag) => { await api.createAccessTag(destAuth, destAccountId, { name: tag.name }); },
      (t) => t.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/access/tags`);
    trackSection(sec); report.sections.push(sec);
  }

  // D4: Access Bookmarks — fully migratable.
  if (Array.isArray(exportData.accessBookmarks) && exportData.accessBookmarks.length > 0) {
    const sec = await migrateItems('Access Bookmarks', exportData.accessBookmarks,
      async (bookmark) => {
        const { id: _id, ...rest } = bookmark;
        await api.createAccessBookmark(destAuth, destAccountId, rest);
      },
      (b) => b.name || b.domain || 'bookmark',
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/access/bookmarks`);
    trackSection(sec); report.sections.push(sec);
  }

  // D4: Access Custom Pages — HTML + name + type are migratable. Logos
  // and other binary assets referenced by the HTML are NOT in the export
  // (out-of-band uploads); the user must re-upload those manually.
  if (Array.isArray(exportData.accessCustomPages) && exportData.accessCustomPages.length > 0) {
    const sec = await migrateItems('Access Custom Pages', exportData.accessCustomPages,
      async (page) => {
        const { uid: _uid, ...rest } = page;
        await api.createAccessCustomPage(destAuth, destAccountId, rest);
      },
      (p) => `${p.type}: ${p.name}`,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/access/custom_pages`);
    trackSection(sec); report.sections.push(sec);
    // Custom pages may reference binary assets (logos) uploaded out-of-band.
    report.manualActions.push(
      `Verify Access Custom Page binary assets (logos, embedded images) on the destination account — only HTML is migrated via API, not referenced uploads.`,
    );
  }

  // Access Service Tokens — client_secret is shown only at creation, surface as acknowledged
  if (Array.isArray(exportData.accessServiceTokens) && exportData.accessServiceTokens.length > 0) {
    report.sections.push({
      name: 'Access Service Tokens',
      total: exportData.accessServiceTokens.length,
      success: 0, failed: 0, skipped: 0,
      acknowledged: exportData.accessServiceTokens.length,
      items: exportData.accessServiceTokens.map(t => ({
        name: t.name,
        status: 'acknowledged',
        error: 'Service tokens must be recreated — client_secret is shown only once at creation and is not exportable.',
      })),
    });
    report.summary.acknowledged = (report.summary.acknowledged || 0) + exportData.accessServiceTokens.length;
  }

  // Custom Lists (account-level — referenced by WAF rules)
  if (Array.isArray(exportData.customLists) && exportData.customLists.length > 0) {
    const listIdMap = new Map<string, string>();
    const sec = await migrateItems('Custom Lists', exportData.customLists,
      async (list) => {
        const created = await api.createCustomList(destAuth, destAccountId, list as api.CustomList);
        if (created.id) listIdMap.set(list.name, created.id);
      },
      (l) => l.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/rules/lists`);
    trackSection(sec); report.sections.push(sec);

    // List items (bulk append per list)
    if (exportData.customListItems && Object.keys(exportData.customListItems).length > 0) {
      let totalItems = 0;
      const itemErrors: string[] = [];
      for (const [listName, items] of Object.entries(exportData.customListItems)) {
        const listId = listIdMap.get(listName);
        if (!listId || !Array.isArray(items) || items.length === 0) continue;
        try {
          await api.appendCustomListItems(destAuth, destAccountId, listId, items as api.CustomListItem[]);
          totalItems += items.length;
        } catch (e) {
          itemErrors.push(`${listName}: ${(e as Error).message}`);
        }
      }
      report.sections.push({
        name: 'Custom List Items',
        total: totalItems + itemErrors.length,
        success: totalItems > 0 ? 1 : 0,
        failed: itemErrors.length,
        skipped: 0,
        items: itemErrors.length > 0
          ? itemErrors.map(e => ({ name: e.split(':')[0], status: 'failed', error: e }))
          : [{ name: `${totalItems} item(s) appended across ${Object.keys(exportData.customListItems).length} list(s)`, status: 'success' }],
      });
    }
  }

  // Queue consumers — per-queue wiring
  if (exportData.queueConsumers && Object.keys(exportData.queueConsumers).length > 0) {
    // Resolve dest queue IDs by name (list once)
    let destQueueMap = new Map<string, string>();
    try {
      const destQueues = await api.listQueues(destAuth, destAccountId);
      destQueueMap = new Map(destQueues.map(q => [q.queue_name, q.queue_id]));
    } catch {/* skip */}

    const flat = Object.entries(exportData.queueConsumers).flatMap(([queueName, consumers]) =>
      consumers.map(c => ({ ...c, _queueName: queueName }))
    );
    if (flat.length > 0) {
      const sec = await migrateItems('Queue Consumers', flat,
        async (consumer) => {
          const queueId = destQueueMap.get(consumer._queueName);
          if (!queueId) throw new Error(`Destination queue "${consumer._queueName}" not found`);
          const { _queueName: _omit, ...consumerBody } = consumer;
          await api.createQueueConsumer(destAuth, destAccountId, queueId, consumerBody as api.QueueConsumer);
        },
        (c) => `${c._queueName} → ${c.script_name}`,
        report.errors, logWithProgress, report, onItemDone,
        `POST /accounts/${destAccountId}/queues/{queue_id}/consumers`);
      trackSection(sec); report.sections.push(sec);
    }
  }

  // Notification policies that filter to this zone (D2).
  //
  // We recreate the webhook destinations first (PagerDuty is acknowledged
  // separately because the OAuth token can't be migrated), build a
  // destination-ID remap, then recreate the policies with:
  //   - mechanisms updated to reference the new webhook IDs
  //   - filters.zones rewritten from sourceZoneId → destZoneId
  // Webhook secrets are write-only — the policies will deliver but the
  // user must re-paste each webhook's secret post-migration via the
  // dashboard or PUT /alerting/v3/destinations/webhooks/{id}.
  if (Array.isArray(exportData.notificationPolicies) && exportData.notificationPolicies.length > 0) {
    logWithProgress(`⏳ Migrating ${exportData.notificationPolicies.length} notification policy/policies...`);

    const webhookIdMap = new Map<string, string>();
    if (Array.isArray(exportData.notificationWebhooks) && exportData.notificationWebhooks.length > 0) {
      // Track which webhooks were created with vs without a user-supplied
      // secret so the post-migration manual-action message can be
      // accurate (omit re-paste prompts for webhooks that DID get a
      // secret on create).
      const webhooksMissingSecret: string[] = [];
      const hookSec = await migrateItems(
        'Notification Webhooks',
        exportData.notificationWebhooks,
        async (hook) => {
          const userSecret = notificationWebhookSecrets?.[hook.name];
          const body: Partial<api.NotificationWebhook> = {
            name: hook.name,
            type: hook.type,
            url: hook.url,
          };
          if (typeof userSecret === 'string' && userSecret.length > 0) {
            // Per bucket 2.1 spike: the API accepts `secret` on create
            // (write-only on GET). Cloudflare will sign webhook
            // payloads with this secret; recipients verify the HMAC
            // header just like before migration.
            body.secret = userSecret;
          } else {
            webhooksMissingSecret.push(hook.name);
          }
          const created = await api.createNotificationWebhook(destAuth, destAccountId, body);
          if (hook.id && created.id) webhookIdMap.set(hook.id, created.id);
        },
        (h) => h.name,
        report.errors, logWithProgress, report, onItemDone,
        `POST /accounts/${destAccountId}/alerting/v3/destinations/webhooks`,
      );
      trackSection(hookSec); report.sections.push(hookSec);
      // Manual-action message only mentions webhooks WITHOUT a supplied
      // secret. If every webhook got a secret on create, no message is
      // emitted — the migration is complete for that section.
      if (webhooksMissingSecret.length > 0) {
        const sample = webhooksMissingSecret.slice(0, 3).join(', ');
        const more = webhooksMissingSecret.length > 3 ? `, +${webhooksMissingSecret.length - 3} more` : '';
        report.manualActions.push(
          `Re-paste webhook secret(s) on the destination account at Dashboard → Notifications → Destinations → Webhooks ` +
          `(${webhooksMissingSecret.length} of ${exportData.notificationWebhooks.length} webhook(s) migrated without secrets: ${sample}${more}).`,
        );
      }
    }

    // PagerDuty destinations are surfaced as acknowledgments — the OAuth
    // token connection is per-account and cannot be migrated via API.
    if (Array.isArray(exportData.notificationPagerDuty) && exportData.notificationPagerDuty.length > 0) {
      report.sections.push({
        name: 'Notification PagerDuty Destinations',
        total: exportData.notificationPagerDuty.length,
        success: 0, failed: 0, skipped: 0,
        acknowledged: exportData.notificationPagerDuty.length,
        items: exportData.notificationPagerDuty.map(p => ({
          name: p.name,
          status: 'acknowledged' as const,
          error: 'PagerDuty integration tokens are bound to the source account via OAuth. Reconnect PagerDuty on the destination account before any notification policy referencing it will deliver.',
        })),
      });
      report.summary.total += exportData.notificationPagerDuty.length;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + exportData.notificationPagerDuty.length;
      report.manualActions.push(
        `Reconnect PagerDuty on the destination account for ${exportData.notificationPagerDuty.length} destination(s) before notification policies can fire to PagerDuty.`,
      );
    }

    // Recreate the policies, remapping zone IDs and webhook IDs as we go.
    const policySec = await migrateItems(
      'Notification Policies',
      exportData.notificationPolicies,
      async (policy) => {
        // Remap filters.zones to point at the dest zone instead of source.
        let newFilters: Record<string, unknown> | undefined = policy.filters;
        if (newFilters) {
          const oldZones = newFilters.zones;
          if (Array.isArray(oldZones)) {
            newFilters = {
              ...newFilters,
              zones: oldZones.map(zid => zid === exportData.zone.id ? destZoneId : zid),
            };
          }
        }
        // Remap webhook IDs in mechanisms. PagerDuty IDs are left alone —
        // they will fail to fire until the user reconnects PagerDuty.
        const newMechanisms = {
          ...policy.mechanisms,
          ...(policy.mechanisms.webhooks && {
            webhooks: policy.mechanisms.webhooks
              .map(w => webhookIdMap.has(w.id) ? { id: webhookIdMap.get(w.id)! } : w)
              .filter(w => w.id),
          }),
        };
        await api.createNotificationPolicy(destAuth, destAccountId, {
          name: policy.name,
          description: policy.description,
          alert_type: policy.alert_type,
          enabled: policy.enabled,
          mechanisms: newMechanisms,
          filters: newFilters,
          conditions: policy.conditions,
          alert_interval: policy.alert_interval,
        });
      },
      (p) => p.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/alerting/v3/policies`,
    );
    trackSection(policySec); report.sections.push(policySec);
  }

  // Account-scoped Logpush jobs filtered to this zone (D3).
  //
  // Re-create on the destination account with two rewrites:
  //   1. Replace source zone ID with dest zone ID in the filter string.
  //   2. Strip the `id` field so the API assigns a new ID.
  // The destination_conf is preserved verbatim. It typically contains
  // destination-specific credentials (S3 access keys, Splunk tokens,
  // Datadog API keys, etc.) that the user must rotate on the dest
  // account — surfaced as a manualAction below.
  if (Array.isArray(exportData.accountLogpushJobs) && exportData.accountLogpushJobs.length > 0) {
    logWithProgress(`⏳ Migrating ${exportData.accountLogpushJobs.length} account-scoped Logpush job(s) filtered to this zone...`);
    const sec = await migrateItems(
      'Account Logpush Jobs',
      exportData.accountLogpushJobs,
      async (job) => {
        const newFilter = job.filter
          ? job.filter.replaceAll(exportData.zone.id, destZoneId)
          : job.filter;
        const { id: _id, ...rest } = job;
        await api.createAccountLogpushJob(destAuth, destAccountId, {
          ...rest,
          filter: newFilter,
        });
      },
      (j) => j.name || j.dataset || `logpush-job-${j.id ?? 'unknown'}`,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/logpush/jobs`,
    );
    trackSection(sec); report.sections.push(sec);
    report.manualActions.push(
      `Verify destination credentials in ${exportData.accountLogpushJobs.length} migrated account-scoped Logpush job(s) (destination_conf may include source-account API keys that must be rotated). Complete ownership_challenge on dest if required.`,
    );
  }

  // Zaraz configuration (single item)
  if (exportData.zarazConfig) {
    logWithProgress('⏳ Migrating Zaraz configuration...');
    logWithProgress(`  PUT /zones/${destZoneId}/zaraz/config`);
    try {
      await api.updateZarazConfig(destAuth, destZoneId, exportData.zarazConfig);
      onItemDone();
      logWithProgress('  ✓ Zaraz configuration migrated');
      report.sections.push({
        name: 'Zaraz Configuration',
        total: 1,
        success: 1,
        failed: 0,
        skipped: 0,
        items: [{ name: 'Zaraz Config', status: 'success' }],
      });
    } catch (e: unknown) {
      const err = e as Error;
      logWithProgress(`  ❌ Zaraz config failed: ${err.message}`);
      report.sections.push({
        name: 'Zaraz Configuration',
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
        items: [{ name: 'Zaraz Config', status: 'failed', error: err.message }],
      });
      report.errors.push({
        resource: 'Zaraz Configuration',
        name: 'Zaraz Config',
        error: err.message,
        suggestion: 'Zaraz may require specific plan features',
      });
    }
  }

  // Turnstile widgets (account-level) — skip widgets that already exist at destination
  if (exportData.turnstileWidgets.length > 0) {
    logWithProgress('⏳ Migrating Turnstile widgets...');
    // List existing widgets on the destination account to detect duplicates
    let existingWidgetNames = new Set<string>();
    try {
      const destWidgets = await api.listTurnstileWidgets(destAuth, destAccountId);
      existingWidgetNames = new Set(destWidgets.map(w => w.name.toLowerCase()));
    } catch {
      // Non-fatal: if we can't list, proceed and let creation errors surface naturally
    }

    // Partition into new vs duplicate widgets
    const newWidgets: typeof exportData.turnstileWidgets = [];
    const duplicateWidgets: typeof exportData.turnstileWidgets = [];
    for (const w of exportData.turnstileWidgets) {
      if (existingWidgetNames.has(w.name.toLowerCase())) {
        duplicateWidgets.push(w);
      } else {
        newWidgets.push(w);
      }
    }

    // Report duplicates as skipped or delete+recreate in overwrite mode
    if (duplicateWidgets.length > 0 && !shouldOverwrite) {
      logWithProgress(`  ⏭ Skipping ${duplicateWidgets.length} Turnstile widget(s) that already exist on destination`);
      report.sections.push({
        name: 'Turnstile Widgets (duplicates)',
        total: duplicateWidgets.length,
        success: 0,
        failed: 0,
        skipped: duplicateWidgets.length,
        items: duplicateWidgets.map(w => ({
          name: w.name,
          status: 'skipped' as const,
          error: 'Widget with this name already exists on the destination account',
        })),
      });
      report.warnings.push(`${duplicateWidgets.length} Turnstile widget(s) skipped — already exist on the destination account: ${duplicateWidgets.map(w => w.name).join(', ')}`);
      for (let i = 0; i < duplicateWidgets.length; i++) onItemDone();
    } else if (duplicateWidgets.length > 0) {
      // Overwrite mode: delete existing widgets so they can be recreated with new sitekeys
      logWithProgress(`  🔄 Overwrite: deleting ${duplicateWidgets.length} existing Turnstile widget(s) to recreate...`);
      const destWidgets = await api.listTurnstileWidgets(destAuth, destAccountId).catch(() => []);
      const destWidgetMap = new Map(destWidgets.map(w => [w.name.toLowerCase(), w.sitekey]));
      for (const w of duplicateWidgets) {
        const existingSitekey = destWidgetMap.get(w.name.toLowerCase());
        if (existingSitekey) {
          try {
            await api.deleteTurnstileWidget(destAuth, destAccountId, existingSitekey);
            logWithProgress(`    ✓ Deleted existing widget "${w.name}"`);
            // Move to newWidgets so it gets recreated
            newWidgets.push(w);
          } catch (delErr) {
            logWithProgress(`    ✗ Failed to delete widget "${w.name}": ${(delErr as Error).message}`);
            report.errors.push({
              resource: 'Turnstile Widgets',
              name: w.name,
              error: `Overwrite failed: could not delete existing widget — ${(delErr as Error).message}`,
            });
            onItemDone();
          }
        } else {
          // Can't find the sitekey to delete — include for recreation anyway
          newWidgets.push(w);
        }
      }
    }

    // Migrate new + overwritten widgets
    const turnstileSection = await migrateItems(
      'Turnstile Widgets',
      newWidgets,
      async (widget) => {
        await api.createTurnstileWidget(destAuth, destAccountId, {
          name: widget.name,
          domains: widget.domains,
          mode: widget.mode,
          region: widget.region,
          bot_fight_mode: widget.bot_fight_mode,
          offlabel: widget.offlabel,
        });
      },
      (w) => w.name,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /accounts/${destAccountId}/challenges/widgets`,
    );
    trackSection(turnstileSection);
    report.sections.push(turnstileSection);
  }
  logWithProgress(`✓ Batch 4 complete`);

  // ── Batch 4b: Newer account-scoped features (AGENTS.md Principle 7) ──
  // Each migrates because, after a zone migration, the user would notice
  // the feature missing on dest. Workers Observability destinations may
  // carry write-only tokens that don't survive export — those are
  // surfaced via the worker_observability_destination_tokens
  // acknowledgment, not as a failed migration.

  if (Array.isArray(exportData.workersObservabilityDestinations) && exportData.workersObservabilityDestinations.length > 0) {
    const sec = await migrateItems(
      'Workers Observability Destinations',
      exportData.workersObservabilityDestinations,
      async (dest) => { await api.createWorkersObservabilityDestination(destAuth, destAccountId, dest); },
      (d) => d.name || d.slug || d.type,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/workers/observability/destinations`,
    );
    trackSection(sec); report.sections.push(sec);
  }

  if (Array.isArray(exportData.workersObservabilityQueries) && exportData.workersObservabilityQueries.length > 0) {
    const sec = await migrateItems(
      'Workers Observability Queries',
      exportData.workersObservabilityQueries,
      async (q) => { await api.createWorkersObservabilityQuery(destAuth, destAccountId, q); },
      (q) => q.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/workers/observability/queries`,
    );
    trackSection(sec); report.sections.push(sec);
  }

  // Vectorize indexes — index definition only; vector data is data_offline
  // (acknowledged separately via worker_binding_vectorize).
  if (Array.isArray(exportData.vectorizeIndexes) && exportData.vectorizeIndexes.length > 0) {
    const sec = await migrateItems(
      'Vectorize Indexes',
      exportData.vectorizeIndexes,
      async (idx) => { await api.createVectorizeIndex(destAuth, destAccountId, idx); },
      (i) => i.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/vectorize/v2/indexes`,
    );
    trackSection(sec); report.sections.push(sec);
  }

  // Batch 5: Separate-endpoint features (Argo, Tiered Caching, Bot Management)
  // These use dedicated API endpoints, not /zone/settings. We check destination
  // entitlement (via GET) before attempting to write, to avoid opaque errors.
  const hasArgo = exportData.argoSmartRouting?.value === 'on';
  const hasTieredCaching = exportData.argoTieredCaching?.value === 'on';
  const hasBotManagement = exportData.botManagement && (
    exportData.botManagement.fight_mode ||
    exportData.botManagement.sbfm_definitely_automated ||
    exportData.botManagement.sbfm_likely_automated
  );

  if (hasArgo || hasTieredCaching || hasBotManagement) {
    logWithProgress('⏳ Migrating Argo, Tiered Caching, Bot Management (with entitlement checks)...');

    // Argo Smart Routing
    if (hasArgo) {
      try {
        const destArgo = await api.getArgoSmartRouting(destAuth, destZoneId);
        if (destArgo) {
          // Entitlement exists on destination — safe to write
          logWithProgress(`  PATCH /zones/${destZoneId}/argo/smart_routing`);
          await api.updateArgoSmartRouting(destAuth, destZoneId, 'on');
          logWithProgress('  ✓ Argo Smart Routing: enabled on destination');
          report.sections.push({
            name: 'Argo Smart Routing', total: 1, success: 1, failed: 0, skipped: 0,
            items: [{ name: 'Argo Smart Routing', status: 'success' }],
          });
        } else {
          logWithProgress('  ⏭ Argo Smart Routing: not available on destination (no entitlement)');
          report.warnings.push('Argo Smart Routing is enabled on source but not available on destination. Subscribe to Argo on the destination account.');
          report.sections.push({
            name: 'Argo Smart Routing', total: 1, success: 0, failed: 0, skipped: 1,
            items: [{ name: 'Argo Smart Routing', status: 'skipped', error: 'Destination zone lacks Argo entitlement — subscribe to Argo on the destination account to enable' }],
          });
        }
      } catch (e) {
        const err = (e as Error).message;
        logWithProgress(`  ❌ Argo Smart Routing: ${err}`);
        report.sections.push({
          name: 'Argo Smart Routing', total: 1, success: 0, failed: 1, skipped: 0,
          items: [{ name: 'Argo Smart Routing', status: 'failed', error: err }],
        });
        report.errors.push({
          resource: 'Argo Smart Routing', name: 'Argo Smart Routing', error: err,
          suggestion: 'Argo Smart Routing requires an active subscription on the destination zone.',
          category: 'billing',
        });
      }
    }

    // Tiered Caching
    if (hasTieredCaching) {
      try {
        const destTiered = await api.getArgoTieredCaching(destAuth, destZoneId);
        if (destTiered) {
          logWithProgress(`  PATCH /zones/${destZoneId}/argo/tiered_caching`);
          await api.updateArgoTieredCaching(destAuth, destZoneId, 'on');
          logWithProgress('  ✓ Tiered Caching: enabled on destination');
          report.sections.push({
            name: 'Tiered Caching', total: 1, success: 1, failed: 0, skipped: 0,
            items: [{ name: 'Tiered Caching', status: 'success' }],
          });
        } else {
          logWithProgress('  ⏭ Tiered Caching: not available on destination (no entitlement)');
          report.warnings.push('Tiered Caching is enabled on source but not available on destination. Tiered Caching requires Pro+ or an Argo subscription.');
          report.sections.push({
            name: 'Tiered Caching', total: 1, success: 0, failed: 0, skipped: 1,
            items: [{ name: 'Tiered Caching', status: 'skipped', error: 'Destination zone lacks entitlement — requires Pro+ plan or Argo subscription' }],
          });
        }
      } catch (e) {
        const err = (e as Error).message;
        logWithProgress(`  ❌ Tiered Caching: ${err}`);
        report.sections.push({
          name: 'Tiered Caching', total: 1, success: 0, failed: 1, skipped: 0,
          items: [{ name: 'Tiered Caching', status: 'failed', error: err }],
        });
        report.errors.push({
          resource: 'Tiered Caching', name: 'Tiered Caching', error: err,
          suggestion: 'Tiered Caching requires Pro+ plan or an Argo subscription.',
          category: 'billing',
        });
      }
    }

    // Bot Management (covers BFM, SBFM, and Enterprise Bot Management)
    if (hasBotManagement && exportData.botManagement) {
      try {
        const destBot = await api.getBotManagement(destAuth, destZoneId);
        if (destBot) {
          // Entitlement exists — write the source config to destination.
          // Only include fields that were set on source to avoid overwriting defaults.
          const botConfig: api.BotManagementConfig = {};
          const src = exportData.botManagement;
          if (src.fight_mode !== undefined) botConfig.fight_mode = src.fight_mode;
          if (src.enable_js !== undefined) botConfig.enable_js = src.enable_js;
          if (src.sbfm_definitely_automated !== undefined) botConfig.sbfm_definitely_automated = src.sbfm_definitely_automated;
          if (src.sbfm_likely_automated !== undefined) botConfig.sbfm_likely_automated = src.sbfm_likely_automated;
          if (src.sbfm_verified_bots !== undefined) botConfig.sbfm_verified_bots = src.sbfm_verified_bots;
          if (src.sbfm_static_resource_protection !== undefined) botConfig.sbfm_static_resource_protection = src.sbfm_static_resource_protection;
          if (src.suppress_session_score !== undefined) botConfig.suppress_session_score = src.suppress_session_score;
          if (src.optimize_wordpress !== undefined) botConfig.optimize_wordpress = src.optimize_wordpress;
          if (src.auto_update_model !== undefined) botConfig.auto_update_model = src.auto_update_model;
          if (src.ai_bots_protection !== undefined) botConfig.ai_bots_protection = src.ai_bots_protection;

          logWithProgress(`  PUT /zones/${destZoneId}/bot_management`);
          await api.updateBotManagement(destAuth, destZoneId, botConfig);
          logWithProgress('  ✓ Bot Management: config migrated to destination');
          report.sections.push({
            name: 'Bot Management', total: 1, success: 1, failed: 0, skipped: 0,
            items: [{ name: 'Bot Management Config', status: 'success' }],
          });
        } else {
          logWithProgress('  ⏭ Bot Management: not available on destination (no entitlement)');
          report.warnings.push('Bot Management config exists on source but the destination zone does not have Bot Management access. BFM is available on all plans; SBFM requires Pro+; Enterprise Bot Management requires an add-on.');
          report.sections.push({
            name: 'Bot Management', total: 1, success: 0, failed: 0, skipped: 1,
            items: [{ name: 'Bot Management Config', status: 'skipped', error: 'Destination zone lacks Bot Management access — BFM is free, SBFM requires Pro+, Enterprise BM requires add-on' }],
          });
        }
      } catch (e) {
        const err = (e as Error).message;
        // The destination zone reports Bot Management as present (BFM is on
        // every plan), but PUTting SBFM/Enterprise fields on a lower-tier dest
        // returns an entitlement error like "zone not entitled to enable
        // likely automated bots ruleset". The user can't fix this with the
        // migration tool — it needs a plan upgrade / Bot Management add-on on
        // the dest. Per Principle 2 (entitlement → acknowledged, not failed),
        // surface this as acknowledged rather than a red failure.
        if (isManualActionError(err)) {
          logWithProgress(`  🟡 Bot Management: acknowledged (${err})`);
          report.sections.push({
            name: 'Bot Management', total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1,
            items: [{ name: 'Bot Management Config', status: 'acknowledged', error: err }],
          });
          report.warnings.push(`Bot Management config could not be fully applied on the destination: ${err}. Bot Fight Mode is available on all plans; Super Bot Fight Mode requires Pro+; Enterprise Bot Management requires an add-on subscription.`);
        } else {
          logWithProgress(`  ❌ Bot Management: ${err}`);
          report.sections.push({
            name: 'Bot Management', total: 1, success: 0, failed: 1, skipped: 0,
            items: [{ name: 'Bot Management Config', status: 'failed', error: err }],
          });
          report.errors.push({
            resource: 'Bot Management', name: 'Bot Management Config', error: err,
            suggestion: 'Bot Fight Mode is available on all plans. Super Bot Fight Mode requires Pro+. Enterprise Bot Management requires a separate add-on subscription.',
            category: 'billing',
          });
        }
      }
    }

    logWithProgress('✓ Batch 5 complete');
  }
}
