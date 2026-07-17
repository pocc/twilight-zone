import type { LogLine } from '../hooks/useStreamRequest';

/**
 * Loose mirror of src/api.ts `AuditLogEntry`. Kept local and partial because the
 * audit log crosses the SSE boundary as plain JSON (`unknown[]`), so we never
 * assume every field is present.
 */
type AuditEntry = {
  timestamp?: string;
  method?: string;
  path?: string;
  status?: 'success' | 'error' | 'retry';
  statusCode?: number;
  error?: string;
  duration?: number;
};

/**
 * Render the recorded API calls (the actual account/zone endpoints hit during a
 * run) as terminal log lines so the post-run "API calls" panels can reuse
 * LogPanel's terminal styling. Each line is
 * `METHOD  path → <statusCode|status> (Nms) — error`, typed by outcome so
 * failures and retries stand out (red / amber).
 *
 * This is the actuals counterpart to the dry-run `apiCalls` preview: it reads
 * what the migration *did*, from the per-phase audit log emitted by the worker.
 */
export function auditEntriesToLogLines(entries: unknown[] | undefined): LogLine[] {
  if (!entries) return [];
  return entries.map((raw) => {
    const e = (raw ?? {}) as AuditEntry;
    const method = (e.method || '?').toUpperCase();
    const code = e.statusCode != null ? String(e.statusCode) : e.status || '';
    const dur = e.duration != null ? ` (${e.duration}ms)` : '';
    const err = e.error ? ` \u2014 ${e.error}` : '';
    const message = `${method.padEnd(6)} ${e.path || ''} \u2192 ${code}${dur}${err}`;
    const type: LogLine['type'] =
      e.status === 'error' ? 'error' : e.status === 'retry' ? 'warning' : 'success';
    const timestamp = e.timestamp ? Date.parse(e.timestamp) || Date.now() : Date.now();
    return { message, type, timestamp };
  });
}
