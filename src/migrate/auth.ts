// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Auth helpers: pull the right Cloudflare API credential out of
// MigrationConfig for the source and destination sides.
//
// Two auth modes are supported:
//   • API token (config.sourceToken / config.destToken)
//   • API key + email (config.useApiKey + apiKey/apiEmail, optionally with
//     destApiKey/destApiEmail for split-credential setups)
//
// API key mode supports a "shared key" fallback: if the user only filled
// in apiKey/apiEmail (no destApiKey/destApiEmail), both source and dest
// auth resolve to the same credential. This matches the Step 1 UI which
// lets the user enter one key for both accounts.

import type { MigrationConfig } from '../types';
import type * as api from '../api';

export function getSourceAuth(config: MigrationConfig): api.ApiAuth | string {
  if (config.useApiKey && config.apiKey && config.apiEmail) {
    return { type: 'key', apiKey: config.apiKey, email: config.apiEmail };
  }
  return config.sourceToken;
}

export function getDestAuth(config: MigrationConfig): api.ApiAuth | string {
  if (config.useApiKey) {
    // Prefer destination-specific API key credentials when provided
    if (config.destApiKey && config.destApiEmail) {
      return { type: 'key', apiKey: config.destApiKey, email: config.destApiEmail };
    }
    // Fall back to shared API key (same key for source + dest)
    if (config.apiKey && config.apiEmail) {
      return { type: 'key', apiKey: config.apiKey, email: config.apiEmail };
    }
  }
  return config.destToken;
}
