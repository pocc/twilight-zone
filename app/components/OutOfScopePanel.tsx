/**
 * Out-of-scope acknowledgment panel.
 *
 * Renders the IMPOSSIBLE_TO_MIGRATE entries that apply to this migration
 * in two distinct blocks:
 *
 *   1. **Actionable** ("Will Not Migrate - You Must Act") - items the
 *      user has agency over (secrets to re-supply, registrar changes,
 *      manual data copies). The user MUST acknowledge each before
 *      "Continue to Migration" is enabled. The framing leads with the
 *      *consequence* ("auth will fail", "data will be missing"), not
 *      the polite "please understand the manual steps".
 *
 *   2. **Informational** ("Other notes about this migration") - items
 *      the user has no control over (Cloudflare auto-managed rules,
 *      read-only settings, ephemeral data). Rendered as a compact,
 *      collapsible, read-only notice - no checkboxes, no acknowledgment
 *      requirement. Disclosure only.
 *
 * Per AGENTS.md Principle 1 (No Surprise Failures) and Principle 4
 * (Never Ask the User to Acknowledge Things They Cannot Change).
 *
 * The `actionable: boolean` field on `ApplicableImpossibleResource`
 * (set by `detectApplicableImpossibleResources` based on category)
 * is the single switch that decides which block a resource lands in.
 */

import React, { useMemo } from 'react';
import {
  hasInlineFixIt,
  type ApplicableImpossibleResource,
  type FixItState,
} from '../lib/outOfScope';
import type { ZoneExport } from '../../src/types';
import type { OriginCaCsrInput } from '../lib/types';
import { ActionableBlock } from './outofscope/ActionableBlock';
import { InformationalBlock } from './outofscope/InformationalBlock';

/** Type alias for the AOP mTLS bundle shape used by the panel + Step
 * 3. Kept here so the panel's prop types don't import the entire
 * MigrationConfig type. */
export type AopMtlsBundle = {
  name: string;
  certificates: string;
  private_key: string;
  ca?: boolean;
};

