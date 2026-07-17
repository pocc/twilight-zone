// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0

/**
 * Compute a progress-bar percentage from a current/total pair, clamped to
 * [0, 100].
 *
 * The migration progress denominator (countZoneMigrationItems /
 * countAccountResourceItems in src/migrate/setup.ts) is a deliberate
 * ESTIMATE — it does not count every increment path. The engine bumps the
 * numerator for work the estimate omits: account-level custom rulesets
 * (batch1.ts), phase entrypoints (batch1.ts), auto-created storage
 * dependencies referenced by worker bindings (batch2.ts), and acknowledged
 * singletons. So `current` can legitimately exceed `total`, which is how the
 * bar reached an impossible 366%.
 *
 * A progress bar must never read above 100% (nor below 0%), so the displayed
 * value is clamped here. This is the single shared computation behind every
 * streaming operation's progress (LogPanel is reused by export, migrate,
 * account-resources, terraform, fuzz, analytics, etc.).
 */
export function progressPct(current: number, total: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}
