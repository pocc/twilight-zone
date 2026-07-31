import type { ResolvedOAuthContext } from './middleware';
import type { OAuthRole } from './types';

type TaggedAuthError = Error & {
  _tag: 'AuthError';
  matchesBearer: (token: string | undefined) => boolean;
};

const isTaggedAuthError = (error: unknown): error is TaggedAuthError =>
  typeof error === 'object'
  && error !== null
  && (error as Partial<TaggedAuthError>)._tag === 'AuthError'
  && typeof (error as Partial<TaggedAuthError>).matchesBearer === 'function';

export const rejectedOAuthRole = (
  error: unknown,
  context?: ResolvedOAuthContext,
): OAuthRole | undefined => {
  if (!isTaggedAuthError(error) || !context) return undefined;
  if (error.matchesBearer(context.source?.grant.accessToken)) return 'source';
  if (error.matchesBearer(context.destination?.grant.accessToken)) return 'destination';
  if (context.source && !context.destination) return 'source';
  if (context.destination && !context.source) return 'destination';
  return undefined;
};
