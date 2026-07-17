#!/usr/bin/env node
/**
 * One-shot migration to add a `category` field to every feature in
 * scripts/feature-taxonomy.json. Categories are dashboard top-level
 * groupings used by the landing-page coverage tiles.
 *
 * Re-runnable: existing `category` values are preserved (so hand-edits
 * after this initial assignment are safe).
 *
 * Run:  node scripts/add-feature-categories.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY_PATH = path.resolve(__dirname, 'feature-taxonomy.json');

// Mapping from feature.id → category. Each category corresponds to a
// landing-page coverage tile. Categories are roughly the Cloudflare
// dashboard top-level nav groups.
const ID_TO_CATEGORY = {
  // ── DNS ────
  dns: 'dns',
  dnssec: 'dns',
  secondary_dns: 'dns',

  // ── SSL/TLS ────
  ssl_tls: 'ssl_tls',
  keyless_ssl: 'ssl_tls',
  custom_hostnames: 'ssl_tls',

  // ── Security ────
  rules_waf: 'security',
  rules_firewall: 'security',
  rules_rate_limits: 'security',
  bot_management: 'security',
  page_shield: 'security',
  api_shield: 'security',
  smart_shield: 'security',
  leaked_credentials: 'security',
  content_upload_scan: 'security',
  ai_security: 'security',
  security_center: 'security',
  brand_protection: 'security',
  cloudforce_one: 'security',
  intel: 'security',

  // ── Rules ────
  rules_pagerules: 'rules',
  managed_headers: 'rules',
  snippets: 'rules',
  cloud_connector: 'rules',
  url_normalization: 'rules',
  origin_rules: 'rules',

  // ── Caching ────
  caching: 'caching',

  // ── Traffic ────
  load_balancing: 'traffic',
  spectrum: 'traffic',
  waiting_rooms: 'traffic',

  // ── Workers & Pages ────
  workers: 'workers_pages',
  pages: 'workers_pages',

  // ── Storage / Data Platform ────
  r2: 'storage',
  kv: 'storage',
  d1: 'storage',
  queues: 'storage',
  vectorize: 'storage',
  hyperdrive: 'storage',
  workflows: 'storage',
  pipelines: 'storage',
  secrets_store: 'storage',
  containers: 'storage',

  // ── Email ────
  email_routing: 'email',
  email_security: 'email',

  // ── Logs / Analytics ────
  logs_logpush: 'logs',
  speed_api: 'logs',

  // ── Zero Trust ────
  access: 'zero_trust',
  gateway: 'zero_trust',
  warp_devices: 'zero_trust',
  dlp: 'zero_trust',
  dex: 'zero_trust',
  zt_risk_scoring: 'zero_trust',
  tunnels: 'zero_trust',

  // ── AI ────
  ai_run: 'ai',
  ai_gateway: 'ai',
  ai_search: 'ai',
  browser_rendering: 'ai',

  // ── Magic Networking ────
  magic_networking: 'magic',

  // ── Media (separate products) ────
  stream: 'media',
  images: 'media',
  realtime: 'media',

  // ── Zone Operations / Misc ────
  zone_settings: 'zone_ops',
  zone_admin: 'zone_ops',
  web3: 'zone_ops',

  // ── Account / Admin (not shown as tiles — but tagged for completeness) ────
  account_admin: 'account_admin',
  abuse_reports: 'account_admin',
  user: 'account_admin',
  system: 'account_admin',
};

// Display metadata for each category, used by the landing-page tiles.
// `order` controls tile sort. `icon` is a phosphor-react icon name (the
// component will look this up).
const CATEGORY_METADATA = {
  dns: { name: 'DNS', icon: 'Globe', order: 1, description: 'Records, settings, DNSSEC, secondary DNS, custom nameservers.' },
  ssl_tls: { name: 'SSL/TLS', icon: 'Lock', order: 2, description: 'Certificates, custom hostnames, SSL configuration.' },
  security: { name: 'Security', icon: 'ShieldCheck', order: 3, description: 'WAF, Bot Management, Page Shield, API Shield, rate limits.' },
  rules: { name: 'Rules', icon: 'Sliders', order: 4, description: 'Page rules, transform rules, origin rules, snippets.' },
  caching: { name: 'Caching', icon: 'Stack', order: 5, description: 'Cache rules, tiered cache, Argo Smart Routing.' },
  traffic: { name: 'Traffic', icon: 'ArrowsClockwise', order: 6, description: 'Load balancing, Spectrum, waiting rooms.' },
  workers_pages: { name: 'Workers & Pages', icon: 'Code', order: 7, description: 'Worker scripts, routes, bindings, Pages projects.' },
  storage: { name: 'Storage', icon: 'Database', order: 8, description: 'R2, KV, D1, Queues, Vectorize, Hyperdrive, Workflows.' },
  email: { name: 'Email', icon: 'Envelope', order: 9, description: 'Email Routing, Email Security.' },
  logs: { name: 'Logs & Analytics', icon: 'ChartBar', order: 10, description: 'Logpush, Speed Observatory.' },
  zero_trust: { name: 'Zero Trust', icon: 'UserCircle', order: 11, description: 'Access, Gateway, WARP, DLP, DEX.' },
  ai: { name: 'AI', icon: 'Cpu', order: 12, description: 'Workers AI, AI Gateway, AI Search, Browser Rendering.' },
  magic: { name: 'Magic Networking', icon: 'Lightning', order: 13, description: 'Magic Transit, WAN, Firewall.' },
  media: { name: 'Media', icon: 'PlayCircle', order: 14, description: 'Stream, Images, Realtime.' },
  zone_ops: { name: 'Zone Operations', icon: 'GearSix', order: 15, description: 'Zone settings, admin, Web3 gateways.' },
  account_admin: { name: 'Account Admin', icon: 'UsersThree', order: 99, description: 'Account-wide administration (out of zone migration scope).' },
};

const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));

let added = 0;
let preserved = 0;
const missing = [];
for (const feature of taxonomy.features) {
  if (feature.category) {
    preserved++;
    continue;
  }
  const cat = ID_TO_CATEGORY[feature.id];
  if (!cat) {
    missing.push(feature.id);
    continue;
  }
  feature.category = cat;
  added++;
}

// Attach category metadata table for consumers.
taxonomy._categories = CATEGORY_METADATA;

// Add a $schema-ish hint at the top.
taxonomy._comment_categories = 'Each feature has a `category` field grouping it into a dashboard top-level area (DNS, SSL/TLS, Security, Rules, Caching, Traffic, Workers & Pages, Storage, Email, Logs, Zero Trust, AI, Magic, Media, Zone Operations, Account Admin). _categories provides display metadata (name, icon, order, description) for each category and is consumed by the landing-page coverage tiles.';

fs.writeFileSync(TAXONOMY_PATH, JSON.stringify(taxonomy, null, 2) + '\n');

console.log(`✓ Added category to ${added} features`);
console.log(`✓ Preserved ${preserved} existing categories`);
if (missing.length) {
  console.log(`⚠ ${missing.length} features without category mapping:`);
  for (const m of missing) console.log('    ' + m);
  console.log('    Add them to ID_TO_CATEGORY in scripts/add-feature-categories.mjs');
  process.exit(1);
}
