/**
 * Shared helpers for the new-endpoint triage + scaffold scripts.
 *
 * Pure, no side effects beyond reading the OpenAPI spec off disk. Used by:
 *   - scripts/triage-new-endpoints.mjs  (zero-input detect + classify + codegen)
 *   - scripts/scaffold-endpoint.mjs     (codegen one endpoint on demand)
 *
 * The codegen is deterministic: given an endpoint's writable request schema it
 * emits the exact 5-layer singleton scaffold (api.ts / types.ts / export-zone /
 * zone-extras / test). The ONE thing it cannot decide is the Principle-7
 * in-scope judgment; that stays with the agent/human.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_OPENAPI_PATH = '/tmp/api-schemas/openapi.json';

export function specPath() {
  return process.env.CF_OPENAPI_PATH || DEFAULT_OPENAPI_PATH;
}

export function loadSpec() {
  const p = specPath();
  if (!fs.existsSync(p)) {
    throw new Error(`OpenAPI spec not found at ${p}. Run \`npm run generate:openapi-manifest\` first (it downloads the live spec).`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Resolve a $ref (single hop, then recurse) against the spec root. */
export function deref(spec, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return node;
  if (node.$ref) {
    const segs = node.$ref.replace(/^#\//, '').split('/');
    let n = spec;
    for (const k of segs) n = n?.[k];
    return deref(spec, n, depth + 1);
  }
  return node;
}

/**
 * Flatten an object schema (following $ref + allOf) into { properties, required,
 * additionalPropertiesFalse }. Only the top level is flattened — enough to know
 * the writable contract.
 */
export function flattenObjectSchema(spec, schema) {
  const out = { properties: {}, required: new Set(), additionalPropertiesFalse: false };
  const visit = (s) => {
    s = deref(spec, s);
    if (!s || typeof s !== 'object') return;
    if (s.additionalProperties === false) out.additionalPropertiesFalse = true;
    if (Array.isArray(s.allOf)) s.allOf.forEach(visit);
    if (s.properties) {
      for (const [k, v] of Object.entries(s.properties)) out.properties[k] = deref(spec, v);
    }
    if (Array.isArray(s.required)) s.required.forEach((r) => out.required.add(r));
  };
  visit(schema);
  return out;
}

function jsonSchemaType(spec, propSchema) {
  const s = deref(spec, propSchema) || {};
  if (s.enum && Array.isArray(s.enum)) {
    return s.enum.map((e) => (typeof e === 'string' ? `'${e}'` : String(e))).join(' | ') || 'unknown';
  }
  switch (s.type) {
    case 'boolean': return 'boolean';
    case 'integer':
    case 'number': return 'number';
    case 'string': return 'string';
    case 'array': {
      const item = jsonSchemaType(spec, s.items || {});
      return `${item}[]`;
    }
    case 'object': return 'Record<string, unknown>';
    default: return 'unknown';
  }
}

/** The request body of a write op, as a writable contract. */
export function writableContract(spec, opPath, method) {
  const node = spec.paths?.[opPath];
  const op = node?.[method.toLowerCase()];
  if (!op) return null;
  const rb = deref(spec, op.requestBody);
  const schema = rb?.content?.['application/json']?.schema;
  if (!schema) return { properties: [], required: [], additionalPropertiesFalse: false, hasBody: false };
  const flat = flattenObjectSchema(spec, schema);
  const properties = Object.entries(flat.properties).map(([name, ps]) => ({
    name,
    type: jsonSchemaType(spec, ps),
    required: flat.required.has(name),
  }));
  return {
    properties,
    required: [...flat.required],
    additionalPropertiesFalse: flat.additionalPropertiesFalse,
    hasBody: true,
    summary: op.summary || '',
    operationId: op.operationId || '',
  };
}

/** Does a GET exist on the exact same path, and does it return an array? */
export function getKindHints(spec, opPath) {
  const get = spec.paths?.[opPath]?.get;
  if (!get) return { hasGet: false, getReturnsArray: false };
  const resp = deref(spec, get.responses?.['200']);
  const schema = deref(spec, resp?.content?.['application/json']?.schema);
  // Heuristic: result.type === 'array' somewhere in the allOf chain.
  let getReturnsArray = false;
  const visit = (s) => {
    s = deref(spec, s);
    if (!s || typeof s !== 'object') return;
    const result = deref(spec, s.properties?.result);
    if (result?.type === 'array') getReturnsArray = true;
    if (Array.isArray(s.allOf)) s.allOf.forEach(visit);
  };
  visit(schema);
  return { hasGet: true, getReturnsArray };
}

/**
 * Classify the shape of the migration we'd write:
 *   singleton  — one GET + one PUT/PATCH of a whole config object
 *   list       — a collection (POST create / GET list returns array)
 *   unknown    — can't tell; agent must decide
 */
export function classifyKind(spec, opPath, method) {
  const m = method.toUpperCase();
  const { hasGet, getReturnsArray } = getKindHints(spec, opPath);
  const lastSeg = opPath.split('/').filter(Boolean).pop() || '';
  const endsWithParam = /^\{.*\}$/.test(lastSeg);
  if ((m === 'PUT' || m === 'PATCH') && hasGet && !getReturnsArray && !endsWithParam) return 'singleton';
  if (m === 'POST' && getReturnsArray) return 'list';
  if (getReturnsArray) return 'list';
  if ((m === 'PUT' || m === 'PATCH') && !endsWithParam) return 'singleton';
  return 'unknown';
}

/**
 * Derive identifier names from a templated path.
 *   /zones/{zone_id}/ct/alerting              -> { field: ctAlerting, Pascal: CtAlerting, label: "Ct Alerting" }
 *   /zones/{zone_id}/content-upload-scan/settings -> contentUploadScanSettings
 * Skips leading {scope}/{id} segments (zones/{}, accounts/{}).
 */
export function deriveNames(opPath) {
  const segs = opPath.split('/').filter(Boolean);
  const tokens = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (/^\{.*\}$/.test(s)) continue;            // path param
    if ((s === 'zones' || s === 'accounts') && i === 0) continue; // scope prefix
    tokens.push(s);
  }
  // hyphen/underscore -> camel boundaries
  const flat = tokens.join('-').split(/[-_]/).filter(Boolean);
  const camel = flat.map((t, i) => (i === 0 ? t.toLowerCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())).join('');
  const Pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  const label = flat.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
  return { field: camel, Pascal, label, tokens: flat };
}

