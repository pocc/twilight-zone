/**
 * Durable Object Migration Module
 * 
 * Implements the "sandwich" migration pattern:
 * 1. Extract original code from source account
 * 2. Inject SyncBridge migration endpoints
 * 3. Create DO namespace in destination account
 * 4. Deploy instrumented code to destination
 * 5. Sync data from source to destination
 * 6. Restore original code with new bindings
 */

import type { CFWorkerBinding, CFDurableObjectNamespace } from './types';
import * as api from './api';

export type LogFn = (message: string) => void;

// DO Migration Result tracking
export interface DOMigrationResult {
  workerName: string;
  className: string;
  sourceNamespaceId: string;
  destNamespaceId: string;
  objectsSynced: number;
  objectsFailed: number;
  status: 'success' | 'partial' | 'failed';
  error?: string;
}

// DO Object data for sync
export interface DOObjectData {
  id: string;
  name?: string; // The name used with idFromName (if available)
  entries: Array<{ key: string; value: unknown }>;
  cursor?: string; // For pagination
}

/**
 * SyncBridge code to inject into DO classes.
 * This adds export/import endpoints for state transfer.
 * 
 * The injected code:
 * - Adds a MigrationMixin to the DO class
 * - Intercepts fetch requests to handle /__migrate/* routes
 * - Exports: Uses storage.list() to dump all KV pairs
 * - Imports: Uses storage.put() to populate the new instance
 */
const SYNC_BRIDGE_CODE = `
// === TWILIGHT-ZONE MIGRATION BRIDGE (AUTO-INJECTED) ===
// This code enables state transfer between accounts. It will be removed after migration.

// [C12] MIGRATION_SECRET is injected per-migration via template parameter — no hardcoded value
const MIGRATION_SECRET = "%%MIGRATION_SECRET%%";

// Wrap the original DO class to add migration endpoints
function wrapDurableObjectClass(OriginalClass) {
  return class MigrationWrapper extends OriginalClass {
    async fetch(request) {
      const url = new URL(request.url);
      
      // Check for migration routes
      if (url.pathname.startsWith('/__migrate/')) {
        const authHeader = request.headers.get('X-Migration-Auth');
        if (authHeader !== MIGRATION_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
        
        if (url.pathname === '/__migrate/export') {
          return this._exportState(url);
        }
        
        if (url.pathname === '/__migrate/import' && request.method === 'POST') {
          return this._importState(request);
        }
        
        if (url.pathname === '/__migrate/ping') {
          return new Response('pong', { status: 200 });
        }
      }
      
      // Pass through to original handler
      return super.fetch(request);
    }
    
    async _exportState(url) {
      try {
        const limit = parseInt(url.searchParams.get('limit') || '1000', 10);
        const cursor = url.searchParams.get('cursor') || undefined;
        
        const options = { limit };
        if (cursor) options.startAfter = cursor;
        
        const entries = await this.ctx.storage.list(options);
        const data = [];
        let lastKey = null;
        
        for (const [key, value] of entries) {
          data.push({ key, value });
          lastKey = key;
        }
        
        const hasMore = entries.size === limit;
        
        return new Response(JSON.stringify({
          success: true,
          data,
          cursor: hasMore ? lastKey : null,
          hasMore,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    async _importState(request) {
      try {
        const { data } = await request.json();
        
        if (!Array.isArray(data)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid data format: expected array',
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        // Batch put for efficiency
        const batch = {};
        for (const { key, value } of data) {
          batch[key] = value;
        }
        
        await this.ctx.storage.put(batch);
        
        return new Response(JSON.stringify({
          success: true,
          imported: data.length,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  };
}

// Export the wrapper function for use
globalThis.__wrapDOClass = wrapDurableObjectClass;
// === END MIGRATION BRIDGE ===
`;

/**
 * Generate instrumented worker code with SyncBridge injected.
 * 
 * This wraps DO class exports to add migration endpoints while
 * preserving the original functionality.
 */
