// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Single source of truth for the deployed tool version. Imported by both the
// UI worker (src/worker/index.ts) and the programmatic v1 API
// (src/worker/api-v1.ts) so the version stamped on /api/version, on logged
// migration runs, and in responses can never drift between the two surfaces.
//
// [R6] Keep in sync with package.json "version" (CM-3, SI-2).
export const APP_VERSION = '2.0.0';