interface OutOfScopePanelProps {
  /** The applicable IMPOSSIBLE_TO_MIGRATE entries for this migration. */
  resources: ApplicableImpossibleResource[];
  /**
   * Set of acknowledgment keys the user has accepted. Only actionable
   * resources are gated by this set - informational items are
   * disclosure-only and never contribute to the gate.
   */
  acknowledgments: Set<string>;
  /** Setter to update acknowledgments. */
  setAcknowledgments: React.Dispatch<React.SetStateAction<Set<string>>>;
  /**
   * Source export - used by the inline fix-it forms to enumerate the
   * specific resources that need fixing (workers with secret bindings,
   * custom certs, Origin CA certs). Same state slice the panel already
   * runs detection against; passed explicitly here so the fix-it
   * sub-components can read it without re-running detection.
   */
  exportData: ZoneExport;
  /** Inline fix-it state - shared with Step 3 via App.tsx root state. */
  workerSecrets: Record<string, Record<string, string>>;
  setWorkerSecrets: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  certificates: Array<{ cert: string; key: string }>;
  setCertificates: React.Dispatch<React.SetStateAction<Array<{ cert: string; key: string }>>>;
  originCaCsrs: OriginCaCsrInput[];
  setOriginCaCsrs: React.Dispatch<React.SetStateAction<OriginCaCsrInput[]>>;
  /** Notification webhook signing secrets, keyed by source webhook name. */
  notificationWebhookSecrets: Record<string, string>;
  setNotificationWebhookSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Bucket 2.2: Access IdP client_secret values, keyed by source IdP name. */
  identityProviderSecrets: Record<string, string>;
  setIdentityProviderSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Bucket 2.3: AOP mTLS cert+key bundles. */
  aopMtlsBundles: AopMtlsBundle[];
  setAopMtlsBundles: React.Dispatch<React.SetStateAction<AopMtlsBundle[]>>;
  /** Bucket 2.4: AI Gateway custom provider API keys, keyed by source slug. */
  aiGatewayProviderApiKeys: Record<string, string>;
  setAiGatewayProviderApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function OutOfScopePanel({
  resources,
  acknowledgments,
  setAcknowledgments,
  exportData,
  workerSecrets,
  setWorkerSecrets,
  certificates,
  setCertificates,
  originCaCsrs,
  setOriginCaCsrs,
  notificationWebhookSecrets,
  setNotificationWebhookSecrets,
  identityProviderSecrets,
  setIdentityProviderSecrets,
  aopMtlsBundles,
  setAopMtlsBundles,
  aiGatewayProviderApiKeys,
  setAiGatewayProviderApiKeys,
}: OutOfScopePanelProps) {
  // Split resources into the two blocks this panel owns. Per Principle 4,
  // actionable and informational items have fundamentally different UX and
  // must never be conflated. A THIRD bucket — actionable items the user
  // performs themselves AFTER zone creation (no inline fix-it form) — is
  // intentionally excluded here and rendered by <PostMigrationWorkPanel>
  // instead: pre-acknowledging work that can only be done later is busywork.
  //   - gated actionable  = actionable AND has an inline fix-it form
  //     (tool consumes the value at migrate time) → blocks Continue.
  //   - informational     = not actionable (auto-managed / read-only /
  //     ephemeral) → disclosure only.
  //   - (excluded)        = actionable AND no fix-it form → handled by
  //     PostMigrationWorkPanel, never gates Continue.
  const { actionable, informational } = useMemo(() => {
    const a: ApplicableImpossibleResource[] = [];
    const i: ApplicableImpossibleResource[] = [];
    for (const r of resources) {
      if (r.actionable && hasInlineFixIt(r.key)) a.push(r);
      else if (!r.actionable) i.push(r);
      // else: actionable without a fix-it form → PostMigrationWorkPanel.
    }
    return { actionable: a, informational: i };
  }, [resources]);

  // Build the FixItState bundle once per render so the derivation
  // function gets a stable view of the source rows. The fix-it
  // sub-components reach into the same state slices directly via
  // their own props.
  const fixState: FixItState = useMemo(() => ({
    workerSecrets,
    certificates,
    originCaCsrs,
    notificationWebhookSecrets,
    identityProviderSecrets,
    aopMtlsBundles,
    aiGatewayProviderApiKeys,
    sourceWorkers: exportData?.workers,
    sourceCustomCertificates: exportData?.customCertificates,
    sourceOriginCaCertificates: exportData?.originCaCertificates,
    sourceNotificationWebhooks: exportData?.notificationWebhooks,
    sourceIdentityProviders: exportData?.identityProviders,
    sourceAiGatewayCustomProviders: exportData?.aiGatewayCustomProviders,
    sourceAopHostnameAssociations: exportData?.hostnameAssociations,
  }), [
    workerSecrets, certificates, originCaCsrs,
    notificationWebhookSecrets, identityProviderSecrets,
    aopMtlsBundles, aiGatewayProviderApiKeys,
    exportData,
  ]);

  if (resources.length === 0) return null;

  return (
    <div className="space-y-4">
      {actionable.length > 0 && (
        <ActionableBlock
          items={actionable}
          acknowledgments={acknowledgments}
          setAcknowledgments={setAcknowledgments}
          fixState={fixState}
          exportData={exportData}
          workerSecrets={workerSecrets}
          setWorkerSecrets={setWorkerSecrets}
          certificates={certificates}
          setCertificates={setCertificates}
          originCaCsrs={originCaCsrs}
          setOriginCaCsrs={setOriginCaCsrs}
          notificationWebhookSecrets={notificationWebhookSecrets}
          setNotificationWebhookSecrets={setNotificationWebhookSecrets}
          identityProviderSecrets={identityProviderSecrets}
          setIdentityProviderSecrets={setIdentityProviderSecrets}
          aopMtlsBundles={aopMtlsBundles}
          setAopMtlsBundles={setAopMtlsBundles}
          aiGatewayProviderApiKeys={aiGatewayProviderApiKeys}
          setAiGatewayProviderApiKeys={setAiGatewayProviderApiKeys}
        />
      )}
      {informational.length > 0 && <InformationalBlock items={informational} />}
    </div>
  );
}