// [C12] Generate a unique migration secret per invocation to prevent replay attacks
export function injectSyncBridge(originalCode: string, doClassNames: string[], migrationSecret?: string): string {
  const secret = migrationSecret ?? crypto.randomUUID();
  // Inject the per-migration secret into the bridge code template
  let instrumentedCode = SYNC_BRIDGE_CODE.replace('%%MIGRATION_SECRET%%', secret) + '\n\n';
  
  // Add the original code
  instrumentedCode += originalCode;
  
  // For each DO class, wrap it with the migration wrapper
  // We need to handle different export patterns:
  // 1. export class MyDO extends DurableObject { ... }
  // 2. export { MyDO };
  // 3. export default class MyDO { ... }
  
  for (const className of doClassNames) {
    // Pattern 1: Direct class export - wrap after class definition
    // export class MyDO extends DurableObject { ... }
    const classExportPattern = new RegExp(
      `export\\s+class\\s+(${className})\\s+extends\\s+DurableObject`,
      'g'
    );
    
    if (classExportPattern.test(instrumentedCode)) {
      // Add wrapper at the end to replace the export
      instrumentedCode += `\n\n// Wrap ${className} for migration\nconst _Original${className} = ${className};\nconst ${className} = globalThis.__wrapDOClass(_Original${className});\n`;
    }
  }
  
  // Add admin router to worker fetch for listing DO instances
  const adminRouter = `
// === TWILIGHT-ZONE ADMIN ROUTER (AUTO-INJECTED) ===
const ORIGINAL_FETCH = typeof default_fetch !== 'undefined' ? default_fetch : null;

async function __tz_admin_fetch(request, env, ctx) {
  const url = new URL(request.url);
  
  if (url.pathname === '/__tz/ping') {
    return new Response('twilight-zone-bridge-active', { status: 200 });
  }
  
  if (url.pathname === '/__tz/do-stub' && request.method === 'POST') {
    // Get a DO stub by name and forward the request
    const authHeader = request.headers.get('X-Migration-Auth');
    if (authHeader !== MIGRATION_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    try {
      const { namespace, name, path } = await request.json();
      const ns = env[namespace];
      if (!ns) {
        return new Response(JSON.stringify({ error: 'Namespace not found: ' + namespace }), { status: 404 });
      }
      
      const id = ns.idFromName(name);
      const stub = ns.get(id);
      
      // Forward to the DO's migration endpoint
      const doUrl = new URL(path, request.url);
      const doRequest = new Request(doUrl.toString(), {
        method: 'GET',
        headers: { 'X-Migration-Auth': MIGRATION_SECRET },
      });
      
      return stub.fetch(doRequest);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }
  
  // Forward to original handler if it exists
  if (ORIGINAL_FETCH) {
    return ORIGINAL_FETCH(request, env, ctx);
  }
  
  return new Response('Not Found', { status: 404 });
}

// Re-export with admin router
export default {
  fetch: __tz_admin_fetch,
};
// === END ADMIN ROUTER ===
`;

  // Only add admin router if there are DO classes to migrate
  if (doClassNames.length > 0) {
    // Check if there's already a default export and save reference to it
    if (/export\s+default\s*\{/.test(instrumentedCode)) {
      instrumentedCode = instrumentedCode.replace(
        /export\s+default\s*\{([^}]+)\}/,
        'const default_fetch = { $1 }.fetch;\n'
      );
      instrumentedCode += adminRouter;
    } else if (/export\s+default\s+\{/.test(instrumentedCode)) {
      instrumentedCode = instrumentedCode.replace(
        /export\s+default\s+(\{[^}]+\})/,
        'const default_fetch = $1.fetch;\n'
      );
      instrumentedCode += adminRouter;
    }
  }
  
  return instrumentedCode;
}

/**
 * Create a Durable Object namespace in the destination account.
 * 
 * Note: DO namespaces are created automatically when deploying a worker
 * with DO bindings. This function deploys a minimal worker to create
 * the namespace, then returns the namespace ID.
 */
// [W27] Accept optional pre-fetched namespaces list to avoid listing N+1 times
export async function createDONamespace(
  auth: api.ApiAuth | string,
  accountId: string,
  scriptName: string,
  className: string,
  log: LogFn = console.log,
  existingNamespaces?: Array<{ id: string; class?: string; script?: string }>
): Promise<string> {
  log(`  Creating DO namespace for class ${className}...`);
  
  // Deploy a minimal worker with the DO binding to create the namespace
  const minimalWorker = `
export class ${className} {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  
  async fetch(request) {
    return new Response('DO placeholder');
  }
}

export default {
  async fetch(request, env, ctx) {
    return new Response('Namespace creation placeholder');
  },
};
`;

  const bindings: CFWorkerBinding[] = [{
    type: 'durable_object_namespace',
    name: className.toUpperCase(),
    class_name: className,
    script_name: scriptName,
  }];

  // Upload the minimal worker
  await api.uploadWorkerScript(auth, accountId, scriptName, minimalWorker, bindings);
  
  // [W27] Use pre-fetched list if available, otherwise fetch fresh
  const namespaces = existingNamespaces ?? await api.listDurableObjectNamespaces(auth, accountId);
  let namespace = namespaces.find(ns => ns.class === className && ns.script === scriptName);
  
  // If not found in pre-fetched list, the deploy may have created it — fetch fresh
  if (!namespace && existingNamespaces) {
    const freshNamespaces = await api.listDurableObjectNamespaces(auth, accountId);
    namespace = freshNamespaces.find(ns => ns.class === className && ns.script === scriptName);
  }
  
  if (!namespace) {
    throw new Error(`Failed to create DO namespace for ${className}`);
  }
  
  log(`  ✓ Created namespace ${namespace.id} for ${className}`);
  return namespace.id;
}

