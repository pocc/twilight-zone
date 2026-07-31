/**
 * API v1 — Pure JSON, non-streaming API for programmatic access.
 *
 * All endpoints accept POST with JSON body and return JSON responses.
 * No SSE, no interactive prompts. Designed for CLI tools, scripts, and CI/CD.
 *
 * Auth is passed per-request in the body (same format as the UI endpoints).
 * Conflicts default to the `conflictStrategy` field ("skip" | "overwrite", default "skip").
 */
import type { MigrationConfig, MigrationReport, CertificateInput, ZoneExport } from '../types';
import { exportZone, migrateZone, migrateAccountResources, generateReportMarkdown, generateDryRunPreview, filterExportData } from '../migrate';
import { validateDryRun, getMigrationPhases } from '../validator';
import { parseAuth, isAuthError, AuthBody, validateIds, validateDomains, safeError, isSafePathSegment } from '../utils';
import * as api from '../api';
import { generateTerraformFiles, generateTerraformBundle, terraformExportSummary } from '../terraform';
import { exportZoneTroubleshooting } from '../troubleshooting-export';
import { logMigrationRun, logRollbackRun, type RunLogBindings, type WaitUntilContext } from '../migrate/run-log';
import { APP_VERSION } from './version';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ── Route Dispatcher ────────────────────────────────────────────

export async function handleV1Route(
  pathname: string,
  request: Request,
  env?: RunLogBindings,
  ctx?: WaitUntilContext,
): Promise<Response | null> {
  // Strip the /api/v1 prefix
  const route = pathname.replace('/api/v1', '');

  switch (route) {
    case '':
    case '/':
    case '/docs':
      return handleDocs(request);
    case '/validate-token':
      return handleValidateToken(request);
    case '/accounts':
      return handleListAccounts(request);
    case '/zones':
      return handleListZones(request);
    case '/export':
      return handleExport(request);
    case '/export/troubleshooting':
      return handleExportTroubleshooting(request);
    case '/check-blockers':
      return handleCheckBlockers(request);
    case '/check-capabilities':
      return handleCheckCapabilities(request);
    case '/available-plans':
      return handleAvailablePlans(request);
    case '/validate':
      return handleValidate(request);
    case '/migrate':
      return handleMigrate(request, env, ctx);
    case '/migrate/account-resources':
      return handleMigrateAccountResources(request, env, ctx);
    case '/rollback':
      return handleRollback(request, env, ctx);
    case '/terraform/export':
      return handleTerraformExport(request);
    default:
      return null; // Not a v1 route
  }
}

// ── API Documentation ───────────────────────────────────────────

