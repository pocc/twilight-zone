// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// AI Gateway (account-scoped).
//
// Gateway configs (rate limiting, caching, log management, etc.) + custom
// providers (slug + base_url) migrate end-to-end.
//
// API keys for custom providers no longer have to be a manual-action
// item. When the user supplies
// a key via the Step 2 inline fix-it form, the migrator creates a
// corresponding Cloudflare Secrets Store secret with
// `scopes: ["ai_gateway"]` so the dest account's worker code can
// reference it via the BYOK mechanism. The migrator still emits a
// per-provider manual-action message about updating worker code
// references — the secret name on dest is the provider slug, but
// user code may have hardcoded the previous secret reference.

import type { MigrationReport, ZoneExport, ReportSection } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';

export interface AiGatewayDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
  resolveConflict: (cat: string, name: string) => Promise<'overwrite' | 'skip'>;
  /** Bucket 2.4: API keys for custom providers, keyed by source
   * provider slug. */
  aiGatewayProviderApiKeys?: Record<string, string>;
}

/** Resolve the account's default Secrets Store ID. Per the spike,
 * each account has a `default_secrets_store` auto-created on first
 * reference. We list and pick the first; if none exists yet, we
 * return null and the caller falls back to the manual-action path. */
async function resolveDefaultSecretsStoreId(
  auth: api.ApiAuth | string,
  accountId: string,
  log: LogFn,
): Promise<string | null> {
  try {
    const stores = await api.listSecretsStoreStores(auth, accountId);
    const first = stores[0];
    return first?.id ?? null;
  } catch (e) {
    log(`    ⚠ Could not list Secrets Stores on dest account: ${(e as Error).message}. Falling back to manual-action prompt for AI Gateway API keys.`);
    return null;
  }
}

export async function migrateAiGateways(
  exportData: ZoneExport,
  report: MigrationReport,
  deps: AiGatewayDeps,
): Promise<void> {
  const { destAuth, destAccountId, log, trackSection, onItemDone, resolveConflict, aiGatewayProviderApiKeys } = deps;

  if (Array.isArray(exportData.aiGateways) && exportData.aiGateways.length > 0) {
    log('⏳ AI Gateways...');
    const sec = await migrateItems('AI Gateways', exportData.aiGateways, async (g) => {
      try {
        await api.createAiGateway(destAuth, destAccountId, g);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
          const strategy = await resolveConflict('storage', g.id);
          if (strategy === 'skip') throw e;
          log(`    ✓ AI Gateway "${g.id}" already exists`);
          return;
        }
        throw e;
      }
    }, (g) => g.id, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/ai-gateway/gateways`);
    report.sections.push(trackSection(sec));
  }

  if (Array.isArray(exportData.aiGatewayCustomProviders) && exportData.aiGatewayCustomProviders.length > 0) {
    log('⏳ AI Gateway Custom Providers...');

    // Resolve the default Secrets Store ID ONCE up front (rather
    // than per-provider) so we make at most one list call.
    let secretsStoreId: string | null = null;
    const anyKeysSupplied = aiGatewayProviderApiKeys
      ? Object.values(aiGatewayProviderApiKeys).some(v => typeof v === 'string' && v.length > 0)
      : false;
    if (anyKeysSupplied) {
      secretsStoreId = await resolveDefaultSecretsStoreId(destAuth, destAccountId, log);
      if (!secretsStoreId) {
        log('    ⚠ No Secrets Store on dest account; API keys will fall back to manual-action prompts.');
      }
    }

    const providersWithoutKey: string[] = [];

    const sec = await migrateItems('AI Gateway Custom Providers', exportData.aiGatewayCustomProviders, async (p) => {
      try {
        await api.createAiGatewayCustomProvider(destAuth, destAccountId, p);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
          const strategy = await resolveConflict('storage', p.slug);
          if (strategy === 'skip') throw e;
          log(`    ✓ AI Gateway custom provider "${p.slug}" already exists`);
          // Fall through to the secret-store logic below — the
          // provider exists, the user may still want their key
          // attached.
        } else {
          throw e;
        }
      }

      // Bucket 2.4: if the user supplied an API key for this
      // provider AND we have a Secrets Store to put it in, create
      // the secret. Otherwise emit the manual-action prompt.
      const userKey = aiGatewayProviderApiKeys?.[p.slug];
      const hasKey = typeof userKey === 'string' && userKey.length > 0;
      if (hasKey && secretsStoreId) {
        try {
          await api.createSecretsStoreSecret(destAuth, destAccountId, secretsStoreId, {
            // The secret name mirrors the provider slug for
            // predictability — user code referencing the dest
            // provider should reference this secret name in
            // cf-aig-authorization headers (or via BYOK config in
            // the dashboard).
            name: `ai_gateway_${p.slug}`,
            value: userKey,
            scopes: ['ai_gateway'],
            comment: `API key for AI Gateway custom provider "${p.name}" (slug: ${p.slug}). Migrated from source account by twilight-zone.`,
          });
          log(`    ✓ Stored API key for "${p.slug}" in Secrets Store (scope: ai_gateway)`);
        } catch (e) {
          // Secret-creation failure is logged but doesn't fail the
          // provider migration — the provider itself is fine, the
          // user just has to re-add the key manually.
          const msg = (e as Error).message || String(e);
          log(`    ⚠ Could not create Secrets Store secret for "${p.slug}": ${msg}. Falling back to manual-action.`);
          providersWithoutKey.push(p.slug);
        }
      } else if (hasKey && !secretsStoreId) {
        // User supplied a key but we have no store — treat as
        // missing.
        providersWithoutKey.push(p.slug);
      } else {
        // No user key supplied — preserve prior behaviour.
        providersWithoutKey.push(p.slug);
      }
    }, (p) => p.slug, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/ai-gateway/custom-providers`);
    report.sections.push(trackSection(sec));

    // Per-provider manual actions:
    //
    // (a) For providers whose API key was NOT supplied (or the
    //     Secrets Store write failed): the existing "re-add API
    //     key" prompt.
    // (b) For ALL providers (even ones with keys supplied): worker
    //     code that references the source-account provider may
    //     have hardcoded the previous secret reference. The user
    //     should update those references to point at the dest-
    //     account secret.
    for (const slug of providersWithoutKey) {
      const provider = exportData.aiGatewayCustomProviders.find(x => x.slug === slug);
      const label = provider?.name || slug;
      report.manualActions.push(
        `AI Gateway Custom Provider "${label}" (slug: ${slug}): re-add the API key on the destination account at ` +
        `Dashboard → AI → AI Gateway → Custom Providers → "${slug}" → Authentication. ` +
        `The provider config migrated but the auth credential is write-only and did NOT.`,
      );
    }
    // Always nudge about worker code references — this is a
    // bucket-2.4-specific concern that applies even when the key
    // was successfully migrated.
    if (exportData.aiGatewayCustomProviders.length > 0) {
      report.manualActions.push(
        `Update worker code that references AI Gateway custom providers to use the dest account's secret names (now stored in Secrets Store with scope "ai_gateway"). ` +
        `The migration tool cannot update worker source for you. See https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/ for the cf-aig-authorization header pattern.`,
      );
    }
  }
}
