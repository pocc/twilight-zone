#!/usr/bin/env node
/**
 * Emit the 5-layer migration scaffold for ONE endpoint.
 *
 *   node scripts/scaffold-endpoint.mjs PATCH /zones/{zone_id}/ct/alerting
 *   node scripts/scaffold-endpoint.mjs "PUT /zones/{zone_id}/foo/settings"
 *
 * Deterministic codegen from the OpenAPI request schema: the normalizer
 * whitelists exactly the writable fields (Principle 1). Apply the printed
 * blocks with the editor; review the normalizer types + confirm the endpoint
 * is genuinely in-scope (Principle 7) before committing. For LIST endpoints
 * the scaffold is a hint only — use migrateItems, not migrateSingleton.
 *
 * Requires the spec on disk (run `npm run generate:openapi-manifest` first).
 */
import { loadSpec, classifyKind, renderSingletonScaffold, writableContract } from './lib/endpoint-scaffold.mjs';

let [method, ...rest] = process.argv.slice(2);
let opPath = rest.join(' ').trim();
// Allow a single "METHOD /path" argument.
if (method && method.includes(' ') && !opPath) {
  [method, opPath] = method.split(/\s+/, 2);
}
if (!method || !opPath) {
  console.error('Usage: node scripts/scaffold-endpoint.mjs <METHOD> </path/with/{params}>');
  process.exit(2);
}
method = method.toUpperCase();

let spec;
try { spec = loadSpec(); }
catch (e) { console.error(e.message); process.exit(2); }

if (!spec.paths?.[opPath]?.[method.toLowerCase()]) {
  console.error(`✗ ${method} ${opPath} not found in the OpenAPI spec.`);
  console.error('  Check the exact templated path (e.g. /zones/{zone_id}/ct/alerting) and method.');
  process.exit(1);
}

const kind = classifyKind(spec, opPath, method);
if (kind === 'singleton') {
  console.log(renderSingletonScaffold(spec, opPath, method));
} else {
  const c = writableContract(spec, opPath, method);
  console.log(`\n${method} ${opPath}\nkind: ${kind} — no singleton auto-scaffold.`);
  if (c?.properties?.length) {
    console.log('writable contract:');
    for (const p of c.properties) console.log(`  - ${p.name}: ${p.type}${p.required ? '  [required]' : ''}`);
  }
  console.log('\nFor list/collection endpoints: add list+create wrappers in src/api.ts and');
  console.log('migrate via migrateItems in the relevant phase module. See pageShieldPolicies.');
  process.exit(0);
}
