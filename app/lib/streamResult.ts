import type { ZoneExport, MigrationReport } from '../../src/types';
import type { ApiCall } from './codegen';

// Helper: narrow `unknown` (from useStreamRequest result) to the expected
// streaming-response shape. We trust the worker contract: every streaming
// /api/* endpoint emits a typed shape we control. This is a single
// type-narrowing site instead of `asStreamResult(result)?.export` peppered everywhere.
export type StreamResult = {
  export?: ZoneExport;
  files?: Array<{ filename: string; content: string }>;
  report?: MigrationReport;
  reportMarkdown?: string;
  auditLog?: unknown[];
  apiCalls?: ApiCall[];
};

export function asStreamResult(result: Record<string, unknown> | null): StreamResult | null {
  return result as StreamResult | null;
}
