// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Dry-run preview: turns a ZoneExport into a list of the API calls the
// migrate engine *would* make against the destination. Used by:
//   • POST /api/migrate when config.dryRun === true (no side effects on dest)
//   • Step 2 preview "What will happen?" tooltip
//   • CLI scripts in scripts/ for cost/scope estimation
//
// This module is pure (no network I/O). It deliberately does NOT cover
// every endpoint the real migrate path touches — it covers the
// "main" POST/PUT/PATCH per resource family. GETs, verification calls,
// and per-item dependency lookups are intentionally omitted because they
// aren't billable and would drown out the useful signal.

import type { ZoneExport } from '../types';
import { READ_ONLY_SETTINGS } from './constants';

export interface DryRunPreview {
  apiCalls: { method: string; endpoint: string; description: string; count: number }[];
  summary: { total: number; resourceTypes: number };
}

export function generateDryRunPreview(
  exportData: ZoneExport,
  destAccountId: string,
  destZoneName: string,
): DryRunPreview {
  const apiCalls: { method: string; endpoint: string; description: string; count: number }[] = [];

  // Zone creation
  apiCalls.push({
    method: 'POST',
    endpoint: '/zones',
    description: `Create zone: ${destZoneName}`,
    count: 1,
  });

  // DNS Records
  if (exportData.dnsRecords.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/dns_records',
      description: `Create DNS records (${exportData.dnsRecords.map(r => r.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`,
      count: exportData.dnsRecords.length,
    });
  }

  // Zone Settings
  const editableSettings = exportData.settings.filter(s => s.editable && !READ_ONLY_SETTINGS.has(s.id));
  if (editableSettings.length > 0) {
    apiCalls.push({
      method: 'PATCH',
      endpoint: '/zones/{zone_id}/settings/{setting_id}',
      description: `Update zone settings`,
      count: editableSettings.length,
    });
  }

  // Page Rules
  if (exportData.pageRules.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/pagerules',
      description: `Create page rules`,
      count: exportData.pageRules.length,
    });
  }

  // Rulesets
  const rulesetsWithRules = exportData.rulesets.filter(rs => rs.rules && rs.rules.length > 0);
  if (rulesetsWithRules.length > 0) {
    apiCalls.push({
      method: 'PUT',
      endpoint: '/zones/{zone_id}/rulesets/phases/{phase}/entrypoint',
      description: `Update rulesets (${rulesetsWithRules.map(r => r.phase).join(', ')})`,
      count: rulesetsWithRules.length,
    });
  }

  // Health Monitors
  if (exportData.monitors.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: `/accounts/${destAccountId}/load_balancers/monitors`,
      description: `Create health monitors`,
      count: exportData.monitors.length,
    });
  }

  // Pools
  if (exportData.pools.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: `/accounts/${destAccountId}/load_balancers/pools`,
      description: `Create load balancer pools`,
      count: exportData.pools.length,
    });
  }

  // Load Balancers
  if (exportData.loadBalancers.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/load_balancers',
      description: `Create load balancers`,
      count: exportData.loadBalancers.length,
    });
  }

  // Workers
  if (exportData.workers.length > 0) {
    apiCalls.push({
      method: 'PUT',
      endpoint: `/accounts/${destAccountId}/workers/scripts/{script_name}`,
      description: `Upload worker scripts`,
      count: exportData.workers.length,
    });
  }

  // Worker Routes
  if (exportData.workerRoutes.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/workers/routes',
      description: `Create worker routes`,
      count: exportData.workerRoutes.length,
    });
  }

  // Spectrum Apps
  if (exportData.spectrumApps.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/spectrum/apps',
      description: `Create Spectrum apps`,
      count: exportData.spectrumApps.length,
    });
  }

  // Custom Certificates
  if (exportData.customCertificates.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/custom_certificates',
      description: `Upload custom certificates`,
      count: exportData.customCertificates.length,
    });
  }

  // Custom Hostnames
  if (exportData.customHostnames.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/custom_hostnames',
      description: `Create custom hostnames`,
      count: exportData.customHostnames.length,
    });
  }

  // Access Apps
  if (exportData.accessApps.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: `/accounts/${destAccountId}/access/apps`,
      description: `Create Access applications`,
      count: exportData.accessApps.length,
    });
  }

  // Access Policies
  if (exportData.accessPolicies.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: `/accounts/${destAccountId}/access/apps/{app_id}/policies`,
      description: `Create Access policies`,
      count: exportData.accessPolicies.length,
    });
  }

  // Firewall Rules
  if (exportData.firewallRules.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/firewall/rules',
      description: `Create firewall rules`,
      count: exportData.firewallRules.length,
    });
  }

  // Rate Limits
  if (exportData.rateLimits.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/rate_limits',
      description: `Create rate limits`,
      count: exportData.rateLimits.length,
    });
  }

  // Email Routing Rules
  if (exportData.emailRoutingRules.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/email/routing/rules',
      description: `Create email routing rules`,
      count: exportData.emailRoutingRules.length,
    });
  }

  // Waiting Rooms
  if (exportData.waitingRooms.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: '/zones/{zone_id}/waiting_rooms',
      description: `Create waiting rooms`,
      count: exportData.waitingRooms.length,
    });
  }

  // Zaraz Config
  if (exportData.zarazConfig) {
    apiCalls.push({
      method: 'PUT',
      endpoint: '/zones/{zone_id}/zaraz/config',
      description: `Update Zaraz configuration`,
      count: 1,
    });
  }

  // Turnstile Widgets
  if (exportData.turnstileWidgets.length > 0) {
    apiCalls.push({
      method: 'POST',
      endpoint: `/accounts/${destAccountId}/challenges/widgets`,
      description: `Create Turnstile widgets`,
      count: exportData.turnstileWidgets.length,
    });
  }

  // Argo Smart Routing (entitlement-checked)
  if (exportData.argoSmartRouting?.value === 'on') {
    apiCalls.push({
      method: 'PATCH',
      endpoint: '/zones/{zone_id}/argo/smart_routing',
      description: `Enable Argo Smart Routing (with entitlement check)`,
      count: 2, // 1 GET check + 1 PATCH
    });
  }

  // Tiered Caching (entitlement-checked)
  if (exportData.argoTieredCaching?.value === 'on') {
    apiCalls.push({
      method: 'PATCH',
      endpoint: '/zones/{zone_id}/argo/tiered_caching',
      description: `Enable Tiered Caching (with entitlement check)`,
      count: 2, // 1 GET check + 1 PATCH
    });
  }

  // Bot Management (entitlement-checked)
  if (exportData.botManagement && (
    exportData.botManagement.fight_mode ||
    exportData.botManagement.sbfm_definitely_automated ||
    exportData.botManagement.sbfm_likely_automated
  )) {
    apiCalls.push({
      method: 'PUT',
      endpoint: '/zones/{zone_id}/bot_management',
      description: `Migrate Bot Management config (with entitlement check)`,
      count: 2, // 1 GET check + 1 PUT
    });
  }

  const totalCalls = apiCalls.reduce((sum, call) => sum + call.count, 0);

  return {
    apiCalls,
    summary: {
      total: totalCalls,
      resourceTypes: apiCalls.length,
    },
  };
}
