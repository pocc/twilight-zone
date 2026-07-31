// Email Routing + Waiting Rooms phase extracted from migrateZone() — Batch 3.
//
// This phase runs in parallel as a single `Promise.all`:
//
//   1. Email Routing Rules
//      - Auto-enables Email Routing on the destination zone (tolerates the
//        "active zone required" error that occurs while the dest zone is
//        still pending nameserver cutover).
//      - Lists destination addresses on the dest account so we can map each
//        forward target to an existing-or-newly-created address.
//      - Honours `config.skippedEmailAddresses` from Step 2: any rule whose
//        forward action references a skipped address is surfaced as
//        `acknowledged` (via the `ACKNOWLEDGED:` prefix consumed by
//        migrateItems), not `failed` — satisfies the "No Surprise Failures"
//        principle.
//      - Catch-all rules (matchers === [{type:"all"}], no field) are routed
//        through the dedicated PUT /email/routing/rules/catch_all endpoint.
//      - Auto-creates missing destination addresses on the dest account and
//        accumulates a manual-action entry listing addresses that still need
//        verification at the end of the phase.
//
//   2. Waiting Rooms
//      - Preflights each room against the set of hostnames the dest zone
//        "owns" (zone apex + migrated DNS records + custom hostnames). Rooms
//        whose `host` doesn't resolve to an owned hostname would otherwise
//        hit a generic "host is not attached to this zone" error from
//        Cloudflare; we pre-acknowledge with a clearer reason instead.
//      - Eligible rooms are POSTed through migrateItems; preflight-
//        acknowledged rooms are folded back into the same section so the
//        report shows every original room in one place.
//
// The block is a literal move from migrate.ts lines 4376-4658 (pre-extract).
// No logic changes — only the closure-captured locals (`destAddresses`,
// `pendingVerificationEmails`, `skippedEmailSet`) are now scoped inside the
// `migrateEmailAndWaitingRooms` function.

import type { MigrationConfig, MigrationReport, ZoneExport, ReportSection } from '../types';
import * as api from '../api';
import { migrateItems, type LogFn } from '../migrate';

export interface EmailAndWaitingRoomsDeps {
  exportData: ZoneExport;
  report: MigrationReport;
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  destZoneId: string;
  /**
   * Zone name (apex). Used by the Waiting Rooms preflight to decide which
   * hosts the destination zone "owns".
   */
  zoneName: string;
  /**
   * The user's Step 2 acknowledgments. Only `skippedEmailAddresses` is
   * consumed here — accepted as part of the full config for forward-
   * compatibility with other Step 2 settings the phase may need later.
   */
  config: Pick<MigrationConfig, 'skippedEmailAddresses'>;
  logWithProgress: LogFn;
  /** Advance the upstream `completedItems` progress counter by one. */
  onItemDone: () => void;
}

/**
 * Run the Email Routing + Waiting Rooms phase. Mutates `deps.report` in
 * place; appends two new sections (`emailRoutingSection`,
 * `waitingRoomsSection`) and any required manual-action strings.
 */
