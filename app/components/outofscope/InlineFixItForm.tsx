import React from 'react';
import type { CFCustomCertificate, CFWorkerScript, ZoneExport } from '../../../src/types';
import type { OriginCaCsrInput } from '../../lib/types';
import type { AopMtlsBundle } from '../OutOfScopePanel';
import { WorkerSecretsFix } from '../fixit/WorkerSecretsFix';
import { CustomCertFix } from '../fixit/CustomCertFix';
import { OriginCaFix, type SourceOriginCaCert } from '../fixit/OriginCaFix';
import {
  NotificationWebhookSecretFix,
  type SourceNotificationWebhook,
} from '../fixit/NotificationWebhookSecretFix';
import {
  IdPSecretFix,
  type SourceIdentityProvider,
} from '../fixit/IdPSecretFix';
import { AopMtlsFix } from '../fixit/AopMtlsFix';
import {
  AiGatewayProviderApiKeyFix,
  type SourceAiGatewayCustomProvider,
} from '../fixit/AiGatewayProviderApiKeyFix';

/** Renders the correct fix-it sub-component for a bucket-1 item key.
 * Returns null for any key that doesn't have inline fix-it support. */
export function InlineFixItForm({
  itemKey,
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
}: {
  itemKey: string;
  exportData: ZoneExport;
  workerSecrets: Record<string, Record<string, string>>;
  setWorkerSecrets: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  certificates: Array<{ cert: string; key: string }>;
  setCertificates: React.Dispatch<React.SetStateAction<Array<{ cert: string; key: string }>>>;
  originCaCsrs: OriginCaCsrInput[];
  setOriginCaCsrs: React.Dispatch<React.SetStateAction<OriginCaCsrInput[]>>;
  notificationWebhookSecrets: Record<string, string>;
  setNotificationWebhookSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  identityProviderSecrets: Record<string, string>;
  setIdentityProviderSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  aopMtlsBundles: AopMtlsBundle[];
  setAopMtlsBundles: React.Dispatch<React.SetStateAction<AopMtlsBundle[]>>;
  aiGatewayProviderApiKeys: Record<string, string>;
  setAiGatewayProviderApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  if (itemKey === 'worker_secrets') {
    const workers: CFWorkerScript[] = exportData?.workers || [];
    return (
      <WorkerSecretsFix
        workers={workers}
        workerSecrets={workerSecrets}
        setWorkerSecrets={setWorkerSecrets}
      />
    );
  }
  if (itemKey === 'custom_certificate_keys') {
    const sourceCerts: CFCustomCertificate[] = exportData?.customCertificates || [];
    return (
      <CustomCertFix
        sourceCustomCertificates={sourceCerts}
        certificates={certificates}
        setCertificates={setCertificates}
      />
    );
  }
  if (itemKey === 'origin_ca_keys') {
    const sourceCerts: SourceOriginCaCert[] = exportData?.originCaCertificates || [];
    return (
      <OriginCaFix
        sourceOriginCaCertificates={sourceCerts}
        originCaCsrs={originCaCsrs}
        setOriginCaCsrs={setOriginCaCsrs}
      />
    );
  }
  if (itemKey === 'notification_webhook_secret') {
    // Bucket 2.1: source webhooks come from exportData.notificationWebhooks.
    // The shape is loosely typed in ZoneExport - narrow it via the
    // SourceNotificationWebhook type for the sub-component.
    const webhooks: SourceNotificationWebhook[] =
      (exportData?.notificationWebhooks ?? []) as SourceNotificationWebhook[];
    return (
      <NotificationWebhookSecretFix
        webhooks={webhooks}
        notificationWebhookSecrets={notificationWebhookSecrets}
        setNotificationWebhookSecrets={setNotificationWebhookSecrets}
      />
    );
  }
  if (itemKey === 'identity_provider_secrets') {
    // Bucket 2.2
    const idps: SourceIdentityProvider[] =
      (exportData?.identityProviders ?? []) as SourceIdentityProvider[];
    return (
      <IdPSecretFix
        identityProviders={idps}
        identityProviderSecrets={identityProviderSecrets}
        setIdentityProviderSecrets={setIdentityProviderSecrets}
      />
    );
  }
  if (itemKey === 'aop_mtls_certificate_bundle') {
    // Bucket 2.3
    const affectedHostnames = exportData?.hostnameAssociations?.hostnames ?? [];
    return (
      <AopMtlsFix
        aopMtlsBundles={aopMtlsBundles}
        setAopMtlsBundles={setAopMtlsBundles}
        affectedHostnames={affectedHostnames}
      />
    );
  }
  if (itemKey === 'ai_gateway_custom_provider_api_keys') {
    // Bucket 2.4
    const providers: SourceAiGatewayCustomProvider[] =
      (exportData?.aiGatewayCustomProviders ?? []) as SourceAiGatewayCustomProvider[];
    return (
      <AiGatewayProviderApiKeyFix
        providers={providers}
        aiGatewayProviderApiKeys={aiGatewayProviderApiKeys}
        setAiGatewayProviderApiKeys={setAiGatewayProviderApiKeys}
      />
    );
  }
  return null;
}