/**
 * Upload instrumented worker code with DO bindings.
 */
export async function uploadInstrumentedWorker(
  auth: api.ApiAuth | string,
  accountId: string,
  scriptName: string,
  instrumentedCode: string,
  bindings: CFWorkerBinding[],
  log: LogFn = console.log
): Promise<void> {
  log(`  Uploading instrumented worker ${scriptName}...`);
  
  await api.uploadWorkerScript(auth, accountId, scriptName, instrumentedCode, bindings);
  
  log(`  ✓ Instrumented worker deployed`);
}

/**
 * Sync a single DO instance's state from source to destination.
 * 
 * Uses pagination for large DOs (>128MB).
 */
// [C12] migrationSecret is now a required parameter — no hardcoded secrets
export async function syncDOInstance(
  sourceWorkerUrl: string,
  destWorkerUrl: string,
  namespaceName: string,
  objectName: string,
  migrationSecret: string,
  log: LogFn = console.log
): Promise<{ entriesSynced: number; success: boolean; error?: string }> {
  const MIGRATION_SECRET = migrationSecret;
  let entriesSynced = 0;
  let cursor: string | null = null;
  
  try {
    // Paginated export/import loop
    do {
      // Export from source
      const exportUrl = new URL('/__tz/do-stub', sourceWorkerUrl);
      const exportBody = {
        namespace: namespaceName,
        name: objectName,
        path: `/__migrate/export${cursor ? `?cursor=${cursor}&limit=1000` : '?limit=1000'}`,
      };
      
      const exportRes = await fetch(exportUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Migration-Auth': MIGRATION_SECRET,
        },
        body: JSON.stringify(exportBody),
      });
      
      if (!exportRes.ok) {
        const errText = await exportRes.text();
        throw new Error(`Export failed: ${exportRes.status} ${errText}`);
      }
      
      const exportData = await exportRes.json() as {
        success: boolean;
        data: Array<{ key: string; value: unknown }>;
        cursor: string | null;
        hasMore: boolean;
        error?: string;
      };
      
      if (!exportData.success) {
        throw new Error(`Export failed: ${exportData.error}`);
      }
      
      if (exportData.data.length === 0) {
        break;
      }
      
      // Import to destination
      const importUrl = new URL('/__tz/do-stub', destWorkerUrl);
      const importBody = {
        namespace: namespaceName,
        name: objectName,
        path: '/__migrate/import',
      };
      
      // First, get the stub, then send import request
      const importStubRes = await fetch(importUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Migration-Auth': MIGRATION_SECRET,
        },
        body: JSON.stringify({
          ...importBody,
          data: exportData.data,
        }),
      });
      
      if (!importStubRes.ok) {
        const errText = await importStubRes.text();
        throw new Error(`Import failed: ${importStubRes.status} ${errText}`);
      }
      
      const importResult = await importStubRes.json() as {
        success: boolean;
        imported?: number;
        error?: string;
      };
      
      if (!importResult.success) {
        throw new Error(`Import failed: ${importResult.error}`);
      }
      
      entriesSynced += exportData.data.length;
      cursor = exportData.cursor;
      
      log(`    Synced ${entriesSynced} entries for ${objectName}...`);
      
    } while (cursor);
    
    return { entriesSynced, success: true };
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { entriesSynced, success: false, error: errMsg };
  }
}

/**
 * Restore the original worker code with new namespace bindings.
 */
export async function restoreOriginalWorker(
  auth: api.ApiAuth | string,
  accountId: string,
  scriptName: string,
  originalCode: string,
  originalBindings: CFWorkerBinding[],
  namespaceIdMap: Map<string, string>, // Maps class_name -> new namespace ID
  log: LogFn = console.log
): Promise<void> {
  log(`  Restoring original worker code...`);
  
  // Update bindings with new namespace IDs
  const updatedBindings = originalBindings.map(binding => {
    if (binding.type === 'durable_object_namespace' && binding.class_name) {
      const newNamespaceId = namespaceIdMap.get(binding.class_name);
      if (newNamespaceId) {
        return {
          ...binding,
          namespace_id: newNamespaceId,
        };
      }
    }
    return binding;
  });
  
  await api.uploadWorkerScript(auth, accountId, scriptName, originalCode, updatedBindings);
  
  log(`  ✓ Original worker restored with new namespace bindings`);
}

