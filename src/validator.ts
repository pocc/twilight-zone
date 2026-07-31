import type { ZoneExport, CFZone } from './types';
import * as api from './api';

export type LogFn = (message: string) => void;

// =============================================================================
// A. DRY RUN VALIDATOR
// Validates plan compatibility and zone availability before migration
// =============================================================================

export interface PlanFeature {
  name: string;
  requiredPlan: 'free' | 'pro' | 'business' | 'enterprise';
  check: (exportData: ZoneExport) => boolean;
  description: string;
}

// Plan hierarchy for comparison
const PLAN_HIERARCHY: Record<string, number> = {
  'free': 0,
  'pro': 1,
  'business': 2,
  'enterprise': 3,
};

function getPlanLevel(planName: string): number {
  const normalized = planName.toLowerCase();
  if (normalized.includes('enterprise')) return 3;
  if (normalized.includes('business')) return 2;
  if (normalized.includes('pro')) return 1;
  return 0;
}

// [R3] Best-effort mapping — may drift from Cloudflare's actual plan requirements. Update as needed.
const PLAN_FEATURES: PlanFeature[] = [
  {
    name: 'Load Balancers',
    requiredPlan: 'pro',
    check: (data) => data.loadBalancers.length > 0,
    description: 'Load Balancing requires Pro plan or higher',
  },
  {
    name: 'Custom Certificates',
    requiredPlan: 'business',
    check: (data) => data.customCertificates.length > 0,
    description: 'Custom SSL certificates require Business plan or higher',
  },
  {
    name: 'Custom Hostnames (SSL for SaaS)',
    requiredPlan: 'enterprise',
    check: (data) => data.customHostnames.length > 0,
    description: 'SSL for SaaS requires Enterprise plan',
  },
  {
    name: 'Spectrum Apps',
    requiredPlan: 'pro',
    check: (data) => data.spectrumApps.length > 0,
    description: 'Spectrum requires Pro plan or higher',
  },
  {
    name: 'Access Applications',
    requiredPlan: 'pro',
    check: (data) => data.accessApps.length > 0,
    description: 'Cloudflare Access requires Pro plan or higher',
  },
  {
    name: 'Waiting Rooms',
    requiredPlan: 'business',
    check: (data) => data.waitingRooms.length > 0,
    description: 'Waiting Room requires Business plan or higher',
  },
  {
    name: 'Rate Limiting Rules (legacy)',
    requiredPlan: 'pro',
    check: (data) => data.rateLimits.length > 0,
    description: 'Legacy Rate Limiting requires Pro plan or higher',
  },
  {
    name: 'Image Optimization (Polish)',
    requiredPlan: 'pro',
    check: (data) => {
      // Polish is in use only when the setting is present AND not 'off'. The
      // previous `!== 'off'` treated an ABSENT setting (undefined) as "on",
      // raising a spurious plan-incompatible error for a feature the source
      // zone isn't even using. Mirrors the Image Resizing check below.
      const polishSetting = data.settings.find(s => s.id === 'polish');
      return polishSetting?.value != null && polishSetting.value !== 'off';
    },
    description: 'Polish (image optimization) requires Pro plan or higher',
  },
  {
    name: 'Image Resizing',
    requiredPlan: 'business',
    check: (data) => {
      const setting = data.settings.find(s => s.id === 'image_resizing');
      return setting?.value === 'on';
    },
    description: 'Image Resizing requires Business plan or higher',
  },
  {
    name: 'Zaraz (3rd party tools)',
    requiredPlan: 'free',
    check: (data) => data.zarazConfig !== null,
    description: 'Zaraz is available on all plans',
  },
];

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'plan_incompatible' | 'zone_exists' | 'zone_unavailable' | 'permission_denied';
  feature?: string;
  message: string;
  suggestion?: string;
}

export interface ValidationWarning {
  type: 'plan_downgrade' | 'feature_limited' | 'manual_action_required';
  feature?: string;
  message: string;
}

