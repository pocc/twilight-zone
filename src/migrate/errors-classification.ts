// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Error classification: turns a (resource, error message) pair into a
// suggested remediation + an error category used by report-markdown.ts to
// group errors into Billing / Manual Setup / Permission / Other buckets.
//
// This module is pure (no I/O, no Cloudflare API calls) and is shared by:
//   • migrateItems()      — annotates failed items inline as they happen
//   • report-markdown     — bucket headers and "Suggestion:" rendering
//   • test/migrate.test.ts — getSuggestion() back-compat surface

export interface ErrorAnalysis {
  suggestion?: string;
  category?: 'api' | 'manual_setup' | 'billing' | 'permission';
}

/**
 * Classify a Cloudflare API error message into an actionable suggestion +
 * a category. Returns an empty object when no rule matches — callers should
 * treat that as "unknown error, just surface the raw message."
 *
 * Rules are intentionally written as a flat if-cascade rather than a table
 * because several rules combine resource-name substrings with error-message
 * substrings (e.g. Worker code 10041 only means "KV not migrated" when the
 * resource is "Workers"), which would be awkward to express as data.
 */
export function analyzeError(resource: string, error: string): ErrorAnalysis {
  const errorLower = error.toLowerCase();

  // Zero Trust / Access not enabled - requires manual dashboard setup
  if (errorLower.includes('access.api.error.not_enabled') ||
      errorLower.includes('access is not enabled') ||
      (resource.includes('Access') && errorLower.includes('not enabled'))) {
    return {
      suggestion: 'Zero Trust must be enabled first: Dashboard → Zero Trust → Get Started. Select a team domain and plan (Free available).',
      category: 'manual_setup',
    };
  }

  // R2 not enabled - requires billing/dashboard setup
  if (errorLower.includes('enable r2 through') ||
      (resource.includes('R2') && errorLower.includes('not enabled'))) {
    return {
      suggestion: 'R2 must be enabled first: Dashboard → R2 → Get Started. A payment method is required.',
      category: 'billing',
    };
  }

  // Load Balancer subscription issues (Code 1002, Access Failed, Internal error)
  if ((resource.includes('Load Balancer') || resource.includes('Pool') || resource.includes('Monitor')) &&
      (errorLower.includes('1002') || errorLower.includes('access failed') ||
       errorLower.includes('internal error') || errorLower.includes('validation failed'))) {
    return {
      suggestion: 'Load Balancing add-on must be enabled: Dashboard → Traffic → Load Balancing → Enable ($5/mo). Contact Support if already enabled.',
      category: 'billing',
    };
  }

  // General permission errors
  if (errorLower.includes('permission') || errorLower.includes('forbidden') || errorLower.includes('unauthorized')) {
    return {
      suggestion: 'Check that your API token has the required permissions for this resource',
      category: 'permission',
    };
  }

  // Plan/feature not available
  if (errorLower.includes('plan') || errorLower.includes('not available') || errorLower.includes('upgrade')) {
    return {
      suggestion: 'This feature may require a plan upgrade on the destination account',
      category: 'billing',
    };
  }

  // Rate limiting
  if (errorLower.includes('rate limit')) {
    return {
      suggestion: 'Wait a few minutes and retry the migration',
      category: 'api',
    };
  }

  // Worker secrets
  if (resource === 'Workers' && errorLower.includes('secret')) {
    return {
      suggestion: 'Worker secrets cannot be read from source - provide them manually',
      category: 'api',
    };
  }

  // Worker KV namespace not found (10041)
  if (resource === 'Workers' && (errorLower.includes('10041') || errorLower.includes('kv namespace') && errorLower.includes('not found'))) {
    return {
      suggestion: 'KV namespace binding references a namespace that was not migrated. Ensure the KV namespace is selected for migration.',
      category: 'api',
    };
  }

  // Worker DO namespace not found (10061)
  if (resource === 'Workers' && (errorLower.includes('10061') || errorLower.includes('durable object namespace') && errorLower.includes('not found'))) {
    return {
      suggestion: 'Durable Object binding references a namespace that does not exist. DO namespaces are created when the worker is deployed - ensure the DO class is defined in the worker.',
      category: 'api',
    };
  }

  // Worker syntax errors (10021)
  if (resource === 'Workers' && (errorLower.includes('10021') || errorLower.includes('syntaxerror') || errorLower.includes('referenceerror'))) {
    return {
      suggestion: 'Worker has JavaScript syntax or reference errors. This worker may have been exported incorrectly or has code issues. Check the worker source code.',
      category: 'api',
    };
  }

  // Worker AI binding requires ES module format (100329)
  if (resource === 'Workers' && (errorLower.includes('100329') || errorLower.includes('ai') && errorLower.includes('es module'))) {
    return {
      suggestion: 'AI binding requires ES module format. Worker needs to be converted to ES module syntax: https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/',
      category: 'api',
    };
  }

  // Queues not enabled (11002)
  if (resource === 'Workers' && (errorLower.includes('11002') || errorLower.includes('queues') && errorLower.includes('enable'))) {
    return {
      suggestion: 'Queues must be enabled on the destination account: Dashboard → Workers → Queues → Enable',
      category: 'manual_setup',
    };
  }

  // Worker DO migration requires new_sqlite_classes (10097)
  if (resource === 'Workers' && (errorLower.includes('10097') || errorLower.includes('new_sqlite_classes'))) {
    return {
      suggestion: 'Durable Object namespace creation requires a `new_sqlite_classes` migration. This is handled automatically — retry the migration.',
      category: 'api',
    };
  }

  // Origin rules hostname validation
  if (resource === 'Rulesets' && errorLower.includes('does not belong to')) {
    return {
      suggestion: 'Origin host override requires an enterprise account type on the destination. The origin rule references a hostname the destination account does not control.',
      category: 'billing',
    };
  }

  // Health Monitor interval validation
  if (resource.includes('Monitor') && errorLower.includes('interval') && errorLower.includes('not in range')) {
    return {
      suggestion: 'Health monitor interval is outside the allowed range for your plan. Free/Pro plans have limited interval options. Contact Support or upgrade plan.',
      category: 'billing',
    };
  }

  // Email routing rule validation
  if (resource.includes('Email')) {
    if (errorLower.includes('no valid matchers')) {
      return {
        suggestion: 'Email routing rule has invalid matchers. The "to" address format may be incorrect or the matcher was exported with source-account-specific IDs.',
        category: 'api',
      };
    }
    if (errorLower.includes('no valid actions') || errorLower.includes('destination')) {
      return {
        suggestion: 'Email forwarding rule requires verified destination addresses. Check Dashboard → Email → Destination Addresses and verify pending emails.',
        category: 'manual_setup',
      };
    }
    if (errorLower.includes('not enabled') || errorLower.includes('enable email')) {
      return {
        suggestion: 'Email Routing must be enabled: Dashboard → Email → Email Routing → Enable',
        category: 'manual_setup',
      };
    }
  }

  // Spectrum - Enterprise only
  if (resource.includes('Spectrum')) {
    return {
      suggestion: 'Spectrum requires an Enterprise plan. Contact Support to enable.',
      category: 'billing',
    };
  }

  return {};
}

/**
 * Back-compat shim: returns only the suggestion string from analyzeError().
 * Kept because test/migrate.test.ts imports it directly, and removing it
 * would break consumers that have copied this import into other tools.
 */
export function getSuggestion(resource: string, error: string): string | undefined {
  return analyzeError(resource, error).suggestion;
}
