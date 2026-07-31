import { fixedDigestEqual } from './crypto';
import { createPromptContextDigest } from './prompt-context';

export type PromptAuthContext = {
  nonceDigest: string;
  sourceGrantId?: string;
  destinationGrantId?: string;
  roles: readonly ('source' | 'destination')[];
};

type PromptEntry = {
  digest: string;
  migrationId: string;
  roles: readonly ('source' | 'destination')[];
  sourceAccountId: string;
  destinationAccountId: string;
  resolver: (answer: string) => void;
};

type PromptResponse = {
  migrationId: string;
  promptId: string;
  answer: string;
};

export const selectPromptTimeoutAnswer = (
  options: { value: string; label: string }[],
): string => {
  const safeOption = options.find(({ value }) => value === 'skip');
  if (!safeOption) throw new Error('Prompt timed out without a safe fallback');
  return safeOption.value;
};

export const createMigrationPromptRegistry = () => {
  const entries = new Map<string, PromptEntry>();
  const key = (migrationId: string, promptId: string): string => `${migrationId}:${promptId}`;

  return {
    async register(input: {
      migrationId: string;
      auth: PromptAuthContext;
      roles: readonly ('source' | 'destination')[];
      sourceAccountId: string;
      destinationAccountId: string;
      resolver: (answer: string) => void;
    }): Promise<string> {
      if (input.roles.length !== input.auth.roles.length || input.roles.some((role, index) => role !== input.auth.roles[index])) {
        throw new Error('oauth_prompt_role_mismatch');
      }
      const promptId = crypto.randomUUID();
      const digest = await createPromptContextDigest({
        migrationId: input.migrationId,
        sourceGrantId: input.auth.sourceGrantId,
        destinationGrantId: input.auth.destinationGrantId,
        nonceDigest: input.auth.nonceDigest,
        roles: input.auth.roles,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
      });
      entries.set(key(input.migrationId, promptId), {
        digest,
        migrationId: input.migrationId,
        roles: input.roles,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        resolver: input.resolver,
      });
      return promptId;
    },

    async resolve(response: PromptResponse, auth: PromptAuthContext): Promise<boolean> {
      const entryKey = key(response.migrationId, response.promptId);
      const entry = entries.get(entryKey);
      if (!entry) return false;
      const digest = await createPromptContextDigest({
        migrationId: entry.migrationId,
        sourceGrantId: auth.sourceGrantId,
        destinationGrantId: auth.destinationGrantId,
        nonceDigest: auth.nonceDigest,
        roles: auth.roles,
        sourceAccountId: entry.sourceAccountId,
        destinationAccountId: entry.destinationAccountId,
      });
      if (!fixedDigestEqual(entry.digest, digest)) return false;
      entries.delete(entryKey);
      entry.resolver(response.answer);
      return true;
    },

    getContext(migrationId: string, promptId: string): Pick<PromptEntry, 'roles' | 'sourceAccountId' | 'destinationAccountId'> | undefined {
      const entry = entries.get(key(migrationId, promptId));
      if (!entry) return undefined;
      return {
        roles: [...entry.roles],
        sourceAccountId: entry.sourceAccountId,
        destinationAccountId: entry.destinationAccountId,
      };
    },

    delete(migrationId: string, promptId: string): void {
      entries.delete(key(migrationId, promptId));
    },
  };
};