/** Replace {param} with ${zoneId}/${destZoneId} etc. for template literals. */
function templatePath(opPath, zoneVar) {
  return opPath.replace(/\{[^}]+\}/g, (m) => {
    if (/account/i.test(m)) return '${a}';
    return '${' + zoneVar + '}';
  });
}

/**
 * Render the deterministic 5-layer singleton scaffold. The normalizer
 * whitelists EXACTLY the writable properties from the spec (Principle 1).
 */
export function renderSingletonScaffold(spec, opPath, method) {
  const names = deriveNames(opPath);
  const contract = writableContract(spec, opPath, method) || { properties: [], required: [], hasBody: false };
  const { field, Pascal, label } = names;
  const props = contract.properties;
  const tsFields = props.length
    ? props.map((p) => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')
    : '  [k: string]: unknown;';
  const required = props.filter((p) => p.required).map((p) => p.name);
  const optional = props.filter((p) => !p.required).map((p) => p.name);
  const exportTpl = templatePath(opPath, 'z');
  const destTpl = templatePath(opPath, 'destZoneId');
  const M = method.toUpperCase();

  const normalizeBody = props.length
    ? `  const s = sub && typeof sub === 'object' && !Array.isArray(sub) ? (sub as Record<string, unknown>) : {};
  const out: Partial<${Pascal}> = {};
${required.map((r) => `  out.${r} = (s.${r} as ${Pascal}['${r}']); // required`).join('\n')}
${optional.map((o) => `  if (s.${o} !== undefined) out.${o} = s.${o} as ${Pascal}['${o}'];`).join('\n')}
  return out as ${Pascal};`
    : `  return (sub && typeof sub === 'object' && !Array.isArray(sub) ? sub : {}) as ${Pascal};`;

  return `
========================================================================
SCAFFOLD  ${M} ${opPath}
kind: singleton   field: ${field}   label: "${label}"
writable contract${contract.additionalPropertiesFalse ? ' (additionalProperties:false — send ONLY these)' : ''}:
${props.length ? props.map((p) => `  - ${p.name}: ${p.type}${p.required ? '  [required]' : ''}`).join('\n') : '  (no JSON body / opaque)'}
========================================================================

── 1. src/api.ts ──────────────────────────────────────────────────────
/** ${contract.summary || label} — zone singleton. Migrated via
 *  ${M} ${opPath}. Normalizer emits EXACTLY the writable contract so a
 *  read-only envelope field never lands as a surprise failed row (Principle 1). */
export interface ${Pascal} {
${tsFields}
}
export function normalize${Pascal}(sub: unknown): ${Pascal} {
${normalizeBody}
}
export async function get${Pascal}(auth: ApiAuth | string, zoneId: string): Promise<${Pascal} | null> {
  try { return await cfFetch<${Pascal}>(auth, \`${exportTpl}\`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function update${Pascal}(auth: ApiAuth | string, zoneId: string, sub: ${Pascal}): Promise<unknown> {
  return cfFetch(auth, \`${exportTpl}\`, { method: '${M}', body: JSON.stringify(normalize${Pascal}(sub)) });
}

── 2. src/types.ts (add to ZoneExport) ────────────────────────────────
  /** ${label} (singleton). Migrated via ${M} ${opPath}. */
  ${field}?: ${Pascal} | null;
  //  ^ import the type or inline it; keep ZoneExport self-contained per repo style.

── 3. src/migrate/export-zone.ts ──────────────────────────────────────
  // (a) add to the Promise.all destructure list (append, keep order in sync):
    ${field},
  // (b) add the matching fetchAndLog at the SAME array position:
    fetchAndLog('${label}', \`${exportTpl}\`, () => api.get${Pascal}(sourceAuth, z),
      r => log(r ? \`  ✓ ${label}: configured\` : \`  ⏭ ${label}: not configured\`)),
  // (c) add to the returned object:
    ${field}: ${field} || null,

── 4. src/migrate/zone-extras.ts (or the right phase module) ───────────
  if (exportData.${field}) {
    await migrateSingleton('${label}', true,
      \`${M} ${destTpl}\`,
      () => api.update${Pascal}(destAuth, destZoneId, exportData.${field}!));
  }

── 5. test/normalizeSingletons.test.ts ────────────────────────────────
describe('normalize${Pascal}', () => {
  it('keeps the writable contract and drops envelope/read-only fields', () => {
    expect(normalize${Pascal}({ ${props.map((p) => `${p.name}: ${sampleFor(p)}`).join(', ')}, modified_on: 'x', success: true }))
      .toEqual({ ${props.map((p) => `${p.name}: ${sampleFor(p)}`).join(', ')} });
  });
  it('never emits an array', () => {
    expect(Array.isArray(normalize${Pascal}([]))).toBe(false);
  });
});

NOTE: review the normalizer types and the in-scope decision (Principle 7)
before committing. For LIST endpoints use migrateItems, not migrateSingleton.
Path params are templated as \${z}/\${destZoneId} except {account_id} → \${a};
any OTHER sub-id param (e.g. a tunnel/widget id) is templated as a zone var and
must be fixed by hand — but those are account-scoped and usually out of scope.
`;
}

function sampleFor(p) {
  if (/boolean/.test(p.type)) return 'true';
  if (/number/.test(p.type)) return '1';
  if (/\[\]$/.test(p.type)) return '[]';
  if (/^'/.test(p.type)) return p.type.split('|')[0].trim();
  if (/string/.test(p.type)) return "'x'";
  return '{}';
}
