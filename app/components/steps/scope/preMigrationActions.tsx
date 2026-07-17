import type { AccountCapabilities } from '../../../lib/api';
import type {
  CFWorkerScript, CFWorkerBinding, CFCustomCertificate,
  CFR2Bucket, CFKVNamespace, CFD1Database, CFQueue, CFZoneSetting,
} from '../../../../src/types';
import { ENTERPRISE_GATED_ZONE_SETTINGS } from '../../../../src/types';

// ── Detectable pre-migration actions ─────────────────────────
interface PreMigrationAction {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /** Exact shell commands the user should run (rendered as copyable code blocks) */
  commands?: string[];
  /** Structured list of missing dependencies (rendered as scrollbox) */
  missingItems?: { workerName: string; type: string; name: string }[];
  severity: 'warning' | 'info';
  /** Group keys + item IDs affected - used to deselect */
  affected: { groupKey: string; itemIds: string[] }[];
  /** True if at least one affected item is currently selected */
  active: boolean;
  /**
   * When true, this action GATES "Continue to Migration": the user must
   * either tick its acknowledgement checkbox, deselect the affected items,
   * or select the missing resources above (which removes the action).
   *
   * Reserve this ONLY for genuinely irreversible pre-migration decisions that
   * the tool consumes at migrate time. Deferrable manual work (data reseeds,
   * plan-gated settings, registrar/DNSSEC steps) must NOT gate — it is
   * disclosed non-blockingly and performed on the Apply step (AGENTS.md
   * Principle 4). No detector currently sets this; the gating plumbing is kept
   * for future genuinely-blocking cases.
   */
  requiresAck?: boolean;
  /** Custom checkbox label. Defaults to "I have run these commands". */
  ackLabel?: string;
}

/**
 * Is an enterprise-gated zone setting "enabled" on the source? On/off
 * toggles are enabled when 'on'; arrays/strings/objects when non-empty;
 * numbers when > 0. Anything that reads as off/empty/null is not enabled
 * (so it won't gate — nothing meaningful would carry over anyway).
 */