export async function validateDryRun(
  exportData: ZoneExport,
  destAuth: api.ApiAuth | string,
  destAccountId: string,
  destZoneName: string,
  log: LogFn = console.log
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  log('🔍 Starting dry run validation...');

  // 1. Check if zone name is available
  log('  Checking zone availability...');
  try {
    const existingZones = await api.listZones(destAuth, destZoneName);
    const zoneInAccount = existingZones.find(z => z.account.id === destAccountId);
    if (zoneInAccount) {
      warnings.push({
        type: 'feature_limited',
        message: `Zone "${destZoneName}" already exists in destination account. Migration will update existing zone.`,
      });
    }
  } catch (e) {
    api.throwIfAuthError(e);
    // Zone doesn't exist, which is fine
  }

  // 2. Get destination account info to check plan
  log('  Checking destination account plan...');
  let destPlanLevel = 0;
  try {
    const accounts = await api.listAccounts(destAuth);
    const destAccount = accounts.find(a => a.id === destAccountId);
    if (!destAccount) {
      errors.push({
        type: 'permission_denied',
        message: 'Cannot access destination account. Check API permissions.',
        suggestion: 'Ensure your API token has Account:Read permission',
      });
    }
    // Note: Account info doesn't include plan, we'd need to create a zone or check existing zones
    // For now, assume we can check by looking at existing zones in the account
    const destZones = await api.listAccountZones(destAuth, destAccountId);
    if (destZones.length > 0) {
      // Use the highest plan level from existing zones
      destPlanLevel = Math.max(...destZones.map(z => getPlanLevel(z.plan.name)));
      log(`  ✓ Destination account plan level: ${['Free', 'Pro', 'Business', 'Enterprise'][destPlanLevel]}`);
    } else {
      log('  ⚠ No existing zones in destination account, assuming Free plan');
      destPlanLevel = 0;
    }
  } catch (e) {
    api.throwIfAuthError(e);
    warnings.push({
      type: 'feature_limited',
      message: 'Could not determine destination account plan. Some features may fail.',
    });
  }

  // 3. Check source zone plan level
  const sourcePlanLevel = getPlanLevel(exportData.zone.plan.name);
  log(`  Source zone plan: ${exportData.zone.plan.name} (level ${sourcePlanLevel})`);

  if (destPlanLevel < sourcePlanLevel) {
    warnings.push({
      type: 'plan_downgrade',
      message: `Migrating from ${exportData.zone.plan.name} to a lower plan. Some features may not be available.`,
    });
  }

  // 4. Check each plan-specific feature
  log('  Checking feature compatibility...');
  for (const feature of PLAN_FEATURES) {
    if (feature.check(exportData)) {
      const requiredLevel = PLAN_HIERARCHY[feature.requiredPlan];
      if (destPlanLevel < requiredLevel) {
        errors.push({
          type: 'plan_incompatible',
          feature: feature.name,
          message: `${feature.name}: ${feature.description}`,
          suggestion: `Upgrade destination account to ${feature.requiredPlan} plan or higher`,
        });
      } else {
        log(`  ✓ ${feature.name}: compatible`);
      }
    }
  }

  // 5. Check for resources that require manual action
  if (exportData.workers.length > 0) {
    const workersWithSecrets = exportData.workers.filter(w => 
      w.bindings?.some(b => b.type === 'secret_text')
    );
    if (workersWithSecrets.length > 0) {
      warnings.push({
        type: 'manual_action_required',
        feature: 'Worker Secrets',
        message: `${workersWithSecrets.length} Worker(s) have secrets that must be provided manually`,
      });
    }
  }

  const valid = errors.length === 0;
  log(valid 
    ? '✓ Dry run validation passed' 
    : `✗ Dry run validation failed with ${errors.length} error(s)`);

  return { valid, errors, warnings };
}

// =============================================================================
// B. DEPENDENCY GRAPH RESOLVER
// Ensures resources are migrated in correct topological order
// =============================================================================

export type ResourceType = 
  | 'zone'
  | 'dns_records'
  | 'settings'
  | 'workers'
  | 'kv_namespaces'
  | 'lists'
  | 'rulesets'
  | 'worker_routes'
  | 'page_rules'
  | 'firewall_rules'
  | 'rate_limits'
  | 'monitors'
  | 'pools'
  | 'load_balancers'
  | 'custom_certificates'
  | 'custom_hostnames'
  | 'access_apps'
  | 'access_policies'
  | 'email_routing_rules'
  | 'waiting_rooms'
  | 'spectrum_apps'
  | 'zaraz'
  | 'turnstile';

// Migration Priority Order (per user specification):
// 1. DNS Records     - Fundamental connectivity
// 2. Worker Scripts  - Must exist before Routes/Triggers
// 3. Lists / KV Sets - Referenced by firewall and rules
// 4. Rulesets/Routes - Point to resources above
// 5. Load Balancers  - Top-level traffic steering