/**
 * Main DO migration orchestrator.
 * 
 * Implements the full "sandwich" migration:
 * Phase A: Extract original code from source
 * Phase B: Create namespace in destination
 * Phase C: Deploy instrumented code (bridge)
 * Phase D: Sync data
 * Phase E: Restore original code
 */
export async function migrateDurableObjects(
  sourceAuth: api.ApiAuth | string,
  destAuth: api.ApiAuth | string,
  sourceAccountId: string,
  destAccountId: string,
  scriptName: string,
  doClassNames: string[],
  objectNames: string[], // Names used with idFromName() - must be provided by user
  sourceWorkerUrl: string, // e.g., https://my-worker.my-subdomain.workers.dev
  destWorkerUrl: string,
  log: LogFn = console.log
): Promise<DOMigrationResult[]> {
  const results: DOMigrationResult[] = [];
  
  log(`\n🔄 Starting Durable Object migration for ${scriptName}`);
  log(`   Classes: ${doClassNames.join(', ')}`);
  log(`   Objects: ${objectNames.length} instances to migrate`);
  
  // Phase A: Extract original code and bindings from source
  log('\n📤 Phase A: Extracting original code from source...');
  const originalCode = await api.getWorkerScript(sourceAuth, sourceAccountId, scriptName);
  const originalBindings = await api.getWorkerBindings(sourceAuth, sourceAccountId, scriptName);
  log(`   ✓ Extracted ${originalCode.length} bytes of code`);
  log(`   ✓ Found ${originalBindings.length} bindings`);
  
  // Get source namespace IDs for reference
  const sourceNamespaces = await api.listDurableObjectNamespaces(sourceAuth, sourceAccountId);
  const sourceNamespaceMap = new Map<string, string>();
  for (const ns of sourceNamespaces) {
    if (ns.script === scriptName && ns.class) {
      sourceNamespaceMap.set(ns.class, ns.id);
    }
  }
  
  // Phase B: Create namespaces in destination
  log('\n📦 Phase B: Creating DO namespaces in destination...');
  const destNamespaceMap = new Map<string, string>();
  
  // [W27] List destination namespaces once before loop to avoid N+1 fetches
  const existingDestNamespaces = await api.listDurableObjectNamespaces(destAuth, destAccountId);
  
  // [W20] Create DO namespaces in parallel with Promise.allSettled
  const namespaceResults = await Promise.allSettled(
    doClassNames.map(className => createDONamespace(destAuth, destAccountId, scriptName, className, log, existingDestNamespaces))
  );
  for (let i = 0; i < doClassNames.length; i++) {
    const className = doClassNames[i];
    const result = namespaceResults[i];
    if (result.status === 'fulfilled') {
      destNamespaceMap.set(className, result.value);
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      log(`   ❌ Failed to create namespace for ${className}: ${errMsg}`);
      results.push({
        workerName: scriptName,
        className,
        sourceNamespaceId: sourceNamespaceMap.get(className) || '',
        destNamespaceId: '',
        objectsSynced: 0,
        objectsFailed: 0,
        status: 'failed',
        error: errMsg,
      });
    }
  }
  
  // Phase C: Deploy instrumented code to both source and destination
  log('\n🔧 Phase C: Deploying instrumented code (SyncBridge)...');
  // [C12] Generate a per-migration secret for authentication
  const migrationSecret = crypto.randomUUID();
  const instrumentedCode = injectSyncBridge(originalCode, doClassNames, migrationSecret);
  
  // Update bindings with destination namespace IDs
  const destBindings = originalBindings.map(binding => {
    if (binding.type === 'durable_object_namespace' && binding.class_name) {
      const newNamespaceId = destNamespaceMap.get(binding.class_name);
      if (newNamespaceId) {
        return { ...binding, namespace_id: newNamespaceId };
      }
    }
    return binding;
  });
  
  // Deploy to source (to add export endpoints)
  log('   Deploying bridge to source worker...');
  await api.uploadWorkerScript(sourceAuth, sourceAccountId, scriptName, instrumentedCode, originalBindings);
  
  // Deploy to destination (to add import endpoints)  
  log('   Deploying bridge to destination worker...');
  await api.uploadWorkerScript(destAuth, destAccountId, scriptName, instrumentedCode, destBindings);
  
  log('   ✓ Bridge deployed to both accounts');
  
  // Give workers time to deploy
  log('   Waiting for workers to become available...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Phase D: Sync data for each DO instance
  log('\n📊 Phase D: Syncing Durable Object data...');
  
  // [W21] Concurrency limit for parallel DO instance syncs
  const DO_SYNC_CONCURRENCY = 5;
  
  for (const className of doClassNames) {
    const sourceNamespaceId = sourceNamespaceMap.get(className) || '';
    const destNamespaceId = destNamespaceMap.get(className) || '';
    
    if (!destNamespaceId) {
      continue; // Skip if namespace creation failed
    }
    
    const namespaceName = className.toUpperCase(); // Convention: binding name is uppercase class name
    let objectsSynced = 0;
    let objectsFailed = 0;
    
    // [W21] Sync DO instances with concurrency-limited parallelism instead of sequential loop
    const syncResults: PromiseSettledResult<{ entriesSynced: number; success: boolean; error?: string; objectName: string }>[] = [];
    let idx = 0;
    async function syncWorker() {
      while (idx < objectNames.length) {
        const i = idx++;
        const objectName = objectNames[i];
        log(`   Syncing ${className}:${objectName}...`);
        // [C12] Pass migration secret to syncDOInstance
        const result = await syncDOInstance(
          sourceWorkerUrl, destWorkerUrl, namespaceName, objectName, migrationSecret, log
        );
        syncResults[i] = { status: 'fulfilled', value: { ...result, objectName } };
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DO_SYNC_CONCURRENCY, objectNames.length) }, () =>
        syncWorker().catch(e => { /* worker-level error — individual results tracked */ })
      )
    );
    
    for (let i = 0; i < objectNames.length; i++) {
      const settled = syncResults[i];
      const objectName = objectNames[i];
      if (settled?.status === 'fulfilled' && settled.value.success) {
        objectsSynced++;
        log(`   ✓ ${objectName}: ${settled.value.entriesSynced} entries`);
      } else {
        objectsFailed++;
        const err = settled?.status === 'fulfilled' ? settled.value.error : 'sync worker failed';
        log(`   ❌ ${objectName}: ${err}`);
      }
    }
    
    results.push({
      workerName: scriptName,
      className,
      sourceNamespaceId,
      destNamespaceId,
      objectsSynced,
      objectsFailed,
      status: objectsFailed === 0 ? 'success' : objectsSynced > 0 ? 'partial' : 'failed',
    });
  }
  
  // Phase E: Restore original code
  log('\n🔄 Phase E: Restoring original code...');
  
  // Restore source to original state
  log('   Restoring source worker...');
  await api.uploadWorkerScript(sourceAuth, sourceAccountId, scriptName, originalCode, originalBindings);
  
  // Restore destination with new bindings
  log('   Restoring destination worker...');
  await restoreOriginalWorker(destAuth, destAccountId, scriptName, originalCode, originalBindings, destNamespaceMap, log);
  
  log('\n✅ Durable Object migration complete!');
  
  // Summary
  const successful = results.filter(r => r.status === 'success').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  log(`   Summary: ${successful} successful, ${partial} partial, ${failed} failed`);
  
  return results;
}

/**
 * Configuration for DO migration
 */
export interface DOMigrationConfig {
  sourceAccountId: string;
  destAccountId: string;
  scriptName: string;
  doClassNames: string[];
  objectNames: string[]; // Names used with idFromName()
  sourceWorkerUrl: string;
  destWorkerUrl: string;
}

/**
 * Validate DO migration configuration
 */
export function validateDOMigrationConfig(config: DOMigrationConfig): string[] {
  const errors: string[] = [];
  
  if (!config.sourceAccountId) errors.push('sourceAccountId is required');
  if (!config.destAccountId) errors.push('destAccountId is required');
  if (!config.scriptName) errors.push('scriptName is required');
  if (!config.doClassNames || config.doClassNames.length === 0) {
    errors.push('doClassNames must contain at least one class name');
  }
  if (!config.objectNames || config.objectNames.length === 0) {
    errors.push('objectNames must contain at least one object name (the names used with idFromName)');
  }
  if (!config.sourceWorkerUrl) errors.push('sourceWorkerUrl is required');
  if (!config.destWorkerUrl) errors.push('destWorkerUrl is required');
  
  return errors;
}