function isEnterpriseSettingActive(value: unknown): boolean {
  if (value === 'on') return true;
  if (value === 'off' || value === '' || value === false || value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value.toLowerCase() !== 'off';
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

export function detectPreMigrationActions(
  data: any,
  selections: Record<string, Record<string, boolean>>,
  capabilities?: AccountCapabilities | null,
  sourceAccountId?: string,
  destAccountId?: string,
  selectedPlan?: string | null,
): PreMigrationAction[] {
  const actions: PreMigrationAction[] = [];

  const isAnySelected = (groupKey: string, ids: string[]): boolean =>
    ids.some(id => selections[groupKey]?.[id]);

  // D1 Databases - handled inline via d1Configs (no pre-migration action card needed)

  // R2 Buckets - data migration handled inline via r2Credentials (no pre-migration action card needed)

  // Workers with analytics_engine bindings - will fail if AE not enabled
  if (capabilities && !capabilities.analyticsEngine.available) {
    const workers = (data.workers || []).filter((w: CFWorkerScript) =>
      (w.bindings || []).some((b: CFWorkerBinding) => b.type === 'analytics_engine'),
    );
    if (workers.length > 0) {
      const zoneIds = workers.filter((w: CFWorkerScript & { isAccountLevel?: boolean }) => !w.isAccountLevel).map((w: CFWorkerScript) => w.id);
      const acctIds = workers.filter((w: CFWorkerScript & { isAccountLevel?: boolean }) => w.isAccountLevel).map((w: CFWorkerScript) => w.id);
      const affected: { groupKey: string; itemIds: string[] }[] = [];
      if (zoneIds.length > 0) affected.push({ groupKey: 'zoneWorkers', itemIds: zoneIds });
      if (acctIds.length > 0) affected.push({ groupKey: 'workers', itemIds: acctIds });
      actions.push({
        id: 'analytics-engine',
        icon: '\u{1F4CA}',
        title: `${workers.length} worker${workers.length > 1 ? 's' : ''} require Analytics Engine`,
        detail:
          'Analytics Engine is not enabled on the destination account. These workers will fail to upload.\n' +
          (capabilities.analyticsEngine.action || 'Enable Analytics Engine in the Cloudflare Dashboard.'),
        severity: 'warning',
        affected,
        active: affected.some(a => isAnySelected(a.groupKey, a.itemIds)),
      });
    }
  }

  // Custom Certificates - private keys can't be read, must provide in Step 3
  const certs = data.customCertificates || [];
  if (certs.length > 0) {
    const ids = certs.map((c: CFCustomCertificate) => c.id);
    actions.push({
      id: 'custom-certs',
      icon: '\u{1F510}',
      title: `${certs.length} custom certificate${certs.length > 1 ? 's' : ''} - private keys required`,
      detail:
        'Private keys cannot be read from the source. You will need to provide certificate + private key PEM pairs in Step 3 for each certificate.',
      severity: 'info',
      affected: [{ groupKey: 'customCertificates', itemIds: ids }],
      active: isAnySelected('customCertificates', ids),
    });
  }

  // Workers with secret_text bindings - secrets can't be read, must provide in Step 3
  const workersWithSecrets = (data.workers || []).filter((w: any) =>
    (w.bindings || []).some((b: any) => b.type === 'secret_text'),
  );
  if (workersWithSecrets.length > 0) {
    const zoneIds = workersWithSecrets.filter((w: CFWorkerScript & { isAccountLevel?: boolean }) => !w.isAccountLevel).map((w: CFWorkerScript) => w.id);
    const acctIds = workersWithSecrets.filter((w: CFWorkerScript & { isAccountLevel?: boolean }) => w.isAccountLevel).map((w: CFWorkerScript) => w.id);
    const affected: { groupKey: string; itemIds: string[] }[] = [];
    if (zoneIds.length > 0) affected.push({ groupKey: 'zoneWorkers', itemIds: zoneIds });
    if (acctIds.length > 0) affected.push({ groupKey: 'workers', itemIds: acctIds });
    const totalSecrets = workersWithSecrets.reduce(
      (sum: number, w: CFWorkerScript) => sum + (w.bindings || []).filter((b: CFWorkerBinding) => b.type === 'secret_text').length,
      0,
    );
    actions.push({
      id: 'worker-secrets',
      icon: '\u{1F511}',
      title: `${workersWithSecrets.length} worker${workersWithSecrets.length > 1 ? 's' : ''} have ${totalSecrets} secret${totalSecrets > 1 ? 's' : ''} that must be provided`,
      detail:
        'Worker secrets cannot be read from the source account. You will be prompted to enter secret values in Step 3. ' +
        'Workers uploaded without secrets may fail at runtime.',
      severity: 'info',
      affected,
      active: affected.some(a => isAnySelected(a.groupKey, a.itemIds)),
    });
  }

  // Workers referencing unselected storage resources (R2, KV, D1, Queues)
  // These will cause the Cloudflare API to reject the worker upload
  const allWorkers = [...(data.workers || [])];
  const selectedR2Names = new Set(
    (data.r2Buckets || []).filter((b: CFR2Bucket) => selections['r2Buckets']?.[b.name]).map((b: CFR2Bucket) => b.name),
  );
  const selectedKvIds = new Set(
    (data.kvNamespaces || []).filter((kv: CFKVNamespace) => selections['kvNamespaces']?.[kv.id]).map((kv: CFKVNamespace) => kv.id),
  );
  const selectedD1Ids = new Set(
    (data.d1Databases || []).filter((d: CFD1Database) => selections['d1Databases']?.[d.uuid]).map((d: CFD1Database) => d.uuid),
  );

  const missingDeps: { workerName: string; workerGroupKey: string; missingType: string; missingName: string }[] = [];
  for (const worker of allWorkers) {
    const wGroupKey = worker.isAccountLevel ? 'workers' : 'zoneWorkers';
    if (!selections[wGroupKey]?.[worker.id]) continue; // worker itself not selected
    for (const b of worker.bindings || []) {
      if (b.type === 'r2_bucket' && b.bucket_name && !selectedR2Names.has(b.bucket_name)) {
        missingDeps.push({ workerName: worker.id, workerGroupKey: wGroupKey, missingType: 'R2 bucket', missingName: b.bucket_name });
      }
      if (b.type === 'kv_namespace' && b.namespace_id && !selectedKvIds.has(b.namespace_id)) {
        missingDeps.push({ workerName: worker.id, workerGroupKey: wGroupKey, missingType: 'KV namespace', missingName: b.name || b.namespace_id });
      }
      if (b.type === 'd1' && b.database_id && !selectedD1Ids.has(b.database_id)) {
        missingDeps.push({ workerName: worker.id, workerGroupKey: wGroupKey, missingType: 'D1 database', missingName: b.name || b.database_id });
      }
      if (b.type === 'queue' && b.queue_name) {
        const queueSelected = (data.queues || []).some((q: CFQueue) => q.queue_name === b.queue_name && selections['queues']?.[q.queue_id]);
        if (!queueSelected) {
          missingDeps.push({ workerName: worker.id, workerGroupKey: wGroupKey, missingType: 'Queue', missingName: b.queue_name });
        }
      }
    }
  }

  if (missingDeps.length > 0) {
    const affected: { groupKey: string; itemIds: string[] }[] = [];
    const zoneIds = missingDeps.filter(d => d.workerGroupKey === 'zoneWorkers').map(d => d.workerName);
    const acctIds = missingDeps.filter(d => d.workerGroupKey === 'workers').map(d => d.workerName);
    if (zoneIds.length > 0) affected.push({ groupKey: 'zoneWorkers', itemIds: [...new Set(zoneIds)] });
    if (acctIds.length > 0) affected.push({ groupKey: 'workers', itemIds: [...new Set(acctIds)] });

    // Structured list for the scrollbox
    const missingItems = missingDeps.map(d => ({ workerName: d.workerName, type: d.missingType, name: d.missingName }));

    // Surface the REAL question now (Principle 3 — this is a pre-migration
    // decision, not a Step 4 report): the two paths diverge at migrate time and
    // can't be chosen later. Disclose that "auto-create" produces an EMPTY
    // resource (Principle 1 / Principle 4 — lead with the consequence), with
    // the type-specific data caveats that actually apply to THIS set. Verified
    // behavior: workers-deploy.ts / batch2.ts auto-create empty KV/R2/D1/Queue;
    // data only carries when the resource is explicitly selected.
    const missingTypes = new Set(missingDeps.map(d => d.missingType));
    const consequences: string[] = [];
    if (missingTypes.has('D1 database')) consequences.push('empty D1 databases have no schema, so queries fail until you apply schema + data with wrangler');
    if (missingTypes.has('R2 bucket')) consequences.push('empty R2 buckets have no objects until you copy them (rclone / S3 API)');
    if (missingTypes.has('KV namespace')) consequences.push('empty KV namespaces return null until you reseed the keys');
    if (missingTypes.has('Queue')) consequences.push('auto-created queues start empty — in-flight messages are not replayed');

    actions.push({
      id: 'missing-storage-deps',
      icon: '\u{26A0}\uFE0F',
      title: `${missingDeps.length} unselected resource${missingDeps.length !== 1 ? 's' : ''} referenced by selected workers`,
      detail:
        'Heads up — best decided before migrating: these selected workers bind to storage that is NOT selected for migration. ' +
        'Select each resource above to migrate it WITH its data, or leave it unselected and the migration will auto-create an EMPTY one so the worker still uploads. ' +
        `If you let them auto-create: ${consequences.join('; ')}. ` +
        'This is recoverable — the source keeps its data, and reseeding is listed as post-migration work on the Apply step.',
      missingItems,
      severity: 'warning',
      affected,
      active: affected.some(a => isAnySelected(a.groupKey, a.itemIds)),
      // NON-BLOCKING disclosure (#9). The auto-create-empty path is not
      // destructive (the source keeps its data; reseed later from the Apply
      // step), so this no longer gates Continue. It stays a loud warning
      // (Principle 9 — surface early) with a Deselect affordance; the actual
      // data copy surfaces as post-migration work (PostMigrationWorkPanel + Apply).
    });
  }

  // Enterprise-gated zone settings vs a non-Enterprise destination plan.
  // When the user picked a known non-Enterprise plan in Step 1, any
  // enterprise-only setting that's ENABLED + editable on the source zone
  // cannot be applied on the destination — the API rejects it and the
  // migrate engine acknowledges it (isAcknowledgeableSingletonError). Surface
  // that proactively as a gate so the user knows BEFORE migrating (Principle
  // 2/3) and can either accept it or pick an Enterprise plan. We only gate
  // when a non-Enterprise plan is actually chosen — an unknown/null or
  // Enterprise plan produces no gate (no false alarms).
  if (selectedPlan && selectedPlan.toLowerCase() !== 'enterprise') {
    const gatedSettings = (data.settings || []).filter(
      (s: CFZoneSetting) =>
        s.editable &&
        ENTERPRISE_GATED_ZONE_SETTINGS.includes(s.id) &&
        isEnterpriseSettingActive(s.value),
    ) as CFZoneSetting[];
    if (gatedSettings.length > 0) {
      const ids = gatedSettings.map(s => s.id);
      const names = ids
        .map(id => id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))
        .join(', ');
      const planLabel = selectedPlan
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      actions.push({
        id: 'enterprise-plan-settings',
        icon: '\u{1F3E2}', // 🏢
        title: `${gatedSettings.length} Enterprise-only setting${gatedSettings.length === 1 ? '' : 's'} won't apply on a ${planLabel} plan`,
        detail:
          `The destination zone is being created on a non-Enterprise (${planLabel}) plan, so these Enterprise-gated ` +
          `settings that are enabled on your source zone will NOT be applied on the destination: ${names}. ` +
          `The destination will use its plan's default for each (the migration acknowledges them — they won't show as failures). ` +
          `To keep them, choose an Enterprise plan in Step 1, or upgrade the plan and re-apply them after migrating.`,
        severity: 'warning',
        affected: [{ groupKey: 'settings', itemIds: ids }],
        active: isAnySelected('settings', ids),
        // NON-BLOCKING disclosure (#9): a plan mismatch is not something the
        // user must accept up-front — the engine already acknowledges these
        // settings (Principle 2, "acknowledged not failed"), so we surface the
        // mismatch loudly but do not gate Continue.
      });
    }
  }

  // Only return actions where at least one affected item is selected
  return actions.filter(a => a.active);
}

export function PreMigrationActionCard({
  action,
  acknowledged,
  onAcknowledge,
  onDeselect,
}: {
  action: PreMigrationAction;
  acknowledged: boolean;
  onAcknowledge: (id: string, value: boolean) => void;
  onDeselect: (affected: { groupKey: string; itemIds: string[] }[]) => void;
}) {
  const isWarning = action.severity === 'warning';

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        isWarning
          ? 'bg-yellow-900/15 border-yellow-700/40'
          : 'bg-blue-900/15 border-blue-700/40'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="text-base mt-0.5 shrink-0">{action.icon}</span>
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium ${isWarning ? 'text-yellow-300' : 'text-blue-300'}`}
          >
            {action.title}
          </div>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-gray-400 font-sans leading-relaxed">
              {action.detail}
            </p>
            {action.missingItems && action.missingItems.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto border border-yellow-700/30 rounded-md bg-gray-900/50">
                <ul className="py-1.5 px-2.5 space-y-0.5">
                  {action.missingItems.map((item, i) => (
                    <li key={i} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                      <span className="text-yellow-400/50 shrink-0">&bull;</span>
                      <span>
                        <span className="text-yellow-300/90 font-medium">{item.workerName}</span>
                        <span className="text-gray-500 mx-1">&rarr;</span>
                        <span className="text-gray-300">{item.type}</span>
                        <span className="text-gray-500 ml-1">&ldquo;{item.name}&rdquo;</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {action.commands && action.commands.length > 0 && (
              <div className="relative">
                <pre className="text-xs bg-[#0d1117] text-[#c9d1d9] px-3 py-2.5 pr-20 rounded font-mono border border-[#30363d] select-all whitespace-pre-wrap leading-relaxed">
                  {action.commands.join('\n')}
                </pre>
                <button type="button"
                  onClick={() => navigator.clipboard.writeText(action.commands!.join('\n'))}
                  className="absolute top-1.5 right-1.5 px-2.5 py-1 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition border border-gray-600"
                >
                  Copy
                </button>
              </div>
            )}
            {((action.commands && action.commands.length > 0) || action.requiresAck) && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => onAcknowledge(action.id, e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
                />
                <span className="text-xs text-gray-400">{action.ackLabel ?? 'I have run these commands'}</span>
              </label>
            )}
          </div>
        </div>
        {action.affected.length > 0 && (
          <button type="button"
            onClick={() => onDeselect(action.affected)}
            className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition ${
              isWarning
                ? 'bg-yellow-800/40 text-yellow-300 hover:bg-yellow-800/70'
                : 'bg-blue-800/40 text-blue-300 hover:bg-blue-800/70'
            }`}
            title="Deselect affected resources"
          >
            Deselect
          </button>
        )}
      </div>
    </div>
  );
}