// Define dependencies: key depends on values
const RESOURCE_DEPENDENCIES: Record<ResourceType, ResourceType[]> = {
  // Priority 0: Zone must exist first
  zone: [],
  
  // Priority 1: DNS Records - Fundamental connectivity
  dns_records: ['zone'],
  settings: ['zone'],
  
  // Priority 2: Worker Scripts - Must exist before Routes/Triggers
  workers: ['zone'],
  
  // Priority 3: Lists / KV Sets - Referenced by firewall and rules
  kv_namespaces: ['zone'],           // Account-level, but logically grouped
  lists: ['zone'],                    // IP lists, hostname lists for rules
  
  // Priority 4: Rulesets / Routes - Point to workers, lists above
  rulesets: ['zone', 'lists'],        // Rulesets may reference lists
  worker_routes: ['zone', 'workers'], // Routes need workers to exist
  page_rules: ['zone'],
  firewall_rules: ['zone', 'lists'],  // Firewall rules may reference lists
  rate_limits: ['zone'],
  
  // Priority 5: Load Balancers - Top-level traffic steering
  monitors: ['zone'],                 // Health monitors (account-level)
  pools: ['monitors'],                // Pools reference monitors
  load_balancers: ['zone', 'pools'],  // LBs need pools
  
  // Other dependent resources
  custom_certificates: ['zone'],
  custom_hostnames: ['zone', 'custom_certificates'],
  access_apps: ['zone'],
  access_policies: ['access_apps'],
  email_routing_rules: ['zone', 'dns_records'],
  waiting_rooms: ['zone', 'dns_records'],
  spectrum_apps: ['zone', 'dns_records'],
  zaraz: ['zone'],
  turnstile: ['zone'],
};

export interface MigrationOrder {
  order: ResourceType[];
  phases: ResourceType[][];
}

export function resolveDependencyOrder(): MigrationOrder {
  const order: ResourceType[] = [];
  const visited = new Set<ResourceType>();
  const visiting = new Set<ResourceType>();

  function visit(resource: ResourceType): void {
    if (visited.has(resource)) return;
    if (visiting.has(resource)) {
      throw new Error(`Circular dependency detected involving ${resource}`);
    }

    visiting.add(resource);
    
    for (const dep of RESOURCE_DEPENDENCIES[resource]) {
      visit(dep);
    }
    
    visiting.delete(resource);
    visited.add(resource);
    order.push(resource);
  }

  // Visit all resources
  for (const resource of Object.keys(RESOURCE_DEPENDENCIES) as ResourceType[]) {
    visit(resource);
  }

  // Group into phases (resources that can be migrated in parallel)
  const phases: ResourceType[][] = [];
  const phaseMap = new Map<ResourceType, number>();

  for (const resource of order) {
    const deps = RESOURCE_DEPENDENCIES[resource];
    const maxDepPhase = deps.length > 0 
      ? Math.max(...deps.map(d => phaseMap.get(d) ?? 0))
      : -1;
    const phase = maxDepPhase + 1;
    phaseMap.set(resource, phase);

    while (phases.length <= phase) {
      phases.push([]);
    }
    phases[phase].push(resource);
  }

  return { order, phases };
}

export function getMigrationPhases(): { phase: number; resources: ResourceType[]; description: string }[] {
  const { phases } = resolveDependencyOrder();
  
  const descriptions = [
    'Zone creation',
    'Core zone resources (DNS, settings, rules)',
    'Infrastructure (monitors, pools, workers)',
    'Dependent resources (LBs, routes, policies)',
    'Final resources',
  ];

  return phases.map((resources, i) => ({
    phase: i + 1,
    resources,
    description: descriptions[i] || `Phase ${i + 1}`,
  }));
}

// =============================================================================
// C. RESOURCE ID MAPPER
// Maintains old-id -> new-id mapping for internal references
// =============================================================================

export interface ResourceIdMap {
  zones: Map<string, string>;
  dnsRecords: Map<string, string>;
  workers: Map<string, string>;
  rulesets: Map<string, string>;
  pageRules: Map<string, string>;
  pools: Map<string, string>;
  monitors: Map<string, string>;
  loadBalancers: Map<string, string>;
  accessApps: Map<string, string>;
  accessPolicies: Map<string, string>;
  customCertificates: Map<string, string>;
  customHostnames: Map<string, string>;
  waitingRooms: Map<string, string>;
  turnstileWidgets: Map<string, string>;
}

export function createResourceIdMap(): ResourceIdMap {
  return {
    zones: new Map(),
    dnsRecords: new Map(),
    workers: new Map(),
    rulesets: new Map(),
    pageRules: new Map(),
    pools: new Map(),
    monitors: new Map(),
    loadBalancers: new Map(),
    accessApps: new Map(),
    accessPolicies: new Map(),
    customCertificates: new Map(),
    customHostnames: new Map(),
    waitingRooms: new Map(),
    turnstileWidgets: new Map(),
  };
}

