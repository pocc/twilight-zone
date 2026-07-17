import { ScopeReview, type ScopeReviewProps } from './ScopeReview';

/**
 * Step 2 — Zone. The second numbered wizard step: an auditable review of ONLY
 * zone-scoped resources (DNS, settings, rulesets, page rules, firewall, rate
 * limits, worker routes, custom hostnames, email routing, etc.) plus the
 * zone-scoped secret inputs (custom SSL cert+key, AOP mTLS).
 *
 * Shares its rendering implementation (`ScopeReview`) with `Step1Account`,
 * parameterised by `phase`. See the note in `Step1Account.tsx` for why these
 * are two step components over one shared view.
 */
export function Step2Zone(props: Omit<ScopeReviewProps, 'phase'>) {
  return <ScopeReview {...props} phase="zone" />;
}
