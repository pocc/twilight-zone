import type { ResolvedOAuthContext } from './middleware';
import type { PromptAuthContext } from './prompt-registry';
import type { OAuthRole } from './types';

export type OAuthPromptBinding = {
  roles: OAuthRole[];
  auth: PromptAuthContext;
};

export const createOAuthPromptBinding = (context: ResolvedOAuthContext): OAuthPromptBinding | undefined => {
  const roles: OAuthRole[] = [];
  if (context.source) roles.push('source');
  if (context.destination) roles.push('destination');
  if (roles.length === 0) return undefined;
  return {
    roles,
    auth: {
      nonceDigest: context.nonceDigest,
      ...(context.source ? { sourceGrantId: context.source.grant.grantId } : {}),
      ...(context.destination ? { destinationGrantId: context.destination.grant.grantId } : {}),
      roles,
    },
  };
};
