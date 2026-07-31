import { hashValue } from './crypto';

export type PromptContextInput = {
  migrationId: string;
  sourceGrantId?: string;
  destinationGrantId?: string;
  nonceDigest: string;
  roles: readonly ('source' | 'destination')[];
  sourceAccountId: string;
  destinationAccountId: string;
};

export const createPromptContextDigest = (context: PromptContextInput): Promise<string> => hashValue(JSON.stringify({
  migrationId: context.migrationId,
  sourceGrantId: context.sourceGrantId ?? null,
  destinationGrantId: context.destinationGrantId ?? null,
  nonceDigest: context.nonceDigest,
  roles: [...context.roles],
  sourceAccountId: context.sourceAccountId,
  destinationAccountId: context.destinationAccountId,
}));