export function mapResourceId(
  idMap: ResourceIdMap,
  resourceType: keyof ResourceIdMap,
  oldId: string,
  newId: string
): void {
  idMap[resourceType].set(oldId, newId);
}

export function getNewId(
  idMap: ResourceIdMap,
  resourceType: keyof ResourceIdMap,
  oldId: string
): string | undefined {
  return idMap[resourceType].get(oldId);
}

export function resolveIdReferences<T extends Record<string, unknown>>(
  obj: T,
  idMap: ResourceIdMap,
  fieldMappings: { field: string; resourceType: keyof ResourceIdMap }[]
): T {
  const result = { ...obj };
  
  for (const { field, resourceType } of fieldMappings) {
    const oldId = result[field];
    if (typeof oldId === 'string') {
      const newId = getNewId(idMap, resourceType, oldId);
      if (newId) {
        (result as Record<string, unknown>)[field] = newId;
      }
    }
  }
  
  return result;
}

// Common field mappings for different resource types
export const ID_FIELD_MAPPINGS = {
  workerRoute: [
    { field: 'script', resourceType: 'workers' as keyof ResourceIdMap },
  ],
  loadBalancer: [
    { field: 'default_pool', resourceType: 'pools' as keyof ResourceIdMap },
    { field: 'fallback_pool', resourceType: 'pools' as keyof ResourceIdMap },
  ],
  accessPolicy: [
    { field: 'application_id', resourceType: 'accessApps' as keyof ResourceIdMap },
  ],
  customHostname: [
    { field: 'custom_certificate_id', resourceType: 'customCertificates' as keyof ResourceIdMap },
  ],
};

// Resolve pool IDs in load balancer config
export function resolveLoadBalancerPoolIds(
  lbConfig: Record<string, unknown>,
  idMap: ResourceIdMap
): Record<string, unknown> {
  const result = { ...lbConfig };
  
  // Resolve default_pools array
  if (Array.isArray(result.default_pools)) {
    result.default_pools = result.default_pools.map((poolId: string) => 
      getNewId(idMap, 'pools', poolId) || poolId
    );
  }
  
  // Resolve fallback_pool
  if (typeof result.fallback_pool === 'string') {
    result.fallback_pool = getNewId(idMap, 'pools', result.fallback_pool) || result.fallback_pool;
  }
  
  // Resolve pop_pools (geographic routing)
  if (result.pop_pools && typeof result.pop_pools === 'object') {
    const popPools = result.pop_pools as Record<string, string[]>;
    result.pop_pools = Object.fromEntries(
      Object.entries(popPools).map(([pop, pools]) => [
        pop,
        pools.map(poolId => getNewId(idMap, 'pools', poolId) || poolId),
      ])
    );
  }
  
  // Resolve region_pools
  if (result.region_pools && typeof result.region_pools === 'object') {
    const regionPools = result.region_pools as Record<string, string[]>;
    result.region_pools = Object.fromEntries(
      Object.entries(regionPools).map(([region, pools]) => [
        region,
        pools.map(poolId => getNewId(idMap, 'pools', poolId) || poolId),
      ])
    );
  }
  
  return result;
}

// Resolve monitor ID in pool config
export function resolvePoolMonitorId(
  poolConfig: Record<string, unknown>,
  idMap: ResourceIdMap
): Record<string, unknown> {
  const result = { ...poolConfig };
  
  if (typeof result.monitor === 'string') {
    result.monitor = getNewId(idMap, 'monitors', result.monitor) || result.monitor;
  }
  
  return result;
}

// Export ID map to JSON for debugging/logging
export function exportIdMapToJson(idMap: ResourceIdMap): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  
  for (const [key, map] of Object.entries(idMap)) {
    result[key] = Object.fromEntries(map);
  }
  
  return result;
}

// Import ID map from JSON (for resuming migrations)
export function importIdMapFromJson(
  json: Record<string, Record<string, string>>
): ResourceIdMap {
  const idMap = createResourceIdMap();
  
  for (const [key, mappings] of Object.entries(json)) {
    if (key in idMap) {
      const mapKey = key as keyof ResourceIdMap;
      for (const [oldId, newId] of Object.entries(mappings)) {
        idMap[mapKey].set(oldId, newId);
      }
    }
  }
  
  return idMap;
}
