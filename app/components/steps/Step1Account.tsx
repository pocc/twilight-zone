import { ScopeReview, type ScopeReviewProps } from './ScopeReview';

/**
 * Step 1 — Account. The first numbered wizard step: an auditable review of
 * ONLY account-scoped resources (Workers, KV/R2/D1, Queues, Hyperdrive,
 * Secrets Store, LB pools/monitors, Access apps + IdPs, Turnstile, Pages, AI
 * Gateway, Origin CA) plus the account-scoped secret inputs and the optional
 * analytics-archive / download-script add-ons.
 *
 * Account and Zone are two distinct wizard steps that share one rendering
 * implementation (`ScopeReview`), parameterised by `phase`. This component is
 * the account-phase entry point; `Step2Zone` is the zone-phase one. Keeping
 * them as separate step components keeps the file tree 1:1 with the wizard
 * steps (0 Setup · 1 Account · 2 Zone · 3 Apply · 4 Results) without
 * duplicating the ~1000-line shared scope view.
 */
export function Step1Account(props: Omit<ScopeReviewProps, 'phase'>) {
  return <ScopeReview {...props} phase="account" />;
}