function handleDocs(_request: Request): Response {
  const docs = {
    name: 'Twilight Zone API',
    version: '1.0.0',
    description: 'Non-streaming JSON API for Cloudflare zone migration. All endpoints accept POST with JSON body unless noted.',
    baseUrl: '/api/v1',
    authentication: {
      description: 'Auth credentials are passed in the request body (not headers). Two modes are supported.',
      modes: {
        apiToken: {
          description: 'Use a Cloudflare API token with appropriate permissions.',
          bodyFields: {
            token: 'string — API token (used for both source and dest if sourceToken/destToken not set)',
            sourceToken: 'string — Source-specific token (optional, overrides token)',
            destToken: 'string — Destination-specific token (optional, overrides token)',
          },
        },
        apiKey: {
          description: 'Use a Global API Key + email.',
          bodyFields: {
            useApiKey: 'true',
            apiKey: 'string — Global API Key (source)',
            apiEmail: 'string — Account email (source)',
            destApiKey: 'string — Global API Key (dest, optional)',
            destApiEmail: 'string — Account email (dest, optional)',
          },
        },
      },
    },
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/docs',
        description: 'This documentation endpoint.',
      },
      {
        method: 'POST',
        path: '/api/v1/validate-token',
        description: 'Validate a Cloudflare API token or API key + email.',
        body: { token: 'string', or: { useApiKey: true, apiKey: 'string', apiEmail: 'string' } },
        response: { valid: 'boolean', status: 'string', authType: 'string' },
      },
      {
        method: 'POST',
        path: '/api/v1/accounts',
        description: 'List Cloudflare accounts accessible with the provided credentials.',
        body: '(auth fields)',
        response: { accounts: 'Account[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/zones',
        description: 'List zones in a specific account.',
        body: { accountId: 'string', '...auth': '' },
        response: { zones: 'Zone[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/export',
        description: 'Export all resources from a source zone. Returns a full ZoneExport object.',
        body: {
          sourceToken: 'string',
          sourceZoneId: 'string (32-char hex)',
          sourceAccountId: 'string (32-char hex)',
        },
        response: { export: 'ZoneExport', logs: 'string[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/export/troubleshooting',
        description: 'Export zone config in a flat, LLM-friendly format for diagnostics.',
        body: {
          sourceToken: 'string',
          sourceZoneId: 'string (32-char hex)',
          sourceAccountId: 'string (32-char hex)',
        },
        response: { export: 'object' },
      },
      {
        method: 'POST',
        path: '/api/v1/check-blockers',
        description: 'Check for migration blockers between source and destination.',
        body: {
          sourceZoneId: 'string',
          sourceAccountId: 'string',
          destAccountId: 'string',
          domainName: 'string (optional)',
          '...auth': '',
        },
        response: { blockers: 'Blocker[]', warnings: 'Warning[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/check-capabilities',
        description: 'Check which features are available on the destination account.',
        body: { destAccountId: 'string', '...auth': '' },
        response: { capabilities: 'AccountCapabilities' },
      },
      {
        method: 'POST',
        path: '/api/v1/available-plans',
        description: 'List subscribable zone plans for the destination account.',
        body: { destAccountId: 'string', domainName: 'string (optional)', '...auth': '' },
        response: { plans: 'Plan[]', planCounts: 'Record<string, number>' },
      },
      {
        method: 'POST',
        path: '/api/v1/validate',
        description: 'Dry-run validation: export + check what would succeed/fail without making changes.',
        body: {
          sourceZoneId: 'string',
          sourceAccountId: 'string',
          destAccountId: 'string',
          domainName: 'string (optional)',
          '...auth': '',
        },
        response: { valid: 'boolean', issues: 'Issue[]', logs: 'string[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/migrate',
        description: 'Full migration pipeline: export → filter → migrate → validate → report. Non-interactive; all decisions must be provided upfront.',
        body: {
          sourceToken: 'string',
          destToken: 'string',
          sourceZoneId: 'string',
          sourceAccountId: 'string',
          destAccountId: 'string',
          domainName: 'string (optional — domain for destination zone)',
          dryRun: 'boolean (default false)',
          selections: 'Record<string, Record<string, boolean>> (optional — filter which resources to migrate)',
          conflictStrategy: '"skip" | "overwrite" (default "skip")',
          targetPlan: 'string (optional — e.g. "pro", "business")',
          skipAccountResources: 'boolean (optional)',
          acknowledgments: 'string[] (optional — pre-accepted limitation keys)',
          workerSecrets: 'Record<string, Record<string, string>> (optional)',
          customCertificates: '{ certificate: string, privateKey: string }[] (optional)',
          originCaCertificates: '{ hostnames: string[], csr: string, request_type: "origin-rsa"|"origin-ecc", requested_validity: number }[] (optional) — Origin CA re-issuance CSRs',
          notificationWebhookSecrets: 'Record<string, string> (optional) — signing secrets keyed by source webhook name',
          identityProviderSecrets: 'Record<string, string> (optional) — Access IdP client_secret values keyed by source IdP name',
          aopMtlsBundles: '{ name: string, certificates: string, private_key: string, ca?: boolean }[] (optional) — AOP mTLS cert+key bundles to upload + associate with hostnames',
          aiGatewayProviderApiKeys: 'Record<string, string> (optional) — AI Gateway custom provider API keys keyed by source provider slug; stored in Secrets Store on dest with scope "ai_gateway"',
          r2Credentials: '{ source?: { accessKeyId, secretAccessKey }, dest?: { accessKeyId, secretAccessKey } } (optional)',
        },
        response: {
          success: 'boolean',
          report: 'MigrationReport',
          reportMarkdown: 'string',
          auditLog: 'AuditEntry[]',
          logs: 'string[]',
        },
      },
      {
        method: 'POST',
        path: '/api/v1/migrate/account-resources',
        description: 'Pre-deploy account-level resources (workers, storage, LB, Access, Turnstile) before zone migration.',
        body: '(same as /migrate, minus zone-specific fields)',
        response: { report: 'MigrationReport', reportMarkdown: 'string', auditLog: 'AuditEntry[]', logs: 'string[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/rollback',
        description: 'Delete resources created by a previous migration.',
        body: {
          destAccountId: 'string',
          createdResources: '{ zoneId?, workers?, kvNamespaces?, r2Buckets?, d1Databases?, queues? }',
          '...auth': '',
        },
        response: { success: 'boolean', deleted: 'string[]', failed: 'string[]' },
      },
      {
        method: 'POST',
        path: '/api/v1/terraform/export',
        description: 'Generate Terraform HCL files from a zone export.',
        body: {
          sourceToken: 'string',
          sourceZoneId: 'string',
          sourceAccountId: 'string',
          format: '"bundle" | "files" (default "bundle")',
        },
        response: { bundle: 'string (or files: TerraformFile[])', summary: 'TerraformSummary' },
      },
    ],
    examples: {
      minimalMigration: {
        description: 'Migrate a zone with API tokens, skip conflicts, no filtering.',
        curl: `curl -X POST https://twilight-zone.ross.gg/api/v1/migrate \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceToken": "YOUR_SOURCE_TOKEN",
    "destToken": "YOUR_DEST_TOKEN",
    "sourceZoneId": "abc123...",
    "sourceAccountId": "def456...",
    "destAccountId": "ghi789...",
    "domainName": "example.com",
    "conflictStrategy": "skip"
  }'`,
      },
      exportOnly: {
        description: 'Export a zone without migrating.',
        curl: `curl -X POST https://twilight-zone.ross.gg/api/v1/export \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceToken": "YOUR_TOKEN",
    "sourceZoneId": "abc123...",
    "sourceAccountId": "def456..."
  }'`,
      },
      dryRun: {
        description: 'Preview what a migration would do without making changes.',
        curl: `curl -X POST https://twilight-zone.ross.gg/api/v1/migrate \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceToken": "YOUR_SOURCE_TOKEN",
    "destToken": "YOUR_DEST_TOKEN",
    "sourceZoneId": "abc123...",
    "sourceAccountId": "def456...",
    "destAccountId": "ghi789...",
    "dryRun": true
  }'`,
      },
    },
  };

  // Serve as JSON for all requests, pretty-printed for readability
  return new Response(JSON.stringify(docs, null, 2), {
    status: 200,
    headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Token Validation ────────────────────────────────────────────

async function handleValidateToken(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { token?: string; useApiKey?: boolean; apiKey?: string; apiEmail?: string };
    if (body.useApiKey && body.apiKey && body.apiEmail) {
      try {
        const auth: api.ApiAuth = { type: 'key', apiKey: body.apiKey.trim(), email: body.apiEmail.trim() };
        await api.listAccountsWithAuth(auth);
        return json({ valid: true, status: 'active', authType: 'api_key' });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const isNetwork = err.name === 'AbortError' || /timed out|fetch failed|network/i.test(err.message);
        return json({
          valid: false,
          status: isNetwork ? 'network_error' : 'invalid',
          error: err.message || 'Invalid API key or email',
          authType: 'api_key',
        });
      }
    }
    if (!body.token) return error('No token provided');
    const result = await api.verifyToken(body.token.trim());
    return json({ ...result, authType: 'token' });
  } catch (e: unknown) {
    return json({ valid: false, ...safeError(e) });
  }
}

// ── Accounts ────────────────────────────────────────────────────

async function handleListAccounts(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody;
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    const accounts = await api.listAccountsWithAuth(auth);
    return json({ accounts });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Zones ───────────────────────────────────────────────────────

async function handleListZones(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { accountId: string };
    const accountId = body.accountId?.trim();
    {
      const idErr = validateIds({ accountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    const zones = await api.listAccountZonesWithAuth(auth, accountId);
    return json({ zones });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Export ───────────────────────────────────────────────────────

async function handleExport(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    if (!hasApiKey && !body.sourceToken) return error('Either API token or API key + email required');

    const config: MigrationConfig = {
      sourceToken: body.sourceToken || '', destToken: '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: '', dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const logs: string[] = [];
    const exportData = await exportZone(config, (msg) => logs.push(msg));
    return json({ export: exportData, logs });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Export Troubleshooting ───────────────────────────────────────

async function handleExportTroubleshooting(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    if (!hasApiKey && !body.sourceToken) return error('Either API token or API key + email required');

    const logs: string[] = [];
    const exportData = await exportZoneTroubleshooting(body, (msg) => logs.push(msg));
    return json({ export: exportData, logs });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Check Blockers ──────────────────────────────────────────────

async function handleCheckBlockers(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      sourceZoneId: string; sourceAccountId: string; destAccountId: string; domainName?: string;
      destApiKey?: string; destApiEmail?: string; destToken?: string;
    };
    const sourceAuth = parseAuth(body);
    if (isAuthError(sourceAuth)) return error(sourceAuth.error);
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId, destAccountId: body.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return error(domErr.message);
    }

    let destAuth: api.ApiAuth | string = sourceAuth;
    if (body.useApiKey && body.destApiKey && body.destApiEmail) {
      destAuth = { type: 'key', apiKey: body.destApiKey.trim(), email: body.destApiEmail.trim() };
    } else if (body.destToken) {
      destAuth = { type: 'token', token: body.destToken.trim() };
    }

    const result = await api.checkMigrationBlockers(sourceAuth, destAuth, body.sourceZoneId, body.sourceAccountId, body.destAccountId, body.domainName);
    return json(result);
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Check Capabilities ──────────────────────────────────────────

async function handleCheckCapabilities(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }

    const [capabilities, existingTurnstileWidgets] = await Promise.all([
      api.checkAccountCapabilities(auth, body.destAccountId),
      api.listTurnstileWidgets(auth, body.destAccountId).catch(() => []),
    ]);

    return json({
      capabilities,
      existingTurnstileWidgets: existingTurnstileWidgets.map(w => w.name),
    });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Available Plans ─────────────────────────────────────────────

async function handleAvailablePlans(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string; domainName?: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return error(domErr.message);
    }

    const zones = await api.listAccountZonesWithAuth(auth, body.destAccountId);
    let zoneId: string | null = null;
    if (body.domainName) {
      const targetZone = zones.find((z: { name: string; id: string }) => z.name === body.domainName);
      if (targetZone) zoneId = targetZone.id;
    }
    if (!zoneId && zones.length > 0) zoneId = zones[0].id;
    if (!zoneId) return error('No zones found in destination account to query available plans');

    const plans = await api.getAvailablePlans(auth, zoneId);
    const subscribable = plans
      .filter((p: api.AvailableRatePlan) => p.can_subscribe)
      .map((p: api.AvailableRatePlan) => ({
        id: p.id, name: p.name, price: p.price, currency: p.currency,
        frequency: p.frequency, legacy_id: p.legacy_id, is_subscribed: p.is_subscribed,
      }));

    const planCounts: Record<string, number> = { free: 0, pro: 0, business: 0, enterprise: 0 };
    for (const z of zones) {
      const zoneAny = z as { plan?: { legacy_id?: string; name?: string } };
      const legacyId = zoneAny.plan?.legacy_id?.toLowerCase() || '';
      const planName = zoneAny.plan?.name?.toLowerCase() || '';
      if (legacyId === 'enterprise' || planName.includes('enterprise')) planCounts.enterprise++;
      else if (legacyId === 'business' || planName.includes('business')) planCounts.business++;
      else if (legacyId === 'pro' || planName.includes('pro')) planCounts.pro++;
      else planCounts.free++;
    }

    return json({ plans: subscribable, planCounts });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Validate (dry-run) ──────────────────────────────────────────

async function handleValidate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      sourceZoneId: string; sourceAccountId: string; destAccountId: string; domainName?: string;
    };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId, destAccountId: body.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return error(domErr.message);
    }

    const config: MigrationConfig = {
      sourceToken: body.token || '', destToken: body.token || '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: body.destAccountId, dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const logs: string[] = [];
    const exportData = await exportZone(config, (msg) => logs.push(msg));
    const destZoneName = body.domainName || exportData.zone.name;
    const result = await validateDryRun(exportData, auth, body.destAccountId, destZoneName, (msg) => logs.push(msg));
    const phases = getMigrationPhases();

    return json({
      ...result, logs, phases,
      exportSummary: {
        zoneName: exportData.zone.name, plan: exportData.zone.plan.name,
        dnsRecords: exportData.dnsRecords.length, workers: exportData.workers.length,
        loadBalancers: exportData.loadBalancers.length, customHostnames: exportData.customHostnames.length,
      },
    });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Migrate ─────────────────────────────────────────────────────

async function handleMigrate(request: Request, env?: RunLogBindings, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const body = await request.json() as MigrationConfig & {
      customCertificates?: CertificateInput[];
      workerSecrets?: Record<string, Record<string, string>>;
      selections?: Record<string, Record<string, boolean>>;
      conflictStrategy?: 'skip' | 'overwrite';
      doMigration?: MigrationConfig['doMigration'];
    };

    const config: MigrationConfig = {
      sourceToken: body.sourceToken,
      destToken: body.destToken,
      sourceZoneId: body.sourceZoneId,
      sourceAccountId: body.sourceAccountId,
      destAccountId: body.destAccountId,
      domainName: body.domainName,
      dryRun: body.dryRun || false,
      customCertificates: body.customCertificates,
      workerSecrets: body.workerSecrets,
      // Bucket 1 (originCaCertificates) + bucket 2.1-2.4.
      originCaCertificates: body.originCaCertificates,
      notificationWebhookSecrets: body.notificationWebhookSecrets,
      identityProviderSecrets: body.identityProviderSecrets,
      aopMtlsBundles: body.aopMtlsBundles,
      aiGatewayProviderApiKeys: body.aiGatewayProviderApiKeys,
      useApiKey: body.useApiKey,
      apiKey: body.apiKey,
      apiEmail: body.apiEmail,
      destApiKey: body.destApiKey,
      destApiEmail: body.destApiEmail,
      selections: body.selections,
      doMigration: body.doMigration,
      targetPlan: body.targetPlan,
      conflictStrategy: body.conflictStrategy || 'skip',
      skipAccountResources: body.skipAccountResources,
      r2Credentials: body.r2Credentials,
      acknowledgments: body.acknowledgments,
      skippedEmailAddresses: body.skippedEmailAddresses,
    };

    const hasApiKey = config.useApiKey && (config.apiKey && config.apiEmail || config.destApiKey && config.destApiEmail);
    const hasTokens = config.sourceToken && config.destToken;

    {
      const idErr = validateIds({ sourceZoneId: config.sourceZoneId, sourceAccountId: config.sourceAccountId, destAccountId: config.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    {
      const domErr = validateDomains({ domainName: config.domainName });
      if (domErr) return error(domErr.message);
    }
    if (!hasApiKey && !hasTokens) {
      return error('Either API tokens (sourceToken + destToken) or API key + email required');
    }

    api.clearAuditLog();
    const logs: string[] = [];
    const log = (message: string) => { logs.push(message); };

    // 1. Export
    const rawExportData = await exportZone(config, log);

    // 2. Filter by selections
    const exportData = filterExportData(rawExportData, config.selections);
    if (config.selections) {
      log('Applied selection filters');
    }

    // 3. Dry run?
    if (config.dryRun) {
      const destZoneName = config.domainName || exportData.zone.name;
      const preview = generateDryRunPreview(exportData, config.destAccountId, destZoneName);
      const auditLog = api.getAuditLog();

      return json({
        success: true,
        dryRun: true,
        preview: {
          apiCalls: preview.apiCalls,
          summary: preview.summary,
        },
        export: exportData,
        report: {
          timestamp: new Date().toISOString(),
          sourceZone: exportData.zone.name,
          destZone: destZoneName,
          destAccountId: config.destAccountId,
          summary: { total: preview.summary.total, success: 0, failed: 0, skipped: 0 },
          sections: [], errors: [], conflicts: [], warnings: [], manualActions: [], newNameservers: [],
        },
        auditLog,
        logs,
      });
    }

    // 4. Migrate (no promptUser — uses conflictStrategy from config, defaults to 'skip')
    // Pass `rawExportData` so deselected groups surface as acknowledgments
    // in the report (Principle 1: No Surprise Failures — see migrate.ts
    // `computeDeselectedGroups`).
    const report = await migrateZone(config, exportData, log, undefined, rawExportData);
    const reportMarkdown = generateReportMarkdown(report);
    const auditLog = api.getAuditLog();
    await logMigrationRun(env, ctx, report, { kind: 'zone', toolVersion: APP_VERSION });

    return json({
      success: true,
      report,
      reportMarkdown,
      auditLog,
      logs,
    });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Migrate Account Resources ───────────────────────────────────

async function handleMigrateAccountResources(request: Request, env?: RunLogBindings, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const body = await request.json() as MigrationConfig & {
      workerSecrets?: Record<string, Record<string, string>>;
      selections?: Record<string, Record<string, boolean>>;
    };

    const config: MigrationConfig = {
      sourceToken: body.sourceToken,
      destToken: body.destToken,
      sourceZoneId: body.sourceZoneId,
      sourceAccountId: body.sourceAccountId,
      destAccountId: body.destAccountId,
      domainName: body.domainName,
      dryRun: false,
      workerSecrets: body.workerSecrets,
      useApiKey: body.useApiKey,
      apiKey: body.apiKey,
      apiEmail: body.apiEmail,
      destApiKey: body.destApiKey,
      destApiEmail: body.destApiEmail,
      selections: body.selections,
      conflictStrategy: body.conflictStrategy || 'skip',
      r2Credentials: body.r2Credentials,
    };

    const hasApiKey = config.useApiKey && (config.apiKey && config.apiEmail || config.destApiKey && config.destApiEmail);
    const hasTokens = config.sourceToken && config.destToken;

    {
      const idErr = validateIds({ sourceZoneId: config.sourceZoneId, sourceAccountId: config.sourceAccountId, destAccountId: config.destAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    {
      const domErr = validateDomains({ domainName: config.domainName });
      if (domErr) return error(domErr.message);
    }
    if (!hasApiKey && !hasTokens) {
      return error('Either API tokens or API key + email required');
    }

    api.clearAuditLog();
    const logs: string[] = [];
    const log = (message: string) => { logs.push(message); };

    const rawExportData = await exportZone(config, log);
    const exportData = filterExportData(rawExportData, config.selections);
    const report = await migrateAccountResources(config, exportData, log);
    const reportMarkdown = generateReportMarkdown(report);
    const auditLog = api.getAuditLog();
    await logMigrationRun(env, ctx, report, { kind: 'account-resources', toolVersion: APP_VERSION });

    return json({ success: true, report, reportMarkdown, auditLog, logs });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}

// ── Rollback ────────────────────────────────────────────────────

async function handleRollback(request: Request, env?: RunLogBindings, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      destAccountId?: string;
      createdResources: {
        zoneId?: string; workers?: string[]; kvNamespaces?: string[];
        r2Buckets?: string[]; d1Databases?: string[]; queues?: string[];
      };
    };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return error(auth.error);
    const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
    if (idErr) return error(idErr.message);
    const destAccountId = body.destAccountId!;

    const resources = body.createdResources || {};
    const deleted: string[] = [];
    const failed: string[] = [];

    // Reject any caller-supplied identifier that could traverse to a different
    // API path before it reaches a delete call (defence-in-depth alongside the
    // encodeURIComponent wrapping in the api.delete* builders).
    const runDelete = async (
      kind: string,
      id: string | undefined,
      del: (value: string) => Promise<void>,
    ): Promise<void> => {
      if (id === undefined) return;
      if (!isSafePathSegment(id)) {
        failed.push(`${kind}: ${id} - rejected: invalid identifier`);
        return;
      }
      try { await del(id); deleted.push(`${kind}: ${id}`); }
      catch (e) { failed.push(`${kind}: ${id} - ${(e as Error).message}`); }
    };

    await runDelete('Zone', resources.zoneId, (z) => api.deleteZone(auth, z));
    for (const worker of resources.workers || []) {
      await runDelete('Worker', worker, (w) => api.deleteWorker(auth, destAccountId, w));
    }
    for (const kvId of resources.kvNamespaces || []) {
      await runDelete('KV Namespace', kvId, (k) => api.deleteKVNamespace(auth, destAccountId, k));
    }
    for (const bucket of resources.r2Buckets || []) {
      await runDelete('R2 Bucket', bucket, (b) => api.deleteR2Bucket(auth, destAccountId, b));
    }
    for (const dbId of resources.d1Databases || []) {
      await runDelete('D1 Database', dbId, (d) => api.deleteD1Database(auth, destAccountId, d));
    }
    for (const queueId of resources.queues || []) {
      await runDelete('Queue', queueId, (q) => api.deleteQueue(auth, destAccountId, q));
    }

    logRollbackRun(env, ctx, {
      destAccountId,
      deleted: deleted.length,
      failed: failed.length,
      toolVersion: APP_VERSION,
    });

    return json({ success: true, deleted, failed });
  } catch (e: unknown) {
    return json({ success: false, ...safeError(e) }, 500);
  }
}

// ── Terraform Export ────────────────────────────────────────────

async function handleTerraformExport(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
      format?: 'bundle' | 'files';
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return error(idErr.message);
    }
    if (!hasApiKey && !body.sourceToken) return error('Either API token or API key + email required');

    const config: MigrationConfig = {
      sourceToken: body.sourceToken || '', destToken: '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: '', dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const logs: string[] = [];
    const exportData = await exportZone(config, (msg) => logs.push(msg));

    if (body.format === 'files') {
      const files = generateTerraformFiles(exportData);
      const summary = terraformExportSummary(exportData);
      return json({ files, summary, logs });
    }
    const bundle = generateTerraformBundle(exportData);
    const summary = terraformExportSummary(exportData);
    return json({ bundle, summary, logs });
  } catch (e: unknown) {
    return json(safeError(e), 500);
  }
}
