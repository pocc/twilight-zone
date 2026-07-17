import { useState, useCallback, useRef } from 'react';
import { streamRequest } from '../lib/api';
import type { StreamPrompt } from '../lib/api';

export interface LogLine {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'prompt' | 'default';
  timestamp: number;
  prompt?: StreamPrompt;
}

function classifyLine(message: string): LogLine['type'] {
  if (message.includes('✓') || message.includes('✅') || message.startsWith('  ✓')) return 'success';
  if (message.includes('✗') || message.includes('❌') || message.includes('ERROR')) return 'error';
  if (message.includes('⚠') || message.includes('WARNING') || message.includes('SKIP')) return 'warning';
  if (message.includes('⏳') || message.includes('📋') || message.includes('📊') || message.includes('🔍')) return 'info';
  return 'default';
}

export function useStreamRequest() {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 100 });
  const [loadingText, setLoadingText] = useState('Processing...');
  const [startTime, setStartTime] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // [W24] Use ref + batched flush to avoid O(n^2) spread on every log line
  const logBufferRef = useRef<LogLine[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current mirror of `logs` so callers can read the final log
  // synchronously right after `await start(...)` resolves — `logs` itself is
  // closure-stale at that point. Used to snapshot one phase's log before the
  // next phase's start() resets it (chained account→zone migration).
  const logsRef = useRef<LogLine[]>([]);

  const flushLogs = useCallback(() => {
    if (logBufferRef.current.length === 0) return;
    const batch = logBufferRef.current;
    logBufferRef.current = [];
    flushTimerRef.current = null;
    setLogs(prev => {
      const next = prev.concat(batch);
      logsRef.current = next;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    logBufferRef.current = [];
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    logsRef.current = [];
    setLogs([]);
    setProgress({ current: 0, total: 100 });
    setLoadingText('Processing...');
  }, []);

  /** Snapshot of the current accumulated log lines (ref-backed, not stale). */
  const getLogs = useCallback(() => logsRef.current, []);

  const start = useCallback(async (
    url: string,
    body: Record<string, unknown>,
    text?: string,
    /** Runs synchronously before setLoading(false) so callers can batch state updates in the same render. */
    beforeDone?: (data: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown> | null> => {
    reset();
    setLoading(true);
    setStartTime(Date.now());
    if (text) setLoadingText(text);
    abortRef.current = new AbortController();

    return new Promise((resolve) => {
      streamRequest(url, body, {
        onLog: (message, prog) => {
          // [W24] Buffer logs and flush every 50ms to avoid O(n^2) state updates
          logBufferRef.current.push({ message, type: classifyLine(message), timestamp: Date.now() });
          if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(flushLogs, 50);
          }
          if (prog) setProgress(prog);
        },
        onPrompt: (prompt) => {
          // Flush pending logs first so the prompt appears after all prior output
          flushLogs();
          logBufferRef.current.push({
            message: `❓ ${prompt.question}`,
            type: 'prompt',
            timestamp: Date.now(),
            prompt,
          });
          flushLogs();
        },
        onDone: (data) => {
          // Flush any remaining buffered logs before completing
          flushLogs();
          if (beforeDone) beforeDone(data);
          setLoading(false);
          setStartTime(null);
          resolve(data);
        },
        onError: (error) => {
          flushLogs();
          logBufferRef.current.push({ message: `ERROR: ${error}`, type: 'error', timestamp: Date.now() });
          flushLogs();
          setLoading(false);
          setStartTime(null);
          resolve(null);
        },
      }, abortRef.current!.signal);
    });
  }, [reset]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setStartTime(null);
  }, []);

  const respondToPrompt = useCallback(async (promptId: string, answer: string) => {
    // Update the prompt log line to show the selected answer
    setLogs(prev => prev.map(line =>
      line.prompt?.promptId === promptId
        ? { ...line, type: 'info' as const, message: `❓ ${line.prompt!.question} → ${answer}`, prompt: undefined }
        : line
    ));
    // POST the answer back to the server
    try {
      await fetch('/api/migrate/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId, answer }),
      });
    } catch {
      // If the respond fails, the server will timeout and use default
    }
  }, []);

  return { loading, logs, progress, loadingText, startTime, start, cancel, reset, setLoadingText, respondToPrompt, getLogs };
}
