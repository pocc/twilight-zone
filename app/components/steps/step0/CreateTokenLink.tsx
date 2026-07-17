// "Create a token" deep-link shown beneath the API Token inputs in Step 1,
// for users who arrive without a token already created.
//
// IMPORTANT: this is a plain deep-link to the Cloudflare user-owned tokens
// page - it CANNOT prefill the token name or permissions. The dashboard
// commits new tokens via a CSRF-protected, cookie-authenticated POST
// (dash.cloudflare.com/api/v4/.../tokens with an x-atok token), and the
// create page accepts no query parameters. So the only thing we can do is
// open the page; the user selects permissions and pastes the token back.
//
// The `variant` only changes the label to set the user's expectation of what
// kind of token to build, based on whether the credential needs to WRITE:
//   - read  → reading/exporting the source zone ("Read All Resources"
//             template covers this).
//   - write → creating resources on the destination (or applying a preset);
//             no matching template, so the user builds a custom token.

// Cloudflare user-owned API tokens page.
export const TOKEN_CREATE_URL = 'https://dash.cloudflare.com/profile/api-tokens';

export type TokenLinkVariant = 'read' | 'write';

export const tokenLinkLabel = (variant: TokenLinkVariant): string =>
  variant === 'write' ? 'Create a write-all token' : 'Create a read-all token';

type CreateTokenLinkProps = {
  variant: TokenLinkVariant;
  className?: string;
};

export const CreateTokenLink = ({ variant, className = '' }: CreateTokenLinkProps) => (
  <a
    href={TOKEN_CREATE_URL}
    target="_blank"
    rel="noopener noreferrer"
    className={`inline-block mt-1 text-xs text-orange-400 hover:text-orange-300 transition ${className}`}
  >
    {tokenLinkLabel(variant)} &rarr;
  </a>
);
