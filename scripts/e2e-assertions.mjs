import fs from 'node:fs';
import path from 'node:path';

export const ZONE_SINGLETON_SETTINGS_SPEC = [
  // managed_headers returns the full plan-dependent CATALOG of available Managed
  // Transforms (each with an `enabled` flag), not just the configured state. The
  // available set differs by plan (e.g. add_true_client_ip_headers is Enterprise-
  // gated), and entries carry read-only conflicts_with/has_conflict metadata. The
  // only migratable state is which transforms are ENABLED, so compare the enabled-id
  // sets — not the raw catalog shape, count, or read-only metadata.
  { file: 'managed_headers', label: 'Managed Headers', enabledIdFields: ['managed_request_headers', 'managed_response_headers'] },
  { file: 'url_normalization', label: 'URL Normalization', fields: ['type', 'scope'] },
  { file: 'cache_reserve', label: 'Cache Reserve', fields: ['value'] },
  { file: 'dns_settings', label: 'DNS Settings', fields: ['foundation_dns', 'multi_provider', 'secondary_overrides', 'ns_ttl', 'zone_mode'] },
  { file: 'regional_tiered_cache', label: 'Regional Tiered Cache', fields: ['value'] },
  { file: 'cache_variants', label: 'Cache Variants', fields: ['value'] },
  { file: 'origin_post_quantum', label: 'Origin Post-Quantum Encryption', fields: ['value'] },
  { file: 'fraud_detection', label: 'Fraud Detection Settings', fields: ['user_profiles', 'username_expressions'] },
  { file: 'page_shield', label: 'Page Shield Settings', fields: ['enabled', 'use_cloudflare_reporting_endpoint', 'use_connection_url_path'] },
  { file: 'schema_validation_settings', label: 'Schema Validation Settings', fields: ['validation_default_mitigation_action', 'validation_override_mitigation_action'] },
  { file: 'api_gateway_configuration', label: 'API Shield Configuration', fields: ['auth_id_characteristics'] },
  { file: 'origin_tls_settings', label: 'Origin TLS Client Auth Settings', fields: ['enabled'] },
  { file: 'google_tag_gateway', label: 'Google Tag Gateway', fields: null },
  { file: 'smart_shield', label: 'Smart Shield Settings', fields: null },
];

function readEvidenceObject(dir, name) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const r = j && typeof j === 'object' && 'result' in j ? j.result : j;
    if (Array.isArray(r)) return r.length > 0 ? r : null;
    return r && typeof r === 'object' ? r : null;
  } catch {
    return null;
  }
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeValue)
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (['id', 'modified_on', 'created_on', 'updated_on'].includes(key)) continue;
      out[key] = normalizeValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalizeValue(value));
}

function comparableShape(obj, fields) {
  if (!fields) return normalizeValue(obj);
  const out = {};
  for (const field of fields) {
    if (obj && typeof obj === 'object' && field in obj) out[field] = normalizeValue(obj[field]);
  }
  return out;
}

// For catalog-style endpoints (managed_headers) the migratable state is the SET of
// enabled item ids per array. Returns a sorted, comparable list like
// ["managed_request_headers:add_true_client_ip_headers", ...]. Disabled catalog
// entries — and entries that only exist on one plan's catalog — are intentionally
// ignored, because they carry no configuration the migration controls.
function enabledIdSet(obj, fields) {
  const ids = [];
  if (!obj || typeof obj !== 'object') return ids;
  for (const field of fields) {
    const arr = obj[field];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (entry && typeof entry === 'object' && entry.enabled === true) {
        ids.push(`${field}:${entry.id ?? JSON.stringify(normalizeValue(entry))}`);
      }
    }
  }
  return ids.sort();
}

function acknowledgedLabels(testDir) {
  const reportPath = path.join(testDir, 'migration-report.md');
  const labels = new Set();
  if (!fs.existsSync(reportPath)) return labels;
  const reportText = fs.readFileSync(reportPath, 'utf8');
  for (const line of reportText.split('\n')) {
    const isAckLine = line.includes('🟡')
      || /acknowledg/i.test(line)
      || /not (enabled|entitled|available|subscrib)/i.test(line)
      || /plan (limit|downgrad|gated|requires)/i.test(line)
      || /to unlock/i.test(line);
    if (!isAckLine) continue;
    for (const spec of ZONE_SINGLETON_SETTINGS_SPEC) {
      if (line.toLowerCase().includes(spec.label.toLowerCase())) labels.add(spec.label);
    }
  }
  return labels;
}