export async function migrateEmailAndWaitingRooms(
  deps: EmailAndWaitingRoomsDeps,
): Promise<void> {
  const {
    exportData,
    report,
    destAuth,
    destAccountId,
    destZoneId,
    zoneName,
    config,
    logWithProgress,
    onItemDone,
  } = deps;

  // No-op identity preserved from the original `trackSection` closure in
  // migrateZone(). Kept as a local for symmetry with the other phases.
  const trackSection = <T>(section: T) => section;

  logWithProgress('⏳ Migrating Email Routing Rules, Waiting Rooms (parallel)...');

  // Track destination addresses that need verification
  const pendingVerificationEmails: string[] = [];
  let destAddresses: api.EmailRoutingAddress[] = [];

  // Set of forward-target addresses the user explicitly chose to skip in
  // Step 2. Rules whose forward action references any of these addresses get
  // surfaced as `acknowledged` (not `failed`), satisfying the "No Surprise
  // Failures" principle.
  const skippedEmailSet = new Set(
    (config.skippedEmailAddresses || []).map((s) => s.toLowerCase()),
  );

  // Auto-enable Email Routing and check destination addresses if there are rules to migrate
  if (exportData.emailRoutingRules.length > 0) {
    try {
      const emailSettings = await api.getEmailRoutingSettings(destAuth, destZoneId);
      if (!emailSettings?.enabled) {
        logWithProgress('  ⚙️ Enabling Email Routing on destination zone...');
        logWithProgress(`  POST /zones/${destZoneId}/email/routing/enable`);
        try {
          await api.enableEmailRouting(destAuth, destZoneId);
          logWithProgress('  ✓ Email Routing enabled');
        } catch (enableErr) {
          api.throwIfAuthError(enableErr);
          // "Active zone required" is expected when the dest zone is still
          // pending (nameservers not pointed at Cloudflare yet). The rules
          // themselves can still be created (the catch-all PUT and per-rule
          // POSTs work on a disabled-routing zone), so this is informational.
          const msg = enableErr instanceof Error ? enableErr.message : String(enableErr);
          if (/active zone required/i.test(msg)) {
            logWithProgress(`  ℹ Email Routing cannot be enabled yet: destination zone is pending nameserver cutover. Rules will be created but won't deliver email until the zone is active.`);
          } else {
            logWithProgress(`  ⚠️ Could not enable Email Routing: ${msg}`);
          }
        }
      }

      // Get existing destination addresses in dest account
      destAddresses = await api.listEmailRoutingAddresses(destAuth, destAccountId);
      logWithProgress(`  📧 Found ${destAddresses.length} destination address(es) in destination account`);

      // Carry the request-affecting Email Routing settings the enable flow
      // doesn't set: support_subaddress (sub-addressing user+tag@) and
      // skip_wizard. Only PATCH when the source has a non-default (true) value,
      // so the common case adds no extra write/failure surface. A plan/pending
      // rejection is logged, never fatal (Principle 1).
      const ers = exportData.emailRoutingSettings;
      if (ers && (ers.support_subaddress === true || ers.skip_wizard === true)) {
        try {
          logWithProgress(`  PATCH /zones/${destZoneId}/email/routing`);
          await api.updateEmailRoutingSettings(destAuth, destZoneId, {
            support_subaddress: ers.support_subaddress,
            skip_wizard: ers.skip_wizard,
          });
          logWithProgress(`  ✓ Email Routing settings applied${ers.support_subaddress ? ' (sub-addressing on)' : ''}`);
        } catch (settingsErr) {
          api.throwIfAuthError(settingsErr);
          logWithProgress(`  ⚠️ Could not apply Email Routing settings: ${settingsErr instanceof Error ? settingsErr.message : String(settingsErr)}`);
        }
      }
    } catch (e) {
      api.throwIfAuthError(e);
      logWithProgress(`  ⚠️ Could not check Email Routing settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  const [emailRoutingSection, waitingRoomsSection] = (await Promise.all([
    migrateItems(
      'Email Routing Rules',
      exportData.emailRoutingRules,
      async (rule) => {
        // Pre-check: if ANY forward action target is in the skip set, the user
        // already acknowledged this rule won't migrate. Surface via the
        // ACKNOWLEDGED: marker so migrateItems classifies it correctly.
        if (skippedEmailSet.size > 0) {
          const forwardTargets: string[] = [];
          for (const a of rule.actions || []) {
            if (a.type === 'forward' && Array.isArray(a.value)) {
              for (const v of a.value) forwardTargets.push(String(v).toLowerCase());
            }
          }
          const blocked = forwardTargets.filter((t) => skippedEmailSet.has(t));
          if (blocked.length > 0) {
            throw new Error(
              `ACKNOWLEDGED: Forwards to ${blocked.join(', ')} — address${blocked.length === 1 ? '' : 'es'} skipped in Step 2 (not verified on destination account). Verify and re-run migration to land this rule.`,
            );
          }
        }

        // Detect catch-all rules — they have matchers: [{type: "all"}] and must
        // use the dedicated PUT /email/routing/rules/catch_all endpoint, not POST.
        const isCatchAll = (rule.matchers || []).length === 1 &&
          rule.matchers[0].type === 'all' &&
          !rule.matchers[0].field;

        if (isCatchAll) {
          // Catch-all rules are auto-created when email routing is enabled.
          // We only need to update the existing catch-all to match the source config.
          const actions = (rule.actions || []).map((a) => {
            if (a.type === 'drop') return { type: 'drop' as const };
            return { type: a.type, value: a.value || [] };
          });
          await api.updateEmailRoutingCatchAllRule(destAuth, destZoneId, {
            enabled: rule.enabled !== false,
            matchers: [{ type: 'all' }],
            actions: actions.length > 0 ? actions : [{ type: 'drop' }],
          });
          return;
        }

        // Sanitize matchers - strip IDs from source account, keep only essential fields
        const matchers = (rule.matchers || [])
          .filter((m) => m.type === 'all' || (m.type && m.field && m.value))
          .map((m) => {
            if (m.type === 'all') {
              return { type: m.type };
            }
            return {
              type: m.type,
              field: m.field,
              value: m.value,
              // Omit 'id' and other source-account-specific fields
            };
          });

        if (matchers.length === 0) {
          throw new Error('No valid matchers in rule - rule cannot match any emails');
        }

        // Validate and fix action types - valid types: forward, worker, drop
        const validActionTypes = ['forward', 'worker', 'drop'];
        const actions: { type: string; value: string[] }[] = [];

        for (const a of rule.actions || []) {
          const actionType = validActionTypes.includes(a.type) ? a.type : 'forward';

          if (actionType === 'drop') {
            actions.push({ type: 'drop', value: [] });
          } else if (actionType === 'forward') {
            // Check each destination email and ensure it exists in dest account
            const validEmails: string[] = [];
            for (const email of a.value || []) {
              const existingAddr = destAddresses.find((addr) => addr.email === email);
              if (existingAddr) {
                if (existingAddr.verified) {
                  validEmails.push(email);
                } else {
                  // Address exists but not verified - can still use it
                  validEmails.push(email);
                  if (!pendingVerificationEmails.includes(email)) {
                    pendingVerificationEmails.push(email);
                  }
                }
              } else {
                // Address doesn't exist - try to create it
                try {
                  const newAddr = await api.createEmailRoutingAddress(destAuth, destAccountId, email);
                  destAddresses.push(newAddr);
                  validEmails.push(email);
                  if (!pendingVerificationEmails.includes(email)) {
                    pendingVerificationEmails.push(email);
                  }
                  logWithProgress(`    📨 Created destination address: ${email} (verification email sent)`);
                } catch (createErr) {
                  api.throwIfAuthError(createErr);
                  logWithProgress(`    ⚠️ Could not create destination address ${email}: ${createErr instanceof Error ? createErr.message : 'Unknown error'}`);
                }
              }
            }
            if (validEmails.length > 0) {
              actions.push({ type: 'forward', value: validEmails });
            }
          } else if (actionType === 'worker') {
            // Worker action - value is worker script name
            if (a.value && a.value.length > 0) {
              actions.push({ type: 'worker', value: a.value });
            }
          }
        }

        // Skip rules with no valid actions
        if (actions.length === 0) {
          throw new Error('No valid actions - forward rules require verified destination addresses');
        }

        await api.createEmailRoutingRule(destAuth, destZoneId, {
          name: rule.name || 'Migrated Rule',
          priority: rule.priority || 0,
          enabled: rule.enabled !== false,
          matchers: matchers,
          actions: actions,
        });
      },
      (r) => {
        if (!r.name && r.matchers?.length === 1 && r.matchers[0].type === 'all') {
          const action = r.actions?.[0]?.type || 'drop';
          return `Catch-all (${action}${r.enabled === false ? ', disabled' : ''})`;
        }
        return r.name || r.tag;
      },
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/email/routing/rules`,
    ),
    (async (): Promise<ReportSection> => {
      // Preflight: a Waiting Room's `host` must either be the zone apex or a
      // hostname that has a corresponding DNS record on the destination zone.
      // Cloudflare returns "host is not attached to this zone" for any other
      // value, which lands as an acknowledged manual action — but the user
      // can't actually fix it (they didn't pick the host), so it's clearer
      // to pre-acknowledge with a specific reason instead of letting the
      // API error get classified generically.
      //
      // Build the set of hostnames the dest zone "owns": zone apex, every
      // FQDN from the migrated DNS records, and every custom hostname.
      const ownedHosts = new Set<string>();
      const zoneApex = (zoneName || '').toLowerCase();
      if (zoneApex) ownedHosts.add(zoneApex);
      for (const rec of exportData.dnsRecords || []) {
        if (rec.name) ownedHosts.add(rec.name.toLowerCase());
      }
      for (const ch of exportData.customHostnames || []) {
        if (ch.hostname) ownedHosts.add(ch.hostname.toLowerCase());
      }

      const eligibleRooms: typeof exportData.waitingRooms = [];
      const preflightAcknowledged: Array<{ name: string; reason: string }> = [];
      for (const room of exportData.waitingRooms || []) {
        const host = (room.host || '').toLowerCase();
        if (host && !ownedHosts.has(host)) {
          preflightAcknowledged.push({
            name: room.name,
            reason: `Waiting Room "host" is "${room.host}" but no DNS record or custom hostname for that host exists on the destination zone. Cloudflare requires the host to be either the zone apex or attached via DNS/custom hostname. Create the missing DNS record and re-run, or update the Waiting Room's host before re-running.`,
          });
          continue;
        }
        eligibleRooms.push(room);
      }

      const sec = await migrateItems(
        'Waiting Rooms',
        eligibleRooms,
        async (room) => {
          await api.createWaitingRoom(destAuth, destZoneId, {
            name: room.name,
            description: room.description,
            host: room.host,
            path: room.path,
            queue_all: room.queue_all,
            disable_session_renewal: room.disable_session_renewal,
            suspended: room.suspended,
            json_response_enabled: room.json_response_enabled,
            new_users_per_minute: room.new_users_per_minute,
            total_active_users: room.total_active_users,
            session_duration: room.session_duration,
            custom_page_html: room.custom_page_html,
            default_template_language: room.default_template_language,
            cookie_suffix: room.cookie_suffix,
            additional_routes: room.additional_routes,
            cookie_attributes: room.cookie_attributes,
          });
        },
        (r) => r.name,
        report.errors,
        logWithProgress,
        report,
        onItemDone,
        `POST /zones/${destZoneId}/waiting_rooms`,
      );

      // Fold preflight-acknowledged rooms back into the section so the
      // report shows all original Waiting Rooms in one place, with the
      // unattached-host ones marked as acknowledged with a clear reason.
      for (const ack of preflightAcknowledged) {
        sec.items.push({
          name: ack.name,
          status: 'acknowledged' as const,
          error: ack.reason,
        });
        sec.total += 1;
        sec.acknowledged = (sec.acknowledged || 0) + 1;
        report.manualActions.push(`Waiting Room "${ack.name}": ${ack.reason}`);
      }
      if (preflightAcknowledged.length > 0) {
        logWithProgress(`  ⛔ ${preflightAcknowledged.length} Waiting Room(s) acknowledged: host not attached to destination zone`);
      }

      return sec;
    })(),
  ])).map(trackSection);
  report.sections.push(emailRoutingSection, waitingRoomsSection);

  // Add manual action for pending email verification
  if (pendingVerificationEmails.length > 0) {
    report.manualActions.push(
      `📧 Email Routing: ${pendingVerificationEmails.length} destination address(es) need verification:\n` +
      pendingVerificationEmails.map((e) => `  - ${e}`).join('\n') +
      `\n\nVerification emails have been sent. Click the link in each email to verify.`,
    );
  }

  logWithProgress(`✓ Batch 3 complete`);
}