// Principle 1 (No Surprise Failures): a healthy migration has ZERO ❌ failed
// rows. Everything that can't migrate (entitlement gaps, plan limits,
// account-tied resources, git-backed Pages, transient cert-service hiccups)
// must land as 🟡 acknowledged / manual, not failed. This assertion parses the
// migration report's per-section "Failed:" counts and fails the test if any
// section reports a non-zero failure — so a genuine red FAILED row (e.g. a
// Pages-project regression) trips the suite instead of slipping through
// because no other hook happened to cover that resource type.
//
// It reads per-SECTION counts (not the Summary "Failed" line) so the failure
// message can name exactly which section(s) failed.
export function assertNoUnexpectedFailures(testDir) {
  const reportPath = path.join(testDir, 'migration-report.md');
  if (!fs.existsSync(reportPath)) {
    return { passed: false, reason: 'no migration-report.md — cannot verify failure-free migration' };
  }
  const text = fs.readFileSync(reportPath, 'utf8');
  const lines = text.split('\n');
  const failingSections = [];
  let currentSection = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(?:[^\s]+\s+)?(.+?)\s*$/);
    if (h && !/^(💳|🔧|🔐|❌)/.test(line.replace(/^###\s+/, ''))) {
      currentSection = h[1].trim();
      continue;
    }
    const f = line.match(/^- \*\*Failed:\*\*\s+(\d+)/);
    if (f && Number(f[1]) > 0 && currentSection) {
      failingSections.push(`${currentSection} (${f[1]} failed)`);
    }
  }
  if (failingSections.length > 0) {
    return {
      passed: false,
      reason: `${failingSections.length} section(s) report FAILED rows (Principle 1 requires 0 — these should be acknowledged/manual, not failed): ${failingSections.join(', ')}`,
    };
  }
  return { passed: true, reason: 'no section reported any failed rows (0 ❌, per Principle 1)' };
}

export function assertZoneSingletonSettingsMatch(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const ackLabels = acknowledgedLabels(testDir);
  const missing = [];
  const mismatched = [];
  const acknowledged = [];
  let endpointsPresentOnSource = 0;
  let fieldsChecked = 0;

  for (const spec of ZONE_SINGLETON_SETTINGS_SPEC) {
    const src = readEvidenceObject(srcStateDir, spec.file);
    if (!src) continue;
    endpointsPresentOnSource++;
    const srcShape = spec.enabledIdFields
      ? enabledIdSet(src, spec.enabledIdFields)
      : comparableShape(src, spec.fields);
    fieldsChecked += spec.enabledIdFields
      ? spec.enabledIdFields.filter(field => Array.isArray(src[field])).length
      : spec.fields ? spec.fields.filter(field => field in src).length : Object.keys(srcShape).length;
    const dst = readEvidenceObject(dstStateDir, spec.file);
    if (!dst) {
      if (ackLabels.has(spec.label)) acknowledged.push(`${spec.label} (whole subsystem)`);
      else missing.push(spec.label);
      continue;
    }
    const dstShape = spec.enabledIdFields
      ? enabledIdSet(dst, spec.enabledIdFields)
      : comparableShape(dst, spec.fields);
    if (stableStringify(srcShape) !== stableStringify(dstShape)) {
      if (ackLabels.has(spec.label)) acknowledged.push(spec.label);
      else mismatched.push(`${spec.label}: src=${stableStringify(srcShape)} dst=${stableStringify(dstShape)}`);
    }
  }

  if (endpointsPresentOnSource === 0) {
    return { passed: false, reason: 'no zone singleton settings captured on source — cannot verify singleton settings migration' };
  }

  if (fieldsChecked === 0) {
    return { passed: false, reason: 'no comparable singleton setting fields captured on source — endpoint shape may have drifted' };
  }

  const ackNote = acknowledged.length ? ` (${acknowledged.length} acknowledged/plan-gated allowed: ${acknowledged.slice(0, 8).join(', ')})` : '';
  if (missing.length || mismatched.length) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} subsystem(s) MISSING on dest: ${missing.join(', ')}`);
    if (mismatched.length) parts.push(`${mismatched.length} MISMATCHED subsystem(s): ${mismatched.slice(0, 8).join('; ')}`);
    // MISSING subsystem (absent on dest, no ack) = blocking ❌. A pure value
    // MISMATCH (subsystem present, value differs) is the Principle-1 "Mismatched"
    // category — non-blocking 🟡 caution, still fully surfaced so it stays findable.
    const severity = missing.length ? undefined : 'caution';
    return { passed: false, severity, reason: `${parts.join(' | ')}${ackNote}` };
  }

  return {
    passed: true,
    reason: `${endpointsPresentOnSource} singleton setting subsystem(s), ${fieldsChecked} migrated field(s) match across source and dest${ackNote}`,
  };
}
